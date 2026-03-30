/**
 * Brush morphology configuration for the GPU bristle engine.
 *
 * Maps UI brush shape settings to GPU bristle init parameters
 * and manages the bristle storage buffer lifecycle.
 */

import type { BrushShape, WetMediaSettings } from "../hooks/useBrushSettings";

/** Bristle data layout: 20 f32 values per bristle (80 bytes). */
export const BRISTLE_STRIDE_F32 = 20;

/** Maximum supported bristle count. */
export const MAX_BRISTLE_COUNT = 512;

/** GPU bristle init uniform parameters, matches BristleInitParams in WGSL. */
export interface BristleInitParams {
  bristleCount: number;
  brushShape: number; // 0=Round, 1=Flat, 2=Filbert, 3=Fan
  brushRadius: number;
  bristleLength: number;
  baseStiffness: number;
  baseThickness: number;
  spread: number;
  seed: number;
  form: number;
}

/** Map BrushShape string to WGSL enum value. */
export function brushShapeToIndex(shape: BrushShape): number {
  switch (shape) {
    case "Round": return 0;
    case "Flat": return 1;
    case "Filbert": return 2;
    case "Fan": return 3;
    default: return 0;
  }
}

/**
 * Build BristleInitParams from brush settings.
 * Uses a deterministic seed derived from the brush size so the same brush
 * always produces the same bristle arrangement.
 */
export function buildBristleInitParams(
  settings: WetMediaSettings,
  brushSize: number,
): BristleInitParams {
  const brushRadius = brushSize / 2;
  const bristleCount = Math.min(
    Math.max(16, settings.bristleCount),
    MAX_BRISTLE_COUNT,
  );

  // Bristle length scales with brush size.
  // A typical bristle is 1.5x the radius, adjusted by stiffness.
  const bristleLength = brushRadius * (1.0 + (1.0 - settings.bristleStiffness) * 1.0);

  return {
    bristleCount,
    brushShape: brushShapeToIndex(settings.brushShape),
    brushRadius,
    bristleLength,
    baseStiffness: settings.bristleStiffness,
    baseThickness: 0.5, // default medium thickness
    spread: settings.bristleSpread,
    seed: deterministicSeed(brushSize, bristleCount),
    form: settings.brushForm,
  };
}

/**
 * Compute the required GPU storage buffer size in bytes for a bristle array.
 */
export function bristleBufferSize(bristleCount: number): number {
  return bristleCount * BRISTLE_STRIDE_F32 * 4;
}

/**
 * Write BristleInitParams to a Float32Array for GPU uniform upload.
 * Layout matches the WGSL BristleInitParams struct.
 */
export function writeBristleInitUniform(params: BristleInitParams): Float32Array {
  const buf = new Float32Array(12); // 3 vec4s = 12 floats
  // First vec4: bristle_count(u32), brush_shape(u32), brush_radius(f32), bristle_length(f32)
  const u32View = new Uint32Array(buf.buffer);
  u32View[0] = params.bristleCount;
  u32View[1] = params.brushShape;
  buf[2] = params.brushRadius;
  buf[3] = params.bristleLength;
  // Second vec4: base_stiffness, base_thickness, spread, seed(u32)
  buf[4] = params.baseStiffness;
  buf[5] = params.baseThickness;
  buf[6] = params.spread;
  u32View[7] = params.seed;
  // Third vec4: form, pad, pad, pad
  buf[8] = params.form;
  buf[9] = 0;
  buf[10] = 0;
  buf[11] = 0;
  return buf;
}

/** Deterministic seed from brush parameters. */
function deterministicSeed(brushSize: number, bristleCount: number): number {
  // Simple hash combining brush size and count
  let h = (Math.round(brushSize * 100) & 0xFFFFFFFF) >>> 0;
  h = ((h ^ (bristleCount * 2654435761)) >>> 0);
  h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0;
  return h >>> 0;
}
