# Realistic Wet Media: Oil & Acrylic Implementation Plan

## Context

The current wet media system provides a basic paint simulation with bristle footprint generation, simple RGB color mixing, semi-Lagrangian advection, 3x3 Gaussian diffusion, linear drying, and Blinn-Phong impasto lighting. While functional, it falls far short of Rebelle-level realism. The two most impactful gaps are: (1) naive RGB `mix()` produces muddy colors instead of physically accurate subtractive mixing, and (2) oil and acrylic share identical physics with no medium-specific behavior.

This plan adds a `MediumType` enum, integrates Mixbox for pigment-accurate color mixing, implements canvas texture interaction, improves the bristle model, and creates proper presets for each medium. **Watercolor is deferred** to a follow-up — a GitHub issue will be filed for it.

---

## Phase 1: Medium Type System + Canvas Texture + Thickness-Dependent Drying

**Goal**: Establish the medium type foundation and deliver two quick-win improvements.

### 1a. `MediumType` Enum

**File**: `crates/impression-core/src/wet_media.rs`

```rust
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum MediumType { Oil, Acrylic, Watercolor }
impl Default for MediumType { fn default() -> Self { MediumType::Oil } }
```

Add to `WetMediaBrushSettings` (with `#[serde(default)]` for backwards compat):
- `medium_type: MediumType`
- `viscosity: f32` (0.0–1.0, default 0.7)

Add `MediumPhysics` struct + `MediumType::physics()`:

| Parameter | Oil | Acrylic |
|-----------|-----|---------|
| viscosity | 0.85 | 0.5 |
| drying_rate | 0.001 | 0.005 |
| diffusion_rate | 0.05 | 0.15 |
| advection_dissipation | 0.99 | 0.97 |

**File**: `src/hooks/useBrushSettings.ts` — Add `mediumType` + `viscosity` to `WetMediaSettings`
**File**: `src/components/BrushSettingsPanel.tsx` — Add medium selector dropdown
**File**: `src/gpu.ts` — Replace hardcoded sim constants (lines ~885-1023) with per-medium values
**File**: `src/brushPresets.ts` — Add `mediumType` to existing presets

### 1b. Canvas Texture Interaction

`canvas_texture_strength` exists in `WetMediaBrushSettings` (line 24) but is unused in shaders.

1. **New file**: `src/paperTexture.ts` — Deterministic 2D Perlin noise generator (~60 lines). Seed from layer ID for replay determinism.

2. **File**: `src/gpu.ts` — Add `paperTexture: GPUTexture` (r32float) to `WetMediaLayerGPU`. Upload noise at layer creation.

3. **File**: `shaders/wet_media_deposit.wgsl` — Add binding 6 (paper texture, read-only). Add `canvas_texture_strength` to `DepositParams`. Modulate deposit:
   ```wgsl
   let paper_h = textureLoad(paper_texture, coord).r;
   let texture_mod = 1.0 - canvas_texture_strength * (1.0 - paper_h);
   let deposit_strength = footprint_pressure * load * texture_mod;
   ```

4. **File**: `shaders/wet_media_diffuse.wgsl` — Add paper texture binding. Weight neighbor diffusion by paper height similarity.

### 1c. Thickness-Dependent Drying

**File**: `shaders/wet_media_dry.wgsl` — Read height from props, slow drying for thick paint:
```wgsl
let height = props.r;
let effective_rate = drying_rate / (1.0 + height * 3.0);
let new_wetness = max(0.0, wetness - effective_rate);
```

**File**: `src/gpu.ts` — Pass medium-dependent drying rate in dry shader uniforms.

### 1d. Tests

**Rust** (`crates/impression-core/src/wet_media.rs`):
- `test_medium_type_serialization_round_trip`
- `test_medium_physics_valid_ranges`
- `test_wet_media_settings_backwards_compat` (old format without `medium_type`)

**TypeScript**:
- New `src/__tests__/paperTexture.test.ts` — Deterministic, values in [0,1]
- Update brush settings tests for new fields

---

## Phase 2: Mixbox Pigment Mixing

**Goal**: Replace naive RGB `mix()` with Kubelka-Munk pigment mixing — the single highest-impact visual quality change.

### 2a. LUT Setup

