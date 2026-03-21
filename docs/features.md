# Feature Details

This document covers application-specific feature details and UI implementations.

## Visual Design System: Soft Graphite

Impression uses the **Soft Graphite** design language — a warm, muted dark theme inspired by paper and pencil.

Key principles:
- **Warm grays** with brown undertones (not blue-gray). Palette: `graphite-950` (#242020) through `graphite-500` (#8d8278). Base panel color `graphite-900` = `#302b28` (~18% luminance).
- **Cream text** tones (`cream`, `cream-dim`, `cream-muted`) instead of pure white/gray.
- **Soft shadows** with warm-tinted `rgba(30, 20, 10, ...)` instead of pure black. Preferred over hard borders.
- **150ms transitions** with `ease-out`. 10px button corners, 8px controls.
- **Section headers** — 11px, medium weight, `text-cream-muted`, wide tracking, uppercase.
- All color tokens defined in `src/index.css` `@theme` block.

When adding UI components: use `graphite-*` and `cream-*` tokens, `shadow-soft` over borders, `transition-all duration-150 ease-out`, `border-graphite-850` for dividers, `px-4 py-4` panel padding.

## URL Routing

Hash-based routing is used for GitHub Pages SPA compatibility (no server-side routing available). Implemented in `useDocumentManager.ts` via `parseRoute()` and `setRoute()`.

| Route | View | Description |
|-------|------|-------------|
| `#/` | Painting picker | Lists recent paintings, create new |
| `#/painting/{uuid}` | Canvas editor | Open painting by ID |

Navigation uses `history.replaceState` to avoid polluting the browser history stack. On initial load, the app checks the URL hash and auto-opens a painting if a valid UUID is found.

**Terminology:** User-facing text uses "painting" (not "document"). Code identifiers may still use "document" internally.

## Tools & Keyboard Shortcuts

Shortcuts intentionally match standard Photoshop keybinds.

**Permanent switch (tap key):**
- `M` — Marquee (rectangular selection)
- `L` — Lasso (freehand polygon selection)
- `B` — Brush
- `I` — Eyedropper
- `H` — Hand (pan)
- `Z` — Zoom

**Spring-loaded (hold key >200ms, reverts on release):**
All tool keys above support spring-loaded mode.

**Always-temporary (hold, always reverts):**
- `Space` — Pan (from any tool)
- `Alt/Option` while on Brush → Eyedropper
- `Alt/Option` while on Pan → Zoom

**Selection modifiers (while using Marquee or Lasso):**
- No modifier — Replace selection
- `Shift` — Add to selection
- `Alt/Option` — Subtract from selection
- `Shift+Alt` — Intersect with selection

**Global shortcuts:**
- `Cmd/Ctrl+A` — Select all
- `Cmd/Ctrl+D` — Deselect
- `Cmd/Ctrl+Shift+E` — Export as PNG
- `Cmd/Ctrl+Shift+N` — New layer
- `Cmd/Ctrl+Z` — Undo
- `Cmd/Ctrl+Shift+Z` — Redo
- `Cmd/Ctrl+0` — Fit on screen
- `Cmd/Ctrl+=` / `Cmd/Ctrl++` — Zoom in
- `Cmd/Ctrl+-` — Zoom out
- `X` — Swap foreground/background colors
- `D` — Default colors (black/white)
- `Delete/Backspace` — Clear active layer
- `[` / `]` — Decrease/increase brush size
- `1–9, 0` — Set opacity (10%–100%)
- `Shift+1–9, 0` — Set flow (10%–100%)

## Brush Behavior

- **Spacing** is pressure-dependent: `step = spacing × size × pressure`. Lower pressure → smaller circles with tighter spacing.
- **Flow** controls per-stamp alpha. **Opacity** controls whole-stroke alpha.
- **Hardness** (0.0–1.0) controls the falloff gradient. `inner_r = r * hardness`; full alpha inside inner_r, smoothstep to outer edge.
- **Roundness** (0.01–1.0) squashes the brush into an ellipse.
- **Angle** (0–360°) rotates the brush parameters.
- **Custom brush tips** are grayscale alpha masks stamped with bilinear interpolation, scaled to the current radius.
- Circle/ellipse rasterization uses smoothstep anti-aliasing at the edge.
- When a selection is active, brush strokes are clipped to the selected region.

## Brush Presets and ABR Import

- Named brush presets organized into groups, stored in `brush_presets` IndexedDB store.
- Each preset specifies tip type (computed circle or custom tip image), size, spacing, roundness, angle, and optional flow/opacity.
- Brush and eraser track their own active preset independently.
- The Rust engine sets parameters dynamically; "presetting" them is handled by the UI mapping.
- **ABR import**: Photoshop .abr files (version 6+) can be imported. The parser extracts brush tip images from `samp` sections and creates presets in a group named after the file.
