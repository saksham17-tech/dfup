# In-flight balls: implementation and verification

## Confirmation path checked first

The uploader already adds an index to its completed set only after the chunk POST
succeeds. Its real uploadedChunks diff drives bridge.chunkSaved(index); byte
progress does not count as saved. A new regression test was added and passed before
the visual changes: sequence 0, 1, 2 launches three balls; replaying a duplicate
produces no additional launch. No engine/API defect was established from the
available evidence, so src/lib/upload.ts and every API route remain unchanged.

No signed-in UPLOAD_TEST_ACCESS_TOKEN was configured. Therefore the requested live
100 MB+ Supabase timing run and server-log diagnosis could not be performed. There
are no measured typical/slowest live confirmation times to report, and no verified
claim that requests are failing or Storage is slow. The observed byte/saved gap is
consistent with requests awaiting server acknowledgement; that is not proof of a
server problem.

## What changed

- src/lib/uploadActivity.ts (new): scoped Axios request/response observation. It
  tracks real piece indices, keeps retry assignments, drops final failures, ignores
  stale/unrelated requests and records per-attempt timing. An acknowledged ball is
  retained briefly until the uploader's actual saved diff consumes it. It never
  changes requests, progress, retries or upload decisions. Timer/interceptors are
  removed on unmount.
- src/components/FileUploader.tsx: mount the observer alongside the existing
  uploader; feed activity indices to the court. One uploading status line now
  reads, for example, `5 uploading · 0 of 52 saved · 20.0 MB sent`. Pending pieces
  older than ten seconds replace it with `Waiting for the server…` in normal ink.
  Existing paused, error and final-confirmation messages retain their precedence.
  Progress is labelled Bytes sent; fallback strips do not invent activity.
- src/lib/court/uploadBridge.ts: activity snapshots/events with a five-piece cap,
  saved-index deduplication and phase/reset cleanup.
- src/lib/court/shots.ts: stable piece-to-ball assignments, a half-second lift into
  the launch line, gentle hovering, out-of-order confirmation from that ball's
  current position, and restoration on pause/failure. Saved shots retain the
  existing stagger, queue bound, ballistic flight and basket/completion behavior.
- src/lib/court/scene.ts: shared floor-body ownership, cobalt activity rings,
  original-position return drops, correct basket ordinals and preserved resources.
  Return drops can settle during an error while confirmed scoring arcs remain
  frozen until Retry.
- tests/court.test.cjs, court-lifecycle.test.cjs, upload-client.test.cjs: regression
  coverage for the full lifecycle, dock text, real Axios adapter identity and timer
  cleanup, alongside the existing upload/storage tests.
- scripts/verify-court-live.cjs: the opt-in 104 MB test now observes the same activity
  and prints every attempt duration plus median/maximum successful confirmation
  times. It still requires a signed-in test token and removes only its own data.
- DESIGN.md, README.md and this report document the behavior.

No dependencies were added. The temporary development review page was removed
before the final production build.

## Inventory rules

Up to 40 pieces, each active index owns its own physical floor ball, including its
radius, rotation and original floor location. Only confirmation can turn that
assigned hover into a scoring arc. Duplicate acknowledgements do nothing.

Above 40 pieces, the existing grouped formula stays in effect:
confirmed visual shares = floor(saved pieces * 40 / total pieces). A confirmation
that earns the next share shoots its own assigned ball. A partial share releases
its borrowed ball back to the floor. Thus the visible counts obey:

floor + hovering + confirmed = min(total pieces, 40).

Confirmed includes acknowledged balls queued for a shot, currently scoring or
already in the basket; basket-only count is tracked separately. This preserves the
inventory while the staggered animation catches up. Hidden-tab reconciliation
fast-forwards confirmed shots and preserves the current unsaved hover assignments.
Idle reset restores 24 balls; Files/Bin retain ten calm balls without activity.

## Acceptance checks

| Requested check | Result |
| --- | --- |
| 1. TypeScript, tests, build | npx tsc --noEmit, all 67 tests, npm run lint and npm run build passed. |
| 2. Real upload: lift within a second, own ball scores on confirmation | The real transport observer and real Axios adapter are tested; scene tests verify assigned ball identity and the half-second lift. A deterministic browser review showed five ringed hover balls, then the assigned piece-2 ball scoring out of order. The authenticated live 100 MB+ upload was not run, so end-to-end live startup latency remains unverified. |
| 3. Pause/resume | Browser review showed all four remaining hover balls return and lift again. Tests verify original floor ownership, no repeated/lost confirmed shots, retry retention and final-failure return. Returned balls finish their bounce even after a final error. |
| 4. Cancel | Real-scene tests verify zero hovering/scoring balls and restored idle inventory. Transport tests verify stale callbacks cannot revive cleared activity. Browser review used a bridge reset; no live upload was cancelled. |
| 5. Hide for 30 seconds | Real scene lifecycle tests stop rendering, confirm an out-of-order piece while hidden, update pending indices and return after a 30-second gap. Counts remain conserved and rings match current activity. No replay/freeze occurred in the harness. |
| 6. Confirmation times and limitations | Live typical/slowest times are unavailable without a signed-in session. Fake-clock tests verify duration accounting (including a 250 ms fixture), ten-second waiting text and retry behavior; these fixture values are not network measurements. |

The deterministic browser review measured about 60 FPS at high quality with a
26-ball inventory at 1280x720. It performed no upload requests and does not measure
Supabase performance. A saved screenshot shows four hovering pieces and one saved
ball after confirming piece 2 and resuming.

Reduced-motion and no-WebGL paths keep activity information in the dock. Existing
fallback, hidden-tab, context-loss, disposal, upload resume/quota and streaming
regressions still pass. Physical mobile devices and slow GPUs were not tested.

## Run the live timing check

Start the application on port 3001 with the required ownership schema available.
Supply a signed-in Supabase user access token in the local environment variable
UPLOAD_TEST_ACCESS_TOKEN, then run:

```powershell
node scripts/verify-court-live.cjs --run-live
```

The console logs each piece's request start and successful/failed attempt duration,
then prints the median and slowest successful attempt. A successful HTTP response
is timed here; the court still waits for the real saved-index diff before scoring.
No token or file contents are logged. This check creates a synthetic 104 MB file,
exercises retry and pause/resume, checks its streamed bytes and deletes its own
synthetic upload. No existing user uploads or database settings were changed in
this implementation session.
