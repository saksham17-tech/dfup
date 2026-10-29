# API reference

[Back to README](../README.md) · [Architecture](architecture.md)

All paths are same-origin Next.js App Router handlers under `/api/upload`.
`{id}` means a file ID, not a chunk index. Error bodies normally contain `error`;
cleanup additionally returns `ok: false` and the partial `removed` count.
Responses below are handler contracts or explicitly labelled fixture examples,
not a claim that a live authenticated upload was performed for these docs.

## Authentication

| Label | Actual check |
| --- | --- |
| User + owner | Bearer access token validated by Supabase Auth getUser. Init records the user ID and scopes reuse to it; cancel filters user_id before modifying data. |
| Operator | Bearer token compared with server-only UPLOAD_CLEANUP_TOKEN (at least 32 characters), using a timing-safe comparison after length checking. |
| None | No auth or ownership validation in that handler. The middleware is pass-through and the service-role DB/Storage client bypasses ordinary browser policies. |

The dashboard's client session redirect is not an API security boundary. Treat the
unprotected file/status/chunk/complete routes as a deployment gap, not as privately
scoped routes merely because their UI is behind sign-in.

## All routes and methods

| Method | Path | Purpose | Query/body | Success | Explicit error statuses | Auth |
| --- | --- | --- | --- | --- | --- | --- |
| POST | /api/upload/init | Create or reuse owned unfinished record | JSON filename, totalSize, totalChunks, mimeType | 201 `{fileId}` new; 200 `{fileId,resumed:true}` reused | 400, 401, 500 | User + owner |
| GET | /api/upload/{id}/status | Fresh saved-piece metadata | None | 200 `{status,totalChunks,uploadedChunks,checksums}` | 404, 500 | None |
| POST | /api/upload/{id}/chunk | Verify/store one piece | chunkIndex, checksum, optional deferCompletion=1; multipart chunk | 201 `{ok,chunkIndex,uploadedChunks,totalChunks,completed,storagePath}`; 200 if already completed | 400, 404, 409, 500 | None |
| POST | /api/upload/{id}/complete | Verify all pieces and finalize metadata | No body required | 200 `{ok,completed,uploadedChunks,totalChunks,storagePath}` | 404, 409, 500 | None |
| DELETE | /api/upload/{id} | Discard owner's unfinished upload | None | 200 `{ok:true}` | 401, 404, 409, 500 | User + owner |
| POST | /api/upload/cleanup | Discard aged unfinished uploads | hours defaults 24; 0 means all unfinished | 200 `{ok:true,removed}` | 400, 401, 500 | Operator |
| GET | /api/upload/files/list | List completed active/Bin files | bin=1 selects Bin | 200 array of file rows | 500 | None |
| GET | /api/upload/files/{id}/download | Stream pieces or redirect legacy download | None | 200 byte stream; 307 signed URL redirect | 400, 404, 409, 500 before streaming | None |
| DELETE | /api/upload/files/{id} | Move to Bin or permanently delete | permanent=true deletes objects/rows; otherwise soft delete | 200 `{success:true}` | 404 for absent permanent target; 500 | None |
| PATCH | /api/upload/files/{id} | Restore by clearing deleted_at | Body ignored; UI sends action=restore | 200 `{success:true}` | 500 | None |
| GET | /api/upload/usage/quota | Completed non-Bin metadata totals | None | 200 `{usedBytes,fileCount}` | 500 | None |

This table lists explicit handler errors, not platform-generated errors such as a
host rejecting an oversized request. Soft delete and restore can report success
when no row matches; they do not check affected-row count. Permanent delete does
not require the target to be in the Bin first.

## Create/reselect an upload

Init requires a nonempty trimmed filename, positive safe-integer totalSize, and a
safe-integer totalChunks equal to ceil(totalSize / 4194304). MIME defaults to
application/octet-stream. Zero-byte files are rejected. Despite the wording of its
piece-count error, a merely positive but incorrect count is also rejected.

