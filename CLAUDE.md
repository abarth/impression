# Impression

A WebGPU painting application with a Rust/WASM drawing engine and React UI. Deployed to GitHub Pages at `https://abarth.github.io/impression/`.

## Architecture

- **React frontend** (`src/`): UI components (Radix UI + Tailwind CSS 4 + Lucide icons), WebGPU canvas, layer compositing
- **Rust WASM backend** (`crates/impression-core/`): Brush engine, selection mask, layer pixel buffers, alpha blending
- **Shaders** (`shaders/`): WGSL compositing shader + selection marching ants shader

### Data flow

1. Pointer events captured in `CanvasViewport.tsx`, transformed from screen to canvas coordinates (accounting for pan/zoom via viewport-local conversion)
2. Events dispatched based on active tool: brush → engine stroke calls, marquee/lasso → selection mask operations, pan → view translate, zoom → view scale, eyedropper → color sampling
3. Rust interpolates points along stroke path, stamps anti-aliased circles into layer RGBA buffers (clipped by selection mask if active)
4. Engine reads dirty layer pixels from WASM memory (zero-copy), uploads to WebGPU textures
5. Compositor renders fullscreen triangles per layer with alpha-over blending, then selection overlay with marching ants

### React + WebGPU integration

The `Engine` instance is created imperatively in `useEngine` and stored as React state. It is **not** part of React's reconciliation — React controls the UI; the engine owns the GPU. React callbacks call imperative `engine.setXxx()` methods. The `requestAnimationFrame` render loop runs outside React.

## Build & Run

```bash
npm run build:wasm    # Compile Rust to WASM (output: src/wasm/)
npm run dev           # Start Vite dev server (auto-rebuilds WASM on Rust file changes)
npm run build         # Production build (WASM + Vite)
```

Prerequisites: `wasm-pack`, `rustup target add wasm32-unknown-unknown`, Node.js 22+

The Vite config includes a `wasmPackWatch` plugin that watches `crates/impression-core/src/**/*.rs` and automatically runs `wasm-pack build` when Rust files change during dev.

**After modifying Rust code, the WASM must be rebuilt** for changes to take effect in the browser. The dev server handles this automatically, but CI and production builds use `npm run build:wasm` explicitly.

## Testing

**Every behavior change must include corresponding tests.** This applies to both Rust and TypeScript code.

```bash
npm run test:rust     # Rust unit tests (cargo test)
npm run test          # TypeScript tests (vitest)
npm run test:all      # Both
```

### Rust tests

Located alongside source code in `#[cfg(test)] mod tests` blocks within each `.rs` file.

### TypeScript tests

Located in `src/__tests__/`. Uses vitest with happy-dom environment. WebGPU globals (`GPUTextureUsage`, `GPUShaderStage`, `GPUBufferUsage`) must be mocked in tests that touch `gpu.ts`. React hooks tests use `@testing-library/react` with `renderHook`/`act`. Time-dependent tests (spring-loaded shortcuts) use `vi.useFakeTimers()`.

## Key modules

**Rust** (`crates/impression-core/src/`):
- `brush.rs` — Point interpolation (pressure-dependent spacing), circle rasterization with selection mask clipping. `stamp_circle` accepts `Option<&[u8]>` selection mask.
- `layer.rs` — Per-layer RGBA pixel buffer with dirty tracking
- `canvas.rs` — Layer stack, brush settings, stroke state, selection mask, color sampling (composites all visible layers)
- `color.rs` — Alpha-over compositing math
- `selection.rs` — `SelectionMask` struct with `fill_rect`, `fill_polygon` (scanline rasterization), combine modes (Replace/Add/Subtract/Intersect)
- `lib.rs` — wasm_bindgen API surface

**TypeScript** (`src/`):
- `engine.ts` — Bridge between WASM and WebGPU. Includes stroke forwarding, layer sync, selection mask sync, color sampling, texture upload.
- `gpu.ts` — WebGPU device/pipeline/texture management. Includes selection overlay pipeline and `r8unorm` selection texture.
- `compositor.ts` — WebGPU render pass for layer compositing + selection marching ants overlay (time-animated)

