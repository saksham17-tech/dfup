---
version: alpha
colors:
  primary: "#2438e6"
  paper: "#eef0ec"
  surface: "#f8f9f6"
  ink: "#16201c"
  muted: "#5b655f"
  line: "#d2d8cf"
  cobalt: "#2438e6"
  alert: "#b8321f"
  ball: "#e8651a"
  ball-dark: "#b84a0f"
  rim: "#d8381f"
  court-wood: "#cfa879"
  court-wood-soft: "#d6bc98"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
rounded:
  panel: "8px"
  control: "6px"
omitted:
  - section: spacing
    reason: "Existing Tailwind spacing utilities remain canonical."
  - section: components
    reason: "Shared button recipes remain in src/lib/ui.ts."
---

# Vault

## Overview
Vault is a resumable file uploader. Dashboard task clarity leads; a sports-court
backdrop gives the landing page and upload workflow a shared, memorable identity.
The court is scenery. Saved-piece text, byte progress, errors and controls remain
independent DOM content, available when the renderer fails.

## Colors
The hand-authored `@theme static` block in `src/app/globals.css` owns runtime tokens.
This document mirrors them; Tailwind utilities and the canvas's computed CSS reads
consume that same source. Orange represents basketballs, cobalt represents upload
progress/actions, and alert marks failure. Procedural maple and physical lighting
belong only to the scene, never to semantic UI colors.
The documentation's `primary` role is an alias for the existing `--color-cobalt`.

## Typography
Use Bricolage Grotesque for headings and Hanken Grotesk for body and controls.
Use tabular numerals for progress, counts and performance information.

## Layout
The landing content remains capped at the existing six-column-equivalent width.
The dashboard uses a 64 px desktop icon rail that expands to 256 px on hover or
keyboard focus without moving content. Mobile retains the drawer. The fixed canvas
is portaled to the document and fills every viewport corner with hardwood. There
is no global scrim. Login has no scene or scene imports.

## Elevation & Depth
Local glass panels, backdrop blur and a one-pixel line border protect text contrast.
Scene depth comes from perspective, varied sphere sizes, contact shadows and warm
maple. No bloom, heavy post-processing, external imagery or audio.

## Shapes
Preserve the existing eight-pixel panel and six-pixel control radii. The progress
bar is slim, cobalt and segmented; reduced motion and scene failure use ChunkStrip.

## Components
`CourtEnvironment` owns lazy loading, motion preferences, fallback and boundaries.
`CourtProgress` owns the accessible progress readout. `uploadBridge` translates
server-confirmed indices into events and never supplies progress back to React.
The landing demo owns a separate emitter explicitly marked demo.
The upload dock is fixed at bottom center, capped at 640 px, with one status line
and a 6 px progress track. A session-persistent pill offers compact controls;
finishing and errors always restore the readable full dock. Recent files uses a
native modal drawer with five newest files and a link to the full table.
Idle balls settle after an initial drop. Uploads reserve the actual floor inventory
(up to 40 balls), grouped by confirmed pieces above 40; reserved balls retain their
position, radius and rotation as they score. Files and Bin use ten calm balls.
Actual chunk requests borrow up to five floor balls into a gently hovering launch
line with cobalt rings. Confirmed indices launch their own assigned ball; retries
retain it, and pause/final failure return it to its original floor spot. The three
inventory states remain conserved, including the capped, grouped inventory above
40 pieces. A transport observer supplies activity only; saved indices still own
all scoring. The dock distinguishes uploading, saved and bytes sent, and shows a
normal-colour waiting message after ten seconds. Reduced motion and unavailable
WebGL keep these explanations in the dock without activity animation.

## Do's and Don'ts
Keep controls opaque enough to read and focus rings above scenery. Use a bounded,
fixed physics timestep and reusable instance buffers. Honor live reduced-motion
changes, pause hidden scenes and dispose resources. Never infer confirmed pieces
from transferred bytes, retry attempts, decorative balls or animation time.
