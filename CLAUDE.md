# Impression

A WebGPU painting application with a Rust/WASM drawing engine and React UI.

## Architecture

- **React frontend** (`src/`): UI components (Radix UI + Tailwind CSS + Lucide icons), WebGPU canvas, layer compositing
- **Rust WASM backend** (`crates/impression-core/`): Brush engine, layer pixel buffers, alpha blending
- **Shaders** (`shaders/`): WGSL compositing shader

### Frontend stack

- **React 19** with Vite (via `@vitejs/plugin-react`)
- **Radix UI** primitives: Slider, ToggleGroup, Popover, Tooltip
- **Tailwind CSS 4** with custom theme tokens (defined in `src/index.css` `@theme` block)
- **Lucide React** for icons (Paintbrush, Hand, ZoomIn, etc.)
- **react-colorful** for color picker

### Visual design: Soft Graphite

The UI follows the **Soft Graphite** design language — a warm, muted dark theme inspired by paper and pencil. Key principles:

- **Warm grays** with visible brown undertones (not blue-gray). Palette defined as `graphite-50` through `graphite-950` in `src/index.css` `@theme` block. The base panel color (`graphite-900` = `#302b28`) is set at ~18% luminance so the warmth reads clearly on uncalibrated monitors.
- **Cream text** tones (`cream`, `cream-dim`, `cream-muted`) instead of pure white/gray.
- **Rounded corners** throughout (10px buttons, 8px controls, rounded-lg panels).
- **Soft shadows** (`shadow-soft`, `shadow-panel`, `shadow-inset`) with warm-tinted `rgba(30, 20, 10, ...)` instead of pure black `rgba(0, 0, 0, ...)`. Preferred over hard borders for visual depth.
- **Generous padding** — panels use `px-4 py-4`/`pt-4 pb-5`, controls have `gap-3.5` spacing.
- **Panel dividers** — `border-t border-graphite-850` between sections. Sidebar edges use `border-l`/`border-r border-graphite-850`.
- **Thick slider tracks** (6px) with inset shadow, large 16px thumbs that scale on hover.
- **Overlapping color swatches** — FG (larger, front) overlaps BG (smaller, behind).
- **150ms transitions** with `ease-out` for smooth, tactile interactions.
- **Section headers** — 11px, medium weight, `text-cream-muted`, wide tracking, uppercase.
- The aesthetic keeps the interface quiet so the artwork takes center stage.

When modifying or adding UI components, follow these patterns. Use the `graphite-*` and `cream-*` color tokens. Prefer `shadow-soft` over borders. Use `transition-all duration-150 ease-out` for interactive states. Use `border-graphite-850` for dividers between panel sections.

### Data flow

1. Pointer events captured in `CanvasViewport.tsx`, transformed from screen to canvas coordinates (accounting for pan/zoom)
2. Events dispatched based on active tool: brush → engine stroke calls, pan → view translate, zoom → view scale
3. Rust interpolates points along stroke path, stamps anti-aliased circles into layer RGBA buffers
4. Engine reads dirty layer pixels from WASM memory (zero-copy), uploads to WebGPU textures
5. Compositor renders fullscreen triangles per layer with alpha-over blending

### Key modules

**Rust** (`crates/impression-core/src/`):
- `brush.rs` — Point interpolation (pressure-dependent spacing), circle rasterization
- `layer.rs` — Per-layer RGBA pixel buffer with dirty tracking
- `canvas.rs` — Layer stack (add/remove), brush settings, stroke state
- `color.rs` — Alpha-over compositing math
- `lib.rs` — wasm_bindgen API surface

**TypeScript** (`src/`):
- `engine.ts` — Bridge between WASM and WebGPU (stroke forwarding, layer sync, texture upload)
- `gpu.ts` — WebGPU device/pipeline/texture management
- `compositor.ts` — WebGPU render pass for layer compositing

**React components** (`src/components/`):
- `App.tsx` — Root layout: toolbar, canvas viewport, right panel
- `CanvasViewport.tsx` — Pannable/zoomable canvas container, tool-aware input handling
- `Toolbar.tsx` — Tool selection (brush, pan, zoom) using Radix ToggleGroup
- `BrushSettingsPanel.tsx` — Sliders for size, spacing, flow, opacity
- `ColorDisplay.tsx` — Foreground/background color swatches with Radix Popover color picker
- `LayerPanel.tsx` — Layer list with add/remove/select
- `SliderControl.tsx` — Reusable labeled slider (wraps Radix Slider)

**Hooks** (`src/hooks/`):
- `useEngine` — WASM + WebGPU initialization, render loop, returns Engine instance
- `useViewTransform` — Pan/zoom state (tx, ty, scale)
- `useTool` — Active tool selection
- `useBrushSettings` — Brush parameters, synced to engine
- `useColorState` — Foreground/background colors, synced to engine
- `useLayerManager` — Layer list state (add, remove, select)

### React + WebGPU integration

The `Engine` instance is created imperatively in `useEngine` and stored as React state. It is **not** part of React's reconciliation — React controls the UI; the engine owns the GPU. React callbacks call imperative `engine.setXxx()` methods. The `requestAnimationFrame` render loop runs outside React.

## Build & Run

```bash
npm run build:wasm    # Compile Rust to WASM (output: src/wasm/)
npm run dev           # Build WASM + start Vite dev server
npm run build         # Production build
```

Prerequisites: `wasm-pack`, `rustup target add wasm32-unknown-unknown`, Node.js 22+

## Testing

**Every behavior change must include corresponding tests.** This applies to both Rust and TypeScript code.

```bash
npm run test:rust     # Rust unit tests (cargo test)
npm run test          # TypeScript tests (vitest)
npm run test:all      # Both
```

### Rust tests

Located alongside source code in `#[cfg(test)] mod tests` blocks within each `.rs` file. Key test areas:

- `brush.rs` — Interpolation correctness, pressure-dependent spacing, circle rasterization, flow/opacity, residual distance carry-over
- `layer.rs` — Pixel buffer initialization, dirty flag, bounds checking
- `canvas.rs` — Layer management (add/remove), stroke forwarding
- `color.rs` — Alpha-over compositing math

### TypeScript tests

Located in `src/__tests__/`. Uses vitest with happy-dom environment. WebGPU globals (`GPUTextureUsage`, `GPUShaderStage`, `GPUBufferUsage`) must be mocked in tests that touch `gpu.ts`.

- `engine.test.ts` — WASM wrapper, dirty layer syncing, brush settings forwarding, layer removal
- `input.test.ts` — Pointer event translation, coalesced events, pressure defaults
- `compositor.test.ts` — Render pass creation, layer visibility
- `hooks.test.ts` — Utility functions (hexToRgb)
- `viewport.test.ts` — Screen-to-canvas coordinate transform math

## Brush behavior

- **Spacing** is pressure-dependent: `step = spacing × size × pressure`. Lower pressure produces smaller circles with tighter spacing to maintain stroke density.
- **Flow** controls per-stamp alpha. **Opacity** controls whole-stroke alpha (applied at compositing via layer opacity).
- Circle rasterization uses smoothstep anti-aliasing at the edge.
