# Development Guide

This document outlines how to build, test, and deploy Impression.

## Development Environments

### Container-Based Development (Recommended)

This project includes a Docker Compose and VS Code Devcontainer setup for isolated development. This environment is pre-configured with Node, Rust, and Claude Code.

**Using Docker Compose:**
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
*Note: Your `~/.ssh`, `~/.gitconfig`, and `~/.claude.json` credentials are automatically mapped to the container.*

**Using VS Code Devcontainers:**
Open the project in VS Code and click "Reopen in Container" when prompted. It automatically manages port forwarding and installs required extensions (like rust-analyzer).

### Native Development

If you prefer developing directly on your host machine:

**Prerequisites:**
- Node.js 22+
- Rust toolchain with `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- `wasm-pack` (`cargo install wasm-pack`)

## Build & Run

```bash
npm install
npm run build:wasm    # Compile Rust to WASM (output: src/wasm/)
npm run dev           # Start Vite dev server (auto-rebuilds WASM on Rust file changes)
npm run build         # Production build (WASM + Vite)
```

The Vite config includes a `wasmPackWatch` plugin that watches `crates/impression-core/src/**/*.rs` and automatically runs `wasm-pack build` when Rust files change during dev.

**Important**: After modifying Rust code, the WASM must be rebuilt for changes to take effect in the browser. The dev server handles this automatically, but CI and production builds use `npm run build:wasm` explicitly.

## Testing

**Every behavior change must include corresponding tests.** This applies to both Rust and TypeScript code.

```bash
npm run test:all      # Both Rust and TypeScript tests
npm run test:rust     # Rust unit tests (cargo test)
npm run test          # TypeScript tests (vitest)
```

### Rust tests
Located alongside source code in `#[cfg(test)] mod tests` blocks within each `.rs` file.

### TypeScript tests
Located in `src/__tests__/`. Uses vitest with happy-dom environment. WebGPU globals (`GPUTextureUsage`, `GPUShaderStage`, `GPUBufferUsage`) must be mocked in tests that touch `gpu.ts`. React hooks tests use `@testing-library/react` with `renderHook`/`act`. Time-dependent tests (spring-loaded shortcuts) use `vi.useFakeTimers()`.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml`. Pushes to `main` trigger: 
1. Install Rust toolchain + wasm-pack 
2. `npm ci` 
3. `npm run build:wasm` 
4. `npx vite build` 
5. Deploy to Pages. 

Base path is `/impression/` (set in `vite.config.ts`).
