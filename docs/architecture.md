# Architecture

[Back to README](../README.md)

These diagrams describe the checked-in Next.js/Supabase implementation. The old
microservices architecture in early Git history is not part of the current app.
The API auth boundary is incomplete; see [API reference](api.md#authentication).

## System architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React UI]
    U[Uploader]
    C[Court scene]
    UI --> U
    U -->|activity and saved diffs| C
  end
  API[Next.js API routes]
  A[Supabase Auth]
  DB[(Postgres files and file_chunks)]
  S["Storage chunks/fileId/index"]
  UI -->|sign in| A
  U -->|same-origin HTTP| API
  API -->|init and cancel identity checks| A
  API --> DB
  API --> S
```

The browser uploads through Next.js, which stores metadata in Postgres and piece objects in Supabase Storage.

Supabase browser sessions are persisted/refreshed by the browser SDK. Only init and
unfinished-upload cancellation validate the user's bearer token in their route
handlers. Cleanup validates a separate operator secret. The other upload/file
handlers use the server service-role client without an auth/owner check.
`src/middleware.ts` currently passes requests through.

## Upload sequence

```mermaid
sequenceDiagram
  participant U as Browser uploader
  participant API as Next.js routes
  participant DB as Postgres
  participant S as Storage
  U->>API: POST init with bearer token and metadata
  API->>DB: Find owned unfinished match or insert file
  API-->>U: fileId and optional resumed flag
  U->>API: GET status
  API->>DB: Read all saved indices and checksums
  API-->>U: Saved state
  par Piece i
    U->>API: POST chunk with index and SHA-256
    Note over API: Verify checksum and parent state
    API->>S: Upsert piece object
    API->>DB: Upsert file_chunks metadata
    API-->>U: Piece acknowledged
  and Other pieces
    U->>API: Concurrent chunk requests
    Note over U,API: At most five workers total
  end
  U->>API: GET status to verify all indices
  U->>API: POST complete
  API->>DB: Check metadata indices and sizes
  API->>S: List objects and verify presence and sizes
  API->>DB: Mark COMPLETED and set storage_path
  API-->>U: completed true
  Note over U: Show completed only after this response
```

Each chunk is checked and saved independently; the current client defers finalization until its explicit complete request.

Chunk workers hash locally with Web Crypto, upload multipart bodies through Axios,
and retry up to three total attempts. Client requests send `deferCompletion=1` so
old saved metadata cannot complete a reused file before mismatched pieces have
been replaced. Legacy requests without that flag can trigger the same completion
helper inside the chunk route. A late request for an already completed file gets
success after normal input/checksum validation, without rewriting Storage.

Completion is metadata finalization, not assembly of a new object. It paginates
piece metadata and Storage listings, verifies all indices and aggregate sizes,
and records `chunks/<fileId>` as the download source. It does not re-hash stored
objects or compute a whole-file hash at completion.

## Pause and resume

```mermaid
sequenceDiagram
  participant U as Browser uploader
  participant API as Next.js routes
  participant DB as Postgres
  Note over U: Pause invalidates run and aborts requests
  Note over API: A server write may still finish
  Note over U: Resume waits for the previous pool to drain
  U->>API: GET status with no-store
  API->>DB: Read file_chunks indices and checksums
  API-->>U: Latest saved indices
  Note over U: Skip saved indices for this selection
  U->>API: POST only missing pieces
  API-->>U: Acknowledge each saved piece
```

Resume uses fresh server state after the previous run drains, so an accepted request with a lost response is not blindly resent.

The File and ID live in the uploader closure while it is mounted. `abort(false)`
on navigation/unmount stops local work but retains pieces on the server. A fresh
page needs the user to choose the local file again; it cannot silently reopen the
browser's previous File object.

### Choose the same file after reload

```mermaid
flowchart LR
  Pick[Choose local file] --> Init[Init with owner and fingerprint]
  Init --> Reuse{Unfinished match?}
  Reuse -->|no| New[Create new record]
  Reuse -->|yes| Verify[Hash saved local pieces]
  Verify --> Match{Checksum matches?}
  Match -->|yes| Skip[Skip saved piece]
  Match -->|no or missing| Send[Upload replacement]
  New --> Send
```

Reselection reuses the newest matching owned unfinished record and skips only pieces whose local checksums match the status response.

The fingerprint is filename, total size, total piece count and MIME type, plus the
verified owner. It is a lookup hint, not a content hash. Completed and Bin records
are excluded. The current lookup/insert is not a transaction or unique-fingerprint
claim; concurrent initializations/writers are a remaining limitation.

## Upload state machine

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> init: Choose file
  init --> uploading: Init and saved-piece verification
  init --> error: Initialization fails
  uploading --> paused: Pause
  paused --> uploading: Resume current selection
  paused --> init: Resume reused selection
  uploading --> processing: All pieces verified
  uploading --> error: Request or status fails
  processing --> completed: Server confirms completion
  processing --> error: Completion fails
  error --> uploading: Retry current selection
  error --> init: Retry reused selection
  uploading --> idle: Cancel
  paused --> idle: Cancel
  init --> idle: Cancel
  processing --> idle: Cancel
  error --> idle: Cancel
  completed --> idle: Upload another file
```

The normal UI flow distinguishes bytes sent from saved pieces and waits in processing for explicit server completion.

Retry is offered only when an upload ID is retained. `processing` is a client
state; the court additionally uses `finishing` while all bytes are sent or the
completion request is pending. Those are not Postgres statuses. Browser errors do
not themselves write the database status `FAILED`.

## Database ER diagram

```mermaid
erDiagram
  files ||--o{ file_chunks : "logical file_id relation"
  files {
    unspecified id PK "logical identifier; base DDL absent"
    unspecified filename
    unspecified total_size
    unspecified total_chunks
    unspecified mime_type
    unspecified status
    unspecified storage_path
    unspecified created_at
    timestamptz deleted_at "checked-in SQL"
    uuid user_id FK "references auth.users"
  }
  file_chunks {
    unspecified file_id FK "logical relation; base FK DDL absent"
    unspecified chunk_index "expected unique with file_id"
    unspecified chunk_size
    unspecified checksum
  }
```

This is the schema contract used by the code, with unknown base-column types explicitly marked unspecified.

`PK`/the `file_id` relation in this diagram express the logical keys required by
lookups, not independently verified base-table constraints. Only `user_id`'s
foreign key and the two extension indexes are defined in the supplied SQL.
See [database reference](database.md) for the exact evidence and fresh-setup gap.

## Download flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Download route
  participant DB as Postgres
  participant S as Storage
  B->>API: GET files/fileId/download
  API->>DB: Read file metadata
  Note over API: Require completed and not deleted
  alt Chunk-backed record
    API->>S: Read piece zero before response headers
    loop Numeric piece order, one piece per pull
      API->>S: Read next piece when needed
      API-->>B: Stream bytes
    end
    Note over API,B: Check total bytes and omit Range support
  else Legacy merged record
    API->>S: Create signed download URL
    API-->>B: Redirect to signed URL
  end
```

Chunk-backed downloads stream numeric piece order without building a whole-file buffer; legacy merged records use a signed redirect.

The first read happens before headers, allowing an HTTP error for a missing first
piece. Later failures error the response stream after a 200 has begun. Cancelling
a download propagates an abort signal and stops subsequent reads. Content-Length,
Content-Disposition, private no-store, nosniff and Accept-Ranges: none are set on
chunk-backed responses. The route verifies byte totals, not a whole-file digest.

## Court mapping

```mermaid
flowchart LR
  Requests[Axios chunk requests] --> Observer[Activity observer]
  Observer --> Bridge[Upload bridge]
  Saved[Uploader uploadedChunks diff] -->|deduplicated saved index| Bridge
  Bridge --> Floor[Floor balls]
  Floor -->|piece starts| Hover[Hover with ring]
  Hover -->|confirmed index| Shot[Assigned ball scores]
  Hover -->|pause or final failure| Floor
  Shot --> Basket[Return basket]
  Bridge -->|cancel reset| Idle[Idle inventory]
```

The scene borrows floor balls for real request activity, but only saved-index events authorize scoring.

The inventory is capped at 40 balls; confirmed visual shares are
`floor(savedPieces * min(totalPieces,40) / totalPieces)`. Above 40 pieces, a partial
share returns its borrowed ball instead of creating a shot. Floor, hovering and
confirmed shares stay conserved; confirmed includes queued shots, arcs and the
basket pile. Idle uses 24 balls; Files/Bin use ten calm balls. The landing demo has
its own explicitly separate bridge and does not upload data.

Retries retain a hover until the final attempt fails. Pause releases unsaved
hovers while confirmed arcs can finish. Hidden/off-screen scenes stop drawing;
return reconciles confirmed work without a long replay. Reduced motion, scene
errors and unavailable WebGL leave DOM status/controls and static fallback
progress usable. `src/lib/courtScene.ts` is an older 2D implementation; the current
CourtCanvas imports the Three.js implementation in `src/lib/court/scene.ts`.
