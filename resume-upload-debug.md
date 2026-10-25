# Resume-upload bug: restarts from 0% after pause

## Root cause
- Chunk route (`/api/upload/[fileId]/chunk`) saves progress in table **`file_chunks`**.
- Status route (`/api/upload/[fileId]/status`) queried a table named **`chunks`** (doesn't exist).
- The query errored, the "fallback" queried the same wrong table, returned `[]`.
- On Resume, `uploadMissing()` calls `apiStatus()`, saw 0 uploaded chunks, and re-sent everything.
- Status route also never returned `status` / `totalChunks`, which the client expects.

## Fix
`src/app/api/upload/[fileId]/status/route.ts` now reads `file_chunks`, and returns
`{ status, totalChunks, uploadedChunks }` with `Cache-Control: no-store`.
`src/lib/upload.ts`: status fetch uses `cache: 'no-store'`.

## Expected remaining behavior
Pausing aborts in-flight chunks (up to 5 x 4 MB), so only those partial chunks re-upload.
Completed chunks are skipped.

## Also changed
- `FileUploader.tsx`: uploader is now created once (onSuccess held in a ref), so a parent re-render can no longer reset fileId/paused state mid-upload.

## Other notes
- Page refresh / closing the tab loses `fileId` (kept only in memory), so resume after reload isn't possible yet.
  Fix: store `{fileId, name, size}` in localStorage and re-match the file on re-select.
