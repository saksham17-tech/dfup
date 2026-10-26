# Basketball court v3 verification

Implemented in the existing uploader and court. No changes to `src/app/api/**`, `src/lib/upload.ts`, or `src/lib/supabase*.ts`; no dependency changes.

## Changed files

- `src/lib/court/scene.ts`, `physics.ts`, `shots.ts`, `textures.ts`, `uploadBridge.ts`: edge-to-edge hardwood, camera framing, settling floor inventory, shared scoring balls, grouped confirmations, basket, keep-outs and browse mode. Fixed late-loading backlog double-counting.
- `src/components/FileUploader.tsx`, `CourtProgress.tsx`: compact bottom dock, one status line, 6 px track, session-persistent minimize, whole-window file drop, existing uploader controls.
- `src/components/DashboardFrame.tsx` (new), `src/app/dashboard/layout.tsx`: 64 px desktop rail expanding to 256 px without pushing content; existing mobile drawer and authentication.
- `src/components/RecentFiles.tsx` (new), `DashboardClient.tsx`, `FileDashboard.tsx`: modal recent-files drawer, five newest files, browse mode and glass tables.
- `src/components/CourtEnvironment.tsx`, `src/app/globals.css`, `src/app/page.tsx`: remove global scrim, local glass surfaces and court fallback.
- `tests/court.test.cjs`, `tests/court-lifecycle.test.cjs`: confirmation, inventory, geometry, late loading, settling and real uploader markup regression coverage.
- `DESIGN.md`, `README.md`, this report: current behavior and verification.

## Checks completed

- `npx tsc --noEmit`: passed.
- `npm test`: 46 tests passed. Expected storage-failure messages are emitted by deliberate failure tests.
- `npm run lint`: passed (40 TypeScript/TSX source files).
- `npm run build`: passed. The initial sandboxed attempt could not create generated type directories; the permitted retry succeeded.
- Simulated 104 MB (26 pieces) and 208 MB (52 pieces) server-confirmation sequences exercise the real scene, bridge, physics and shot code. After every confirmation, the rendered floor-instance count equals `min(total,40) - floor(saved * min(total,40) / total)`. Duplicate confirmations do not consume extra balls. Pause/failure preserve the count; resume completes the pile; cancel restores 24 balls. Browse restores 10.
- Existing uploader tests cover failed completion, retry without re-sending saved pieces, pause/resume, cancellation and late responses. Existing scene tests cover hidden tabs, quality changes, context loss, reduced motion, static fallback and cleanup.
- Shot tests preserve the selected floor ball's origin/radius and verify the ballistic rim intersection. Idle physics settles and disabled floor balls stop moving.
- Production-browser DOM at 1920x1080 and 1366x768 confirms a fixed court canvas fills the available viewport (excluding the browser scrollbar), with zero `.court-scrim` elements. Real Three.js camera/ray tests at both sizes confirm all four corners intersect hardwood inside the camera range; hoop/backboard extents stay visible above a 110 px bottom clearance.
- The actual FileUploader markup with production CSS was measured in an in-memory static harness, without adding a route or file: upload bar 640 x 71.6 px at both desktop sizes; 366.4 x 71.6 px at 390x844; progress track 6 px; minimized pill 42 px high. One saved status line. SSR tests verify finishing/errors replace that line.
- Earlier development UI review verified idle dock 640 x 50 px, minimized pill 42 px, session persistence, rail keyboard expansion to 256 px with main content remaining at 64 px, recent drawer focus containment, Escape and focus return.
- Temporary development review route, component and local synthetic file were removed. Production route output contains no review page. The exact prior synthetic upload ID was checked against the completed-file list and was already absent. No user uploads were deleted.

## Performance and limits

Calculated text contrast on 80% glass over the wood token and white: ink at least
13.82:1, muted 5.00:1, cobalt 6.24:1 and alert 4.94:1. These token checks exceed
4.5:1; they are not a full screenshot-based accessibility audit.

Earlier idle-dashboard review measured 60-61 FPS with 24 balls at high quality (1280x720). This continuation's production landing demo measured 46-50 FPS at medium quality with 40 balls; quality adapts downward. These are local browser observations, not a device-wide performance guarantee.

A real 100 MB+ browser/Supabase upload was not re-tested: the prior browser file chooser stalled. The large-file acceptance path was verified through deterministic confirmation simulation, as requested in the continuation note. Supabase integration was not asserted from these mocked tests. The authenticated dashboard was not signed into again; its shared presentation was checked in the prior temporary review page and its actual uploader markup was re-measured statically. Long error text may grow the dock to remain readable. Mobile browsers and physical low-end GPUs were not tested.