**Shaders** (`shaders/`):
- `composite.wgsl` — Fullscreen triangle, samples layer texture, applies layer opacity uniform
- `selection.wgsl` — Edge detection on selection mask (neighbor sampling), animated diagonal stripe marching ants pattern

**React components** (`src/components/`):
- `CanvasViewport.tsx` — Pannable/zoomable canvas container, tool-aware input handling. **Important**: coordinates passed to `zoom()` must be viewport-local (subtract viewport rect), not raw `clientX/clientY`, or the zoom anchor will drift.
- `Toolbar.tsx` — Tool selection (marquee, lasso, brush, eyedropper, pan, zoom) using Radix ToggleGroup
- `DocumentPicker.tsx` — Painting list with rename, delete, open; integrates `NewDocumentDialog`
- `NewDocumentDialog.tsx` — Radix Dialog for creating new paintings with size presets

**Hooks** (`src/hooks/`):
- `useEngine` — WASM + WebGPU initialization, render loop (passes `time` for marching ants animation)
- `useViewTransform` — Pan/zoom state. Zoom math keeps anchor point fixed: `newTx = centerX - (centerX - prev.tx) * (newScale / prev.scale)`
- `useTool` — Active tool with keyboard shortcuts (see below)
- `useSelection` — Cmd/Ctrl+A (select all), Cmd/Ctrl+D (deselect) keyboard shortcuts
- `useDocumentManager` — Document CRUD, IndexedDB persistence, hash-based URL routing
- `useBrushSettings`, `useColorState`, `useLayerManager` — State synced to engine

## Tools & keyboard shortcuts (matching Photoshop)

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

## Visual design: Soft Graphite

Warm, muted dark theme inspired by paper and pencil. Key principles:

- **Warm grays** with brown undertones (not blue-gray). Palette: `graphite-950` (#242020) through `graphite-500` (#8d8278). Base panel color `graphite-900` = `#302b28` (~18% luminance so warmth reads on uncalibrated monitors).
- **Cream text** tones (`cream`, `cream-dim`, `cream-muted`) instead of pure white/gray.
- **Soft shadows** with warm-tinted `rgba(30, 20, 10, ...)` instead of pure black. Preferred over hard borders.
- **150ms transitions** with `ease-out`. 10px button corners, 8px controls.
- **Section headers** — 11px, medium weight, `text-cream-muted`, wide tracking, uppercase.
- All color tokens defined in `src/index.css` `@theme` block.

When adding UI components: use `graphite-*` and `cream-*` tokens, `shadow-soft` over borders, `transition-all duration-150 ease-out`, `border-graphite-850` for dividers, `px-4 py-4` panel padding.

## Brush behavior

- **Spacing** is pressure-dependent: `step = spacing × size × pressure`. Lower pressure → smaller circles with tighter spacing to maintain stroke density.
- **Flow** controls per-stamp alpha. **Opacity** controls whole-stroke alpha (applied at compositing via layer opacity).
- Circle rasterization uses smoothstep anti-aliasing at the edge.
- When a selection is active, brush strokes are clipped to the selected region (selection mask alpha multiplied into stamp alpha).

## URL routing

Hash-based routing is used for GitHub Pages SPA compatibility (no server-side routing available). Implemented in `useDocumentManager.ts` via `parseRoute()` and `setRoute()`.

| Route | View | Description |
|-------|------|-------------|
| `#/` | Painting picker | Lists recent paintings, create new |
| `#/painting/{uuid}` | Canvas editor | Open painting by ID |

**Planned future routes:**
- `#/login` — Authentication page
- `#/settings` — User preferences

Navigation uses `history.replaceState` to avoid polluting the browser history stack. On initial load, the app checks the URL hash and auto-opens a painting if a valid UUID is found.

**Terminology:** User-facing text uses "painting" (not "document"). Code identifiers may still use "document" internally (e.g., `DocumentMeta`, `useDocumentManager`).

## Deployment

GitHub Pages via `.github/workflows/deploy.yml`. Pushes to `main` trigger: install Rust toolchain + wasm-pack → `npm ci` → `npm run build:wasm` → `npx vite build` → deploy to Pages. Base path is `/impression/` (set in `vite.config.ts`).
