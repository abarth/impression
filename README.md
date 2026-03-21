# Impression

A high-performance, browser-based painting application built with WebGPU and Rust.

[Try it live here!](https://abarth.github.io/impression/)

Impression uses a hybrid architecture: a powerful Rust drawing engine running in WebAssembly handles brush dynamics and pixel rendering, while a TypeScript/WebGPU frontend provides a modern UI and fast layer compositing.

## Features

- **Pressure-sensitive brush engine** with fine-tuned dynamics (size, opacity, flow, hardness, roundness, angle).
- **Custom brush tips** via Photoshop .abr file import.
- **Layer management** with support for multiple blending modes, adjustment layers, and non-destructive editing.
- **High-performance compositing** powered by WebGPU alpha blending.
- **Selection tools** (marquee, lasso) with advanced boolean operations (add, subtract, intersect).
- **Infinite pan and zoom** canvas navigation.

## Visual Design

Impression features a highly customized **Soft Graphite** user interface. Designed specifically to look like a premium creative tool rather than standard developer software, it uses warm grays, cream tones, and shadow-based elevation to create a "tactile" and un-distracting environment that focuses attention on your artwork. 

## How to Use

The interface works similarly to standard professional image editing software:
- Select tools from the left toolbar.
- You can use standard keyboard shortcuts like `B` for Brush, `I` for Eyedropper, `Space` to Pan, or `Alt` with Brush to temporarily sample a color.
- Create and manage layers from the right-hand panel.
- Right-click or use the layer panel menu for layer operations (duplicate, merge, mask).
- Your paintings and brush presets are automatically saved locally in your browser so you don't lose any progress.

## For Developers

Want to contribute or learn how Impression works? Please see the documentation for AI coding agents and human developers:

- Interested in submitting patches? Check out [CLAUDE.md](./CLAUDE.md) for engineering practices.
- Deep architectural explanation: [docs/architecture.md](./docs/architecture.md)
- Development environment and build setup: [docs/development.md](./docs/development.md)
- Feature implementation details: [docs/features.md](./docs/features.md)
- Multiplayer/sync design concepts: [docs/multiplayer-design.md](./docs/multiplayer-design.md)
