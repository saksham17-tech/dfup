# DISTRIBUTED FILE UPLOAD SYSTEM

Resumable chunked uploads with a landing page, Supabase auth, and a Google Drive–style dashboard.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Landing / hero |
| `/login` | Email/password + Google OAuth |
| `/dashboard` | Protected shell (Upload / My Files / Shared) |
| `/api/upload/*` | Chunked upload API |

## Setup

1. Create Supabase tables `files` and `file_chunks`, bucket `dfup`.
2. Copy `.env.example` → `.env.local` and set:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (server)
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser auth)
3. Enable Email and Google providers in Supabase Auth; set redirect URL to `http://localhost:3000/dashboard`.

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Upload engine

- 4 MB chunks, 5 concurrent, SHA-256, 180s timeout, 3× retry
- Smooth byte-level progress via axios `onUploadProgress`
- Completed uploads keep their objects at `chunks/{fileId}/{chunkIndex}`. The final
  record points at `chunks/{fileId}`; no whole-file merge or second upload occurs.
- `POST /api/upload/{fileId}/complete` verifies piece metadata and stored objects,
  then marks the file complete. This call is safe to retry and can recover an old
  `FAILED` upload when all its pieces remain intact.
- Downloads stream pieces in numeric order through the server with memory bounded
  to a piece at a time. Older files at `merged/...` keep their signed-URL downloads.
  Large downloads remain subject to the hosting platform's response-duration limits.
- Permanent deletion removes stored pieces (including partial uploads), any legacy
  merged object, and chunk metadata before deleting the file record.

## Regression checks

`npm test` uses Node's built-in test runner and the existing TypeScript compiler.
Tests isolate Supabase and HTTP calls; they never read credentials or modify live data.

After deploying this change, restart the dev server and refresh the page. If a failed
upload is still selected, Retry can complete it when its saved pieces are intact. If
the page has forgotten the old upload ID or pieces are missing from Storage, upload
the file again. Existing failed records are not automatically deleted.

## Basketball backdrop

The landing demo and dashboard use a lazy-loaded Three.js court. Login has no court.
Reduced motion, renderer errors and unavailable WebGL keep the static gradient and
accessible chunk strip. Confirmed upload pieces drive their own deduplicated event
bridge; decorative ball physics never changes upload progress.

- `?seed=123` makes the decorative simulation reproducible.
- `?perf=1` shows measured FPS, quality tier and decorative ball count.
- `?webgl=0` forces the initialization-failure fallback for verification.
- `npm run lint` runs dependency-free source rules using the installed TypeScript parser.
- `node scripts/verify-court-live.cjs --run-live` explicitly opts into a synthetic
  104 MB integration upload against a local server on port 3001. It tests retry,
  pause/resume, confirmed-piece counts and a byte-exact download, then removes only
  its own generated upload and chunks. Ordinary `npm test` never touches live data.

See [basketball-v2-report.md](basketball-v2-report.md) for verification and limitations.
