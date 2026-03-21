# Architecture

Impression uses a hybrid architecture combining a high-performance Rust/WASM drawing engine with a React/WebGPU frontend.

## Overview

- **React frontend** (`src/`): UI components (Radix UI + Tailwind CSS 4 + Lucide icons), WebGPU canvas, layer compositing
- **Rust WASM backend** (`crates/impression-core/`): Brush engine, selection mask, layer pixel buffers, alpha blending
- **Shaders** (`shaders/`): WGSL compositing shader + selection marching ants shader

## Data Flow

1. Pointer events captured in `CanvasViewport.tsx`, transformed from screen to canvas coordinates (accounting for pan/zoom via viewport-local conversion).
2. Events dispatched based on active tool: brush → engine stroke calls, marquee/lasso → selection mask operations, pan → view translate, zoom → view scale, eyedropper → color sampling.
3. Rust interpolates points along stroke path, stamps anti-aliased circles into layer RGBA buffers (clipped by selection mask if active).
4. Engine reads dirty layer pixels from WASM memory (zero-copy), uploads to WebGPU textures.
5. Compositor renders fullscreen triangles per layer with alpha-over blending, then selection overlay with marching ants.

## React + WebGPU Integration

The `Engine` instance is created imperatively in `useEngine` and stored as React state. It is **not** part of React's reconciliation — React controls the UI; the engine owns the GPU. React callbacks call imperative `engine.setXxx()` methods. The `requestAnimationFrame` render loop runs outside React.

> [!CAUTION]
> **CRITICAL RULE: Never call engine methods inside React state updater functions** (e.g., `setState(prev => { eng.doThing(); ... })`). 

The WASM object uses `RefCell` borrowing — if React synchronously re-renders during the updater, the render loop will try to borrow the same object, causing a "recursive use of an object detected" panic. 

Instead, read current state from a ref, call `setState(newValue)`, then call the engine *after*:

```typescript
// WRONG — engine call inside updater
setFoo(prev => { eng.update(prev + 1); return prev + 1; });

// RIGHT — engine call outside updater
const next = fooRef.current + 1;
fooRef.current = next;
setFoo(next);
eng.update(next);
```

## Key Modules

### Rust (`crates/impression-core/src/`)
- `brush.rs` — Point interpolation (pressure-dependent spacing), elliptical stamp rasterization with hardness/roundness/angle, custom brush tip images with bilinear interpolation, selection mask clipping. `BrushTip` struct for custom grayscale alpha masks.
- `layer.rs` — Per-layer RGBA pixel buffer with dirty tracking
- `canvas.rs` — Layer stack, brush settings, stroke state, selection mask, color sampling (composites all visible layers)
- `color.rs` — Alpha-over compositing math
- `selection.rs` — `SelectionMask` struct with `fill_rect`, `fill_polygon` (scanline rasterization), combine modes (Replace/Add/Subtract/Intersect)
- `lib.rs` — wasm_bindgen API surface
- `oplog.rs` / `replay.rs` / `operation.rs` — Operation logging and undo/redo capabilities via command pattern. Serialized via Postcard format.

### TypeScript (`src/`)
- `engine.ts` — Bridge between WASM and WebGPU. Includes stroke forwarding, layer sync, selection mask sync, color sampling, texture upload.
- `gpu.ts` — WebGPU device/pipeline/texture management. Includes selection overlay pipeline and `r8unorm` selection texture.
- `compositor.ts` — WebGPU render pass for layer compositing + selection marching ants overlay (time-animated)

### Shaders (`shaders/`)
- `composite.wgsl` — Fullscreen triangle, samples layer texture, applies layer opacity uniform
- `selection.wgsl` — Edge detection on selection mask (neighbor sampling), animated diagonal stripe marching ants pattern
- `gradient_map.wgsl` — Adjustment layer rendering using a 1D gradient texture based on luma

### React Components (`src/components/`)
- `CanvasViewport.tsx` — Pannable/zoomable canvas container, tool-aware input handling. **Important**: coordinates passed to `zoom()` must be viewport-local (subtract viewport rect), not raw `clientX/clientY`, or the zoom anchor will drift.
- `Toolbar.tsx` — Tool selection (marquee, lasso, brush, eyedropper, pan, zoom) using Radix ToggleGroup
- `BrushPicker.tsx` — Brush preset picker with group display and ABR import button
- `DocumentPicker.tsx` — Painting list with rename, delete, open; integrates `NewDocumentDialog`
- `NewDocumentDialog.tsx` — Radix Dialog for creating new paintings with size presets

### Hooks (`src/hooks/`)
- `useEngine` — WASM + WebGPU initialization, render loop (passes `time` for marching ants animation)
- `useViewTransform` — Pan/zoom state. Zoom math keeps anchor point fixed: `newTx = centerX - (centerX - prev.tx) * (newScale / prev.scale)`
- `useTool` — Active tool with keyboard shortcuts.
- `useSelection` — Cmd/Ctrl+A (select all), Cmd/Ctrl+D (deselect) keyboard shortcuts
- `useDocumentManager` — Document CRUD, IndexedDB persistence, hash-based URL routing
- `useBrushSettings`, `useColorState`, `useLayerManager` — State synced to engine
- `useBrushPresets` — Brush preset management (IndexedDB), per-tool preset tracking, ABR import
