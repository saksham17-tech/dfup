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
The dashboard keeps its existing sidebar and document scrolling. The fixed canvas
and scrim are portaled to the document so they cover the sidebar without acquiring
a card's stacking context. Login has no scene or scene imports.

## Elevation & Depth
Light glass panels, a one-pixel line border and a stable scrim protect text contrast.
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

## Do's and Don'ts
Keep controls opaque enough to read and focus rings above scenery. Use a bounded,
fixed physics timestep and reusable instance buffers. Honor live reduced-motion
changes, pause hidden scenes and dispose resources. Never infer confirmed pieces
from transferred bytes, retry attempts, decorative balls or animation time.