- **New file**: `src/mixbox.ts` — Load Mixbox LUT data from bundled binary, create `GPUTexture`
- **New asset**: `public/mixbox_lut.bin` — ~1MB LUT (MIT-licensed from [Mixbox repo](https://github.com/scrtwpns/mixbox))
- **File**: `src/gpu.ts` — Add `mixboxLUT: GPUTexture` to `GPUContext`, init during `initGPU()`

### 2b. Shader Integration

- **New file**: `shaders/mixbox.wgsl` — Mixbox WGSL functions from upstream repo. Key functions:
  - `mixbox_lerp(rgb1, rgb2, t) -> vec3f`
  - `mixbox_rgb_to_latent(rgb) -> array<f32, 7>`
  - `mixbox_latent_to_rgb(latent) -> vec3f`

- **File**: `shaders/wet_media_deposit.wgsl` — Replace line 89:
  ```wgsl
  // BEFORE: let new_color = mix(existing_color.rgb, paint_color, blend_factor);
  // AFTER:
  let new_color = mixbox_lerp(existing_color.rgb, paint_color, blend_factor);
  ```
  Add LUT texture binding.

- **File**: `shaders/wet_media_diffuse.wgsl` — Replace linear RGB averaging with Mixbox latent-space accumulation:
  ```wgsl
  var latent_sum = mixbox_rgb_to_latent(center_color) * center_weight;
  // for each neighbor:
  latent_sum += mixbox_rgb_to_latent(neighbor_color) * weight;
  let avg_color = mixbox_latent_to_rgb(latent_sum / total_weight);
  ```
  Add LUT texture binding.

### 2c. Rust-Side Dependency

**File**: `crates/impression-core/Cargo.toml` — Add `mixbox = "2"` for CPU-side preview mixing if needed.

### 2d. Tests

**Rust**: `test_mixbox_red_yellow_makes_orange` (not muddy brown)
**TypeScript**: `src/__tests__/mixbox.test.ts` — LUT loading, texture creation

---

## Phase 3: Improved Bristle Model + Viscosity

**Goal**: Replace static radial-dot bristles with persistent, pressure-deformable bristles.

### 3a. Persistent Bristle Array

**File**: `crates/impression-core/src/wet_media.rs`

Add to `WetMediaStrokeState`:
```rust
bristle_offsets: Vec<(f32, f32)>,   // Fixed base positions, init at stroke_begin
bristle_colors: Vec<[f32; 3]>,      // Per-bristle color, starts as paint color
```

**stroke_begin**: Generate bristle base positions once using PRNG. Persist across stroke.

**stroke_move**: Apply dynamic transforms per-footprint:
- **Pressure splay**: `pos *= 1.0 + pressure * bristle_spread * 0.5`
- **Velocity bend**: `pos += velocity_dir * bend_amount / stiffness`
- **Per-bristle color drift**: Blend each bristle's color toward estimated canvas color (weighted by `mixing_strength`)

Refactor `generate_bristle_footprint()` to accept `&[(f32, f32)]` bristle offsets instead of generating random positions each time.

### 3b. Viscosity in Deposit Shader

**File**: `shaders/wet_media_deposit.wgsl` — Add `viscosity` to `DepositParams`:
- Mixing resistance: `effective_mixing = mixing_strength * (1.0 - viscosity * 0.7)`
- Height buildup: `height += thickness * pressure * load * (0.5 + viscosity * 0.5)`
- Velocity write: Add velocity texture write binding. Deposit brush velocity scaled by `(1.0 - viscosity)`.

**File**: `src/gpu.ts` — Update deposit bind group layout for velocity texture + viscosity.

**File**: `src/hooks/useBrushSettings.ts` — Add `bristleStiffness: number` to `WetMediaSettings`.

### 3c. Tests

**Rust** (`wet_media.rs`):
- `test_bristle_offsets_persist_across_stroke`
- `test_high_pressure_spreads_bristles`
- `test_velocity_bends_bristles`
- `test_per_bristle_color_pickup`

---

## Phase 4: Composite Shader Enhancements

**Goal**: Medium-specific rendering — wet/dry gloss transitions, proper Fresnel specular.

### 4a. Enhanced Gloss Model

**File**: `shaders/wet_media_composite.wgsl` — Replace `spec_strength = 0.3 * wetness` with:
```wgsl
let roughness = mix(0.8, 0.1, wetness);
let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, view_dir), 0.0), 5.0);
let spec_strength = fresnel * (1.0 - roughness * roughness);
```

Per-medium:
- **Oil**: Min gloss 0.15 even when dry (oil paint stays somewhat shiny)
- **Acrylic**: Min gloss 0.02 when dry (matte finish)

Pass `medium_type` (as u32) in composite uniform buffer.

**File**: `src/gpu.ts` — Pass medium type to composite bind group/uniforms.

### 4b. Tests

Visual verification (manual):
- Oil strokes glossy when wet, semi-glossy when dry
- Acrylic strokes glossy when wet, matte when dry

---

## Phase 5: Presets + UI Polish

**Goal**: Full preset library for oil and acrylic, medium-aware UI.

### 5a. New Presets

**File**: `src/brushPresets.ts`

**Oil** (update existing + add new):
- Oil Flat (existing → add `mediumType: "Oil"`)
- Oil Round (existing → update)
- Palette Knife (existing → update)
- Oil Filbert (new: roundness 0.7, 80 bristles, medium thickness)
- Oil Impasto (new: max thickness 0.9, high viscosity 0.9, heavy load)
- Oil Glaze (new: low load 0.2, low thickness 0.1, high transparency)

**Acrylic** (all new):
- Acrylic Flat (medium viscosity, fast drying)
- Acrylic Wash (thin, transparent, low viscosity)
- Acrylic Heavy Body (thick, high viscosity)

**Dry Media**: Dry Brush (existing, kept as-is with `mediumType: "Oil"`)

### 5b. UI Updates

**File**: `src/components/BrushSettingsPanel.tsx`
- Segmented control: Oil | Acrylic (Watercolor greyed out / "coming soon")
- Show/hide parameters by medium:
  - Oil: viscosity + impasto thickness prominent
  - Acrylic: drying speed visible, lower default thickness
- Tooltips for each wet media parameter

### 5c. File GitHub Issue for Watercolor

File a GitHub issue tracking the deferred watercolor simulation work (Phase 4 from the full analysis: paper absorption, capillary flow, pigment granulation, bloom effects, 2 new shaders, extra GPU textures).

### 5d. Tests

- Verify all presets have valid parameter ranges
- Verify medium-type-specific UI rendering

---

## Execution Order

```
Phase 1 (Medium types + canvas texture + thick drying)
  ↓
Phase 2 (Mixbox pigment mixing)
  ↓
Phase 3 (Bristle model + viscosity)
  ↓
Phase 4 (Composite shader enhancements)
  ↓
Phase 5 (Presets + UI + file watercolor issue)
```

Each phase gets its own commit. Push after each.

---

## Key Files Summary

| File | Phases | Changes |
|------|--------|---------|
| `crates/impression-core/src/wet_media.rs` | 1,3 | MediumType, viscosity, persistent bristles |
| `shaders/wet_media_deposit.wgsl` | 1,2,3 | Canvas texture, Mixbox, viscosity+velocity |
| `shaders/wet_media_diffuse.wgsl` | 1,2 | Canvas texture, Mixbox latent averaging |
| `shaders/wet_media_dry.wgsl` | 1 | Height-dependent drying |
| `shaders/wet_media_composite.wgsl` | 4 | Fresnel gloss, medium branching |
| `src/gpu.ts` | 1,2,3,4 | Sim params, LUT, bind groups, uniforms |
| `src/hooks/useBrushSettings.ts` | 1,3 | Medium type, viscosity, stiffness |
| `src/components/BrushSettingsPanel.tsx` | 1,5 | Medium selector, conditional params |
| `src/brushPresets.ts` | 1,5 | Medium types on presets, new presets |
| New: `src/paperTexture.ts` | 1 | Perlin noise for canvas grain |
| New: `src/mixbox.ts` | 2 | LUT loading + GPU texture |
| New: `shaders/mixbox.wgsl` | 2 | Mixbox WGSL functions |
| New: `public/mixbox_lut.bin` | 2 | Mixbox LUT binary asset |

---

## Verification

After each phase:
1. **Rust tests**: `cd crates/impression-core && cargo test`
2. **TypeScript tests**: `npx vitest run`
3. **Visual testing** (manual):
   - Phase 1: Medium dropdown works, canvas grain visible in strokes, thick paint dries slower
   - Phase 2: Red + blue = vibrant purple (not brown), yellow + blue = green
   - Phase 3: Consistent bristle marks within stroke, pressure splays, velocity bends
   - Phase 4: Oil glossy wet→semi-glossy dry, acrylic glossy wet→matte dry
   - Phase 5: All presets produce distinct marks, UI adapts per medium
4. **Performance**: <2ms/frame simulation (browser DevTools GPU profiler)
5. **Undo/redo**: Strokes replay deterministically
