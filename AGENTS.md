# Impression Agent Instructions

This document is for AI coding assistants working on Impression. Welcome to the project!

**Impression** is a complex, high-performance browser painting application utilizing React, TypeScript, WebGPU, and a Rust WASM backend. 

Your role is to help develop features, fix bugs, and refactor code, while strictly adhering to the project's engineering standards.

## Engineering Practices

When making changes to Impression, you **MUST** follow these practices:

1. **Write tests for all behavior changes**: Whether it's a Rust unit test or a TypeScript Vitest, all behavior changes require accompanying tests. Run them using the scripts provided in the development docs.
2. **Commit and push after each logical change**: Do not stack a massive list of changes. Keep your commits atomic, well-described, and push them to remote.
3. **Reflect on changes and file GitHub issues**: As you work, you will notice technical debt, missing features, edge cases, or potential refactors. You must identify these and file GitHub issues for future work rather than ignoring them or going down a rabbit hole.

## Technical Documentation Reference

To keep this document concise, the deep technical details of the application have been split into focused markdown files. **Please read the following documents as needed before changing code:**

- `docs/architecture.md` - Core architecture, data flow, and **CRITICAL** React+WebGPU integration rules (especially `RefCell` borrowing panics).
- `docs/development.md` - Information on how to build, test, and deploy the application (dev containers, wasm-pack).
- `docs/features.md` - Brush math, Photoshop-compatible shortcuts, UI design language (Soft Graphite), and URL routing.
- `docs/multiplayer-design.md` - Information on state syncing and operation logging (OpLog).

## Quick Repository Guide

- `src/` - React frontend, WebGPU integration, and Engine bridge.
- `crates/impression-core/src/` - Rust WASM backend for the brush engine and canvas pixel data.
- `shaders/` - WGSL code for WebGPU.
- `docs/` - Technical documentation.
- `.github/` - GitHub Actions deployment scripts.

Refer to the documentation whenever you are unsure of the architecture or rules!