The newest match must have the same owner, filename, total size, total chunks and
MIME type, status UPLOADING or FAILED, and deleted_at null. COMPLETED rows are
never reused. These filters do not provide atomic cross-tab deduplication.

Example request template (replace the user token; no real credential is included):

```javascript
const response = await fetch('/api/upload/init', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer <USER_ACCESS_TOKEN>',
  },
  body: JSON.stringify({
    filename: 'example.bin', totalSize: 4194305, totalChunks: 2,
    mimeType: 'application/octet-stream',
  }),
});
const result = await response.json();
```

New response: `{"fileId":"<FILE_ID>"}` (201). A reused response additionally has
`resumed: true` (200). When reused, the client hashes each saved local piece before
trusting the matching index; missing/mismatched checksums cause replacement uploads.

## Status

```javascript
const response = await fetch('/api/upload/<FILE_ID>/status', { cache: 'no-store' });
const saved = await response.json();
```

`uploadedChunks` is an array of zero-based indices. `checksums` is an object keyed
by their string indices. The route pages file_chunks in batches of 1,000, ignores
invalid/out-of-range indices, deduplicates them and returns Cache-Control: no-store.
The route logs the saved/total count. This method does not verify Storage objects.

Fixture-verified handler response for a four-byte, one-piece example:

```json
{
  "status": "UPLOADING",
  "totalChunks": 1,
  "uploadedChunks": [0],
  "checksums": {
    "0": "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119"
  }
}
```

## Upload a piece

Request template; `piece` is a Blob slice and `checksum` its local SHA-256 hex:

```javascript
const piece = new Blob(['example']);
const digest = await crypto.subtle.digest('SHA-256', await piece.arrayBuffer());
const checksum = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
const body = new FormData();
body.append('chunk', piece, 'chunk-0');
const response = await fetch(`/api/upload/<FILE_ID>/chunk?chunkIndex=0&checksum=${checksum}&deferCompletion=1`, {
  method: 'POST', body,
});
```

The existing file record must describe that same file; the example Blob is only a
multipart/hash illustration. Let the browser set the multipart Content-Type and
boundary. The application uses Axios for byte-progress events rather than this
minimal fetch template.

The server hashes the received bytes, compares the checksum, validates the parent
record and index, then upserts Storage at chunks/id/index and file_chunks metadata.
It rechecks parent availability after Storage writes to notice cancellation.
`uploadedChunks` in this **response is a count**, unlike the status response array.

The current client sends deferCompletion=1. Without it, a full metadata count can
invoke the completion helper inside this route; a 409 incomplete/damaged state
there is deferred to the explicit complete request. Other failures can return 500
even after a piece became durable. Retrying an already COMPLETED record returns
200 success without storing, after the normal input and checksum checks.

## Complete

```javascript
const response = await fetch('/api/upload/<FILE_ID>/complete', { method: 'POST' });
const result = await response.json();
```

The client checks `completed === true`, not just HTTP success or 100% bytes sent.
The helper validates file state, complete/consistent piece metadata, total bytes,
and numeric Storage object availability/sizes. It then records a chunk prefix
without downloading/merging/re-uploading a full file. Already completed records
with a storage path return success idempotently. FAILED is recoverable if its
pieces are intact.

Fixture-verified one-piece result:

```json
{"ok":true,"completed":true,"uploadedChunks":1,"totalChunks":1,"storagePath":"chunks/test-file"}
```

Missing/conflicting indices, a size mismatch, Bin state or damaged/missing objects
produce 409. Database/Storage-service failures and invalid stored sizes produce
500; absent files produce 404.

## Cancel an unfinished upload

```javascript
const response = await fetch('/api/upload/<FILE_ID>', {
  method: 'DELETE', keepalive: true,
  headers: { Authorization: 'Bearer <USER_ACCESS_TOKEN>' },
});
```

