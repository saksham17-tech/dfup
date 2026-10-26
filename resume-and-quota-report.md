# Resume and quota fixes

## Findings before changes

1. Status already read `file_chunks`, the same table the chunk route writes, with pagination beyond 1,000 rows, `Cache-Control: no-store`, and client `cache: 'no-store'`. A wrong table, capped query or cached response was not the source defect found here. It now returns the checksum for every saved index too.
2. Both full-bar and pill Resume controls already called `resume()`, not `start()`.
3. FileUploader already constructed its uploader in a mount-only effect; minimize/expand and ordinary re-renders do not recreate it. Auth state changes that keep the dashboard ready do not recreate it either. Navigating to Files/Bin actually unmounts FileUploader; reload/remount loses the in-memory File and ID. Its cleanup called abort, and init always inserted a new record when that file was chosen again. That restart path was confirmed in source. Fingerprint reuse now reconnects it to saved pieces.
4. File and ID were retained during a plain Pause/Resume in the mounted uploader. The previous generation check already suppressed many stale results, but Pause did not bump it, and Resume did not wait for the previous pool to drain. The new run could overlap old requests; this confirmed race is fixed by serialized runs and generation invalidation on pause, cancel, start and resume.
5. The exact reported browser-only incident was not reproduced against live Supabase, so a definitive cause for that specific click cannot be claimed. The old source did not inherently restart every ordinary same-instance Resume from chunk zero. The fixes cover the observed restart/remount path and the shutdown overlap race.

Quota used `status != FAILED`, so it counted unfinished UPLOADING rows excluded by the completed-file list. It now counts only COMPLETED, non-deleted files and disables response caching.

## Implementation

- Client runs are serialized, retain their own selection/File/ID and ignore stale progress/errors. A cancelled init's late ID is retained just long enough to discard it. `abort(false)` leaves stored pieces for reselection; default Cancel uses an authenticated, keepalive DELETE after the old run drains.
- Init reuses the newest matching unfinished record for the authenticated owner, excluding completed/deleted records. The client verifies every saved local piece against status checksums while showing Preparing. Mismatches are sent again; the final status must contain every piece and, for reused records, the verified checksums.
- Client chunk requests defer automatic completion. Explicit completion runs only after all replacement pieces finish; otherwise existing metadata could complete a reused upload while mismatched pieces were still being replaced. Legacy chunk requests retain their previous completion behavior. Completed records still acknowledge late chunks without storing them.
- Cancel first conditionally marks an owned unfinished record unavailable, preventing concurrent completion from claiming it, then removes its stored objects, metadata and row. Completed owned files return 409; non-owned/unknown IDs return 404. Late chunk requests check for a discarded parent after Storage finishes.
- Shared cleanup lists every stored object before deleting batches, then removes metadata and the record. Permanent deletion uses that helper too. Cleanup supports age filtering, hours=0, pagination and partial-error counts.
- The existing middleware is pass-through. Automatic approval review rejected unauthenticated deletion and then deletion without ownership. The final implementation requires a verified Supabase identity and owner match for Cancel, and a separate server-only operator token for bulk cleanup. No security approval is outstanding.
- `supabase/upload-ownership.sql` adds nullable `files.user_id` and an unfinished-owner lookup index. A read-only check confirmed the configured database already has the column. The migration was not executed here. Existing unowned rows are deliberately not claimed by matching filenames; operator cleanup can remove those legacy attempts.
- Court, dock layout, drawer, sidebar, piece size (4 MB), checksum algorithm, five-worker pool, retry policy and streamed downloads remain unchanged. FileUploader changes are limited to auth-token supply and the required abort(false) calls.

## Acceptance results

| Check | Result and evidence |
| --- | --- |
| 1. 100 MB+, pause around 40%, resume only missing pieces | Passed in an actual-uploader transport simulation using a 104 MB File (26 pieces). Paused after 10 acknowledgements (38.5%); one old request was accepted during shutdown. Resume waited for all old requests, status listed indices 0-10 (11/26), and the resumed pool sent exactly 11-25. Maximum five active workers, no error and no duplicate confirmed-piece upload. This was not a real browser Network-tab/Supabase run. |
| 2. Reload/reselect same file | Route tests prove newest same-owner fingerprint reuse; a fresh client verifies and skips matching saved pieces. Navigation abort(false) makes no discard request. Full browser reload with live Supabase was not tested. |
| 3. Different bytes, same name/size | Client tests re-upload mismatched saved indices, skip matching ones, and verify final checksums. Server test confirms replacements cannot auto-complete prematurely. |
| 4. Cancel mid-upload | Tests remove 1,002 pieces plus an extra leftover object and both metadata tables; completed/other-owner files remain untouched. Cancel during init discards the late-created ID with keepalive. No live user upload was deleted. |
| 5. No completed files means zero usage and an empty list | Route tests include UPLOADING, FAILED and deleted COMPLETED rows and return usedBytes=0, fileCount=0 and an empty list. Adding an active completed record counts exactly its bytes. |
| 6. Required checks | 59 tests passed; TypeScript, lint and production build passed. Initial sandboxed build hit EPERM writing generated files; the permitted build retry succeeded. |

