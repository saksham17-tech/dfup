# Vault redesign notes

## Idea
A file is cut into pieces, and resume skips the pieces already saved. The UI shows this as a **chunk strip**: one segment per piece (grouped into at most 64 segments for big files). Saved pieces fill in cobalt, missing pieces are hatched, and pieces in flight pulse.

## Tokens (src/app/globals.css)
- paper `#eef0ec`, surface `#f8f9f6`, ink `#16201c`, muted `#5b655f`, line `#d2d8cf`
- cobalt `#2438e6` (saved pieces, active actions), alert `#b8321f`
- Fonts: Bricolage Grotesque (headings), Hanken Grotesk (body)
- Light theme only. The old dark theme is gone.

## What changed
- `layout.tsx`, `globals.css`: new fonts and tokens
- `page.tsx` + `HeroDemo.tsx`: landing page with a pause/resume demo (static when reduced motion is on)
- `login/page.tsx`: split layout, plain labels, accessible errors
- `dashboard/layout.tsx`: flat sidebar, mobile drawer (the old sidebar was open on phones)
- `FileUploader.tsx`: chunk strip, working drag and drop, Retry after an error, plain status lines
- `FileDashboard.tsx`: table-style list, extension tags, a proper delete dialog, and a confirm step before deleting from the bin
- New: `ChunkStrip.tsx`, `Wordmark.tsx`, `src/lib/ui.ts` (shared buttons and formatters)

## Unchanged
All API routes, `upload.ts` logic and Supabase code. The resume fix from before is still in.

## Not touched
`BinView.tsx` is unused by the app and still has the old styling.

## Setup
`npm install`, keep your `.env.local`, then `npm run dev`. Fonts load from Google Fonts at build/dev time, so the first run needs internet.