A matching owner and unfinished status are required. Completed owned records
return 409; absent/non-owned targets return 404. Cancellation conditionally marks
the parent deleted before deleting objects, chunk rows and the file row. It lists
all objects first, then removes batches of at most 100, avoiding offset skips.
A Storage failure retains metadata for retry; this can leave an unfinished row
marked unavailable until operator cleanup succeeds.

The UI fires this request after its old run drains. Its response is not awaited
by the Cancel button; failures are warned in the console. `abort(false)` for
unmount or Upload another file does not request server discard.

## File list, quota and download

```javascript
const files = await (await fetch('/api/upload/files/list')).json();
const bin = await (await fetch('/api/upload/files/list?bin=1')).json();
const quota = await (await fetch('/api/upload/usage/quota')).json();
```

Each list row has id, filename, totalSize, mimeType, storagePath, createdAt,
deletedAt and downloadUrl. Only COMPLETED rows are included. Default sorting is
created_at descending; Bin uses deleted_at descending. New chunk-backed active
rows point at the same-origin download route. Legacy active rows get a 3,600-second
signed URL; Bin downloadUrl is null. Signing failures can leave downloadUrl null.

Quota is `{usedBytes,fileCount}` for non-deleted COMPLETED metadata rows and is
no-store. Neither this query nor the list is owner-filtered or paginated by the
handler; large results can be limited by the Supabase response row cap.

Download is an ordinary anchor/navigation to `/api/upload/files/<FILE_ID>/download`.
It requires COMPLETED, a storage path and deleted_at null. Chunk-backed responses
stream indices in numeric order, check the final byte count and use private
no-store, attachment filename, nosniff and Accept-Ranges: none. A missing first
piece can return 500 before headers; later errors fail the stream after headers.
Legacy merged records redirect (307) to a 60-second signed download URL.

## Bin actions

These request templates mutate data; use only an upload you intend to modify:

```javascript
await fetch('/api/upload/files/<FILE_ID>', { method: 'DELETE' });
await fetch('/api/upload/files/<FILE_ID>', { method: 'PATCH' });
await fetch('/api/upload/files/<FILE_ID>?permanent=true', { method: 'DELETE' });
```

The first sets deleted_at; PATCH clears it regardless of body. Permanent deletion
removes paginated chunk objects, a legacy merged object if present, file_chunks
rows and finally the files row. These three operations currently have **no auth
or ownership check**. No automatic Bin expiry job is checked in, despite five-day
wording in the UI.

## Operator cleanup

Configure a server-only UPLOAD_CLEANUP_TOKEN with at least 32 random characters and
restart the app. Stop active uploads before using hours=0: it deliberately discards
all UPLOADING/FAILED rows, including recent resumable work and unowned legacy rows.
It never targets COMPLETED rows. Default hours is 24; allowed numeric values are
0 through 876000. Age uses created_at, not last progress.

PowerShell request template; no operator secret is included or fetched for you:

```powershell
$cleanupToken = Read-Host -MaskInput 'Configured server cleanup token'
Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3000/api/upload/cleanup?hours=0' `
  -Headers @{ Authorization = "Bearer $cleanupToken" }
Remove-Variable cleanupToken
```

Success is `{"ok":true,"removed":N}`. A failure includes the count already removed,
so deletion is not an all-or-nothing transaction. Candidates are listed with
pagination before deletion; records that completed/disappeared meanwhile are
skipped. This destructive template was not run on live data for the docs.

The route removes objects associated with records. It cannot discover a prefix
whose parent row was already deleted. For those leftovers, the following read-only
SQL audit from the existing report remains applicable (adjust the bucket name):

```sql
select o.name
from storage.objects o
left join public.files f on f.id::text = split_part(o.name, '/', 2)
where o.bucket_id = 'dfup'
  and o.name like 'chunks/%/%'
  and f.id is null
order by o.name;
```

Review returned names and remove only those exact objects through the Storage
dashboard or SDK `.remove(reviewedNames)`, in batches of 100. Never delete all of
chunks/ or delete Storage metadata directly. Keep other writers paused during the
audit. The original investigation is [resume-and-quota-report.md](../resume-and-quota-report.md).