Status and client resume retain the requested `[upload]` console.info diagnostics. Tests include auth rejection, owner boundaries, checksum pagination, init reuse exclusions, missing-piece Retry errors, late responses, cancellation, cleanup age filtering, and existing court/download regressions.

## Clear existing abandoned uploads

Do this while uploads are stopped: hours=0 deliberately removes **all** UPLOADING and FAILED records, including recent resumable uploads. It never targets COMPLETED records. This action was not run here.

1. Configure a random server-only `UPLOAD_CLEANUP_TOKEN` (at least 32 characters) in `.env.local` and restart the app. Apply the ownership migration if needed. Do not put the operator secret in browser code.
2. In PowerShell, enter that same secret when prompted, then call the local app (adjust port if needed):

```powershell
$cleanupToken = Read-Host -MaskInput 'Server cleanup token'
Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3000/api/upload/cleanup?hours=0' `
  -Headers @{ Authorization = "Bearer $cleanupToken" }
Remove-Variable cleanupToken
```

A successful response is `{ ok: true, removed: N }`. The usual maintenance call omits hours or uses `?hours=24`. If Storage deletion fails, metadata remains available for a retry and the response reports how many uploads were already removed.

3. The route removes Storage objects associated with those records. For folders whose database row was already deleted before this fix, run this **read-only** query in the Supabase SQL editor (replace dfup if your bucket differs):

```sql
select o.name
from storage.objects o
left join public.files f on f.id::text = split_part(o.name, '/', 2)
where o.bucket_id = 'dfup'
  and o.name like 'chunks/%/%'
  and f.id is null
order by o.name;
```

Review the returned names and remove only those exact objects in the Storage dashboard (or the Storage SDK's `.remove(reviewedNames)`, in batches of 100). Do not remove the entire chunks directory: completed downloads use it. Do not delete storage.objects rows directly; use Storage deletion so the actual object data is removed. Pause other writers while auditing/removing orphans.

## Live verification limitation

No signed-in `UPLOAD_TEST_ACCESS_TOKEN` was configured, so the authenticated live upload and browser Network-tab inspection could not run. The read-only schema check changed no records. No ownership migration, cleanup call, deletion of existing uploads, or production deployment was performed.

For an opt-in real 104 MB engine test, apply any needed migration, start the app on port 3001, supply a signed-in user's access token in the local `UPLOAD_TEST_ACCESS_TOKEN` environment variable, then run:

```powershell
node scripts/verify-court-live.cjs --run-live
```

That script uploads and byte-checks synthetic data, exercises a transport retry and pause/resume, and removes only its own generated upload. It does not replace the requested manual browser reload/Network-tab acceptance checks.

## Files changed

- `src/lib/upload.ts`, `src/components/FileUploader.tsx`: serialized runs, verified reuse, authenticated init/cancel, non-discarding unmount/completion reset.
- `src/app/api/upload/init/route.ts`, `[fileId]/status/route.ts`, `[fileId]/chunk/route.ts`, `usage/quota/route.ts`: reuse, checksum status/logging, deferred completion and completed-only quota.
- `src/app/api/upload/[fileId]/route.ts`, `cleanup/route.ts` (new), `src/lib/chunkCleanup.ts`, `uploadAuth.ts` (new): scoped cancellation and operator cleanup.
- `src/app/api/upload/files/[fileId]/route.ts`: shared permanent-delete helper.
- `supabase/upload-ownership.sql` (new), `.env.example`: ownership migration and operator configuration.
- `tests/upload-client.test.cjs`, `upload-storage.test.cjs`, `helpers/upload-fixtures.cjs`, `court.test.cjs`: regression tests/mocks.
- `scripts/verify-court-live.cjs`, `README.md`, this report: authenticated live-test setup and operational instructions.
