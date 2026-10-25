# Basketball v2 implementation and verification

## Implementation

Added `three` and `@types/three` as the only direct dependencies. The scene uses
vanilla Three.js, custom fixed-step sphere physics and procedurally generated
textures. No image, model, HDRI, physics engine or post-processing package was added.

The asynchronous scene is independent of upload controls and has both an error
boundary and imperative failure handling. Reduced motion and failure use the
static gradient plus ChunkStrip. Real saved pieces feed a deduplicating emitter;
the landing demo has a separate emitter. No v2 changes were made to API routes,
`src/lib/upload.ts` or Supabase modules. Earlier merge-failure changes remain intact.

## Files changed for v2

- `src/lib/court/physics.ts`: seeded, fixed-step sphere solver, friction, spin,
  sleep/nudges, collisions and bounded catch-up.
- `src/lib/court/uploadBridge.ts`: deduplication, phases, reset and subscriptions.
- `src/lib/court/shots.ts`: ballistic shots, paused queues, grouping, catch-up and
  single completion celebration.
- `src/lib/court/textures.ts`, `scene.ts`, `fallback.ts`: procedural materials,
  instancing, contact/real shadows, hoop/net, quality adaptation and resource cleanup.
- `src/components/CourtCanvas.tsx`, `CourtEnvironment.tsx`, `CourtProgress.tsx`:
  lazy loading, error boundary, live motion preference and independent progress UI.
- `FileUploader.tsx`, `HeroDemo.tsx`, `FileDashboard.tsx`, landing page, dashboard
  layout and `globals.css`: bridges, glass panels, scrim and retained controls.
- Package files, `DESIGN.md`, README, court tests, TypeScript test-loader JSX support,
  `scripts/lint.cjs`, and the explicit opt-in live verification script.

## Checks

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed. The repository previously had `next lint` with no ESLint
  installation/configuration. It now uses TypeScript-parser rules for syntax,
  debugger statements, var declarations, equality, duplicate properties and explicit
  any in court code. This is a small repository-owned linter, not an ESLint setup.
- `npm test`: 39 tests passed. This includes the 22 existing upload/storage checks,
  physics invariants, bridge/shot behavior, reduced-motion changes, static fallback,
  visibility, context-loss/error cleanup and one-way quality adaptation.
- `npm run build`: passed. Landing first-load JS is about 111 kB; Three.js is lazy.
  Login remains about 170 kB and has no court canvas.
- Official DESIGN.md lint: no errors or warnings.
- Existing broad static UI audit still reports the login form's missing validation
  ownership/noValidate declaration at `src/app/login/page.tsx:116`. Login behavior
  was not changed as part of this scene feature.

## Requested scenario results

| Scenario | Result and evidence |
|---|---|
| File over 100 MB, one shot per confirmed piece | **Live protocol + bridge passed.** Generated 104 MiB file: 26 unique confirmations, 26 settled pieces, byte-exact streamed download verified by SHA-256. Its file record and chunks were then removed. The authenticated dashboard card was not exercised because the browser session redirected to login. |
| Pause, wait, Resume | **Live protocol passed.** Paused after five confirmations, resumed after 1.2 seconds, and completed with no duplicate/missing events. Landing pause at 26 and Replay were also observed in the browser. Queued-shot pause and active-arc completion have unit coverage. |
| Cancel mid-upload | **Automated coverage passed.** Reset clears active/queued shots and the pile; uploader cancellation tests ensure late callbacks cannot replace idle. Authenticated Cancel-button interaction remains a manual check. |
| Network failure and retry | **Live injected transport failure passed.** Piece 3 failed once before server confirmation, retried against real Storage, and emitted exactly one saved event. The live server was not killed or network-throttled mid-body. |
| Hide tab for 30 seconds | **Automated scene-lifecycle simulation passed.** The real scene handler with a GPU adapter stops frames, receives confirmations while hidden, advances a 30-second test clock, and returns with a settled pile instead of a backlog. Native OS/tab switching during a real upload remains a manual check. |
| Toggle reduced motion | **Automated native-media-event and SSR fallback checks passed.** The actual matchMedia change listener switches state and cleans up. An OS preference was not toggled manually during the authenticated upload. |
| Block WebGL or throw during init | **Browser init-failure check passed.** `?webgl=0` produced zero WebGL canvases, 48 chunk cells, continuing accessible progress, working Replay and one warning. Frame-error and context-loss cleanup passed automated lifecycle checks. |
| FPS/tier readout | **Browser checked.** `?perf=1` showed 60 FPS, high tier, 28 balls at 1920×1080; 60 FPS, medium tier, 12 balls at 390×844. No horizontal overflow. These are measurements on this desktop browser, not a guarantee for mobile hardware. |

The built production app also rendered at 60 FPS with 28 balls at 1280×720, with
no console warnings/errors. Under prolonged verification and screenshot load it
stepped down to medium and displayed about 59–60 FPS with 22 balls, exercising the
one-way quality policy. Production initial landing/login chunks were inspected
and did not contain the WebGLRenderer code.

## Deliberate simplifications and limits

- O(n²) collision impulses for at most 28 decorative balls; no WASM engine.
- A lightweight shader sways the net, as permitted by the brief.
- Pile placement uses compact deterministic slots rather than simulating every saved
  piece as a rigid body. More than 64 pieces are grouped visually; exact UI counts
  remain server-confirmed counts.
- Optional depth-of-field and heavy effects are omitted. Quality only steps down.
- Body copy uses a stronger scrim and glass captions mix muted with ink. Conservative
  contrast calculations over a black backdrop are about 4.73:1 for hero body copy
  and 4.66:1 for glass captions; large headings and controls have higher contrast.
- Full authenticated browser upload interactions and actual OS visibility/preference
  changes remain manual checks, as distinguished above.
