# Impression

A WebGPU painting application with a Rust/WASM drawing engine.

## Architecture

- **TypeScript frontend** (`src/`): WebGPU canvas, input handling, layer compositing
- **Rust WASM backend** (`crates/impression-core/`): Brush engine, layer pixel buffers, alpha blending
- **Shaders** (`shaders/`): WGSL compositing shader

### Data flow

1. Pointer events (TypeScript `input.ts`) → WASM via `engine.ts`
2. Rust interpolates points along stroke path, stamps anti-aliased circles into layer RGBA buffers
3. Engine reads dirty layer pixels from WASM memory (zero-copy), uploads to WebGPU textures
4. Compositor renders fullscreen triangles per layer with alpha-over blending

### Key modules

- `brush.rs` — Point interpolation (pressure-dependent spacing), circle rasterization
- `layer.rs` — Per-layer RGBA pixel buffer with dirty tracking
- `canvas.rs` — Layer stack, brush settings, stroke state
- `color.rs` — Alpha-over compositing math
- `lib.rs` — wasm_bindgen API surface
- `engine.ts` — Bridge between WASM and WebGPU
- `compositor.ts` — WebGPU render pass for layer compositing
- `gpu.ts` — WebGPU device/pipeline/texture management

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
- `canvas.rs` — Layer management, stroke forwarding
- `color.rs` — Alpha-over compositing math

### TypeScript tests

Located in `src/__tests__/`. Uses vitest with happy-dom environment. WebGPU globals (`GPUTextureUsage`, `GPUShaderStage`, `GPUBufferUsage`) must be mocked in tests that touch `gpu.ts`.

- `engine.test.ts` — WASM wrapper, dirty layer syncing, brush settings forwarding
- `input.test.ts` — Pointer event translation, coalesced events, pressure defaults
- `compositor.test.ts` — Render pass creation, layer visibility

## Brush behavior

- **Spacing** is pressure-dependent: `step = spacing × size × pressure`. Lower pressure produces smaller circles with tighter spacing to maintain stroke density.
- **Flow** controls per-stamp alpha. **Opacity** controls whole-stroke alpha (applied at compositing via layer opacity).
- Circle rasterization uses smoothstep anti-aliasing at the edge.
