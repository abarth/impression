# Impression

A browser-based painting application built with WebGPU and Rust.

Impression combines a Rust drawing engine compiled to WebAssembly with a WebGPU rendering pipeline and a React interface. The brush engine runs entirely in WASM — interpolating pen strokes, rasterizing anti-aliased circles with pressure sensitivity, and managing layer pixel buffers — while the TypeScript frontend handles compositing those layers onto the screen through WebGPU and provides the interface for the artist.

## Features

- **Pressure-sensitive brush** with configurable size, spacing, flow, and opacity
- **Layered canvas** — add, remove, and select layers for non-destructive painting
- **Pan and zoom** — navigate the canvas with dedicated tools or scroll gestures
- **Foreground/background colors** with a visual picker and swap control
- **WebGPU accelerated** compositing with per-layer alpha blending

## Visual Design

Impression uses the **Soft Graphite** design language — a warm, muted dark theme inspired by paper and pencil. Warm grays with brown undertones replace the cold blue-grays typical of developer tools. Text is rendered in cream and off-white tones. Controls use generous padding, rounded corners, and soft shadows rather than hard borders, creating a tactile, approachable feel. The color swatches overlap in the classic foreground-over-background arrangement. Sliders have thick painterly tracks with large circular thumbs. The overall aesthetic prioritizes the artwork by keeping the interface quiet and unobtrusive.

**Design stack:** React 19, Radix UI primitives, Tailwind CSS 4, Lucide icons, react-colorful.

## Getting Started

### Container-Based Development (Recommended)

This project includes a Docker Compose and VS Code Devcontainer setup for isolated development. This environment is pre-configured with Node, Rust, and Claude Code.

**1. Using Docker Compose:**
Build and start the container, then open a shell inside it:
```bash
docker-compose up -d --build
docker-compose exec dev bash
```

Once inside the container, install dependencies and start the development server:
```bash
npm install
npm run dev -- --host 0.0.0.0
```
Open `http://localhost:5173` on your host machine to view the app. 

*Note: Your `~/.ssh`, `~/.gitconfig`, and `~/.claude.json` credentials are automatically mapped to the container so Git and Claude Code will work transparently.*

**2. Using VS Code Devcontainers:**
Open the project in VS Code and click "Reopen in Container" when prompted. It automatically manages port forwarding and installs required extensions (like rust-analyzer).

---

### Native Development

If you prefer developing directly on your host machine:

**Prerequisites:**
- Node.js 22+
- Rust toolchain with `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) (`cargo install wasm-pack`)

**Run the development server:**

```bash
npm install
npm run dev
```

This compiles the Rust crate to WASM and starts a Vite dev server. Open the app in a WebGPU-capable browser (Chrome 113+, Edge 113+, Safari 18+).

**Run tests:**

```bash
npm run test:all     # Rust + TypeScript tests
npm run test:rust    # Rust unit tests only
npm run test         # TypeScript tests only
```

## Architecture

```
Pointer events → React (CanvasViewport)
                    ↓ coordinate transform (pan/zoom)
                 Engine (TypeScript)
                    ↓ wasm_bindgen calls
                 Brush engine (Rust/WASM)
                    ↓ rasterize into layer pixel buffers
                 Engine reads WASM memory
                    ↓ upload textures
                 WebGPU compositor
                    ↓ alpha-blend layers
                 Screen
```

The Rust crate (`crates/impression-core`) owns all drawing logic. The TypeScript `Engine` class bridges WASM and WebGPU. React owns the UI but never touches the canvas directly — it calls imperative engine methods through callbacks.

## License

This project is not yet licensed. All rights reserved.
