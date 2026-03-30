/**
 * Bristle kinematic simulation parameters.
 *
 * Maps brush settings + stroke context into the SimParams uniform struct
 * consumed by bristle_sim.wgsl, and the StylusState uniform struct that
 * conveys pointer telemetry to the GPU.
 */

import type { StylusPoint } from "./stylusInput";

// ---------------------------------------------------------------------------
// StylusState GPU uniform (must match WGSL struct StylusState)
// ---------------------------------------------------------------------------

/** Size of the StylusState uniform buffer in bytes (8 f32 = 32 bytes). */
export const STYLUS_UNIFORM_BYTES = 32;

/**
 * Write a StylusPoint (from the interpolator) into a Float32Array suitable
 * for uploading to the GPU StylusState uniform buffer.
 */
export function writeStylusUniform(pt: StylusPoint): Float32Array {
  const buf = new Float32Array(8);
  buf[0] = pt.x;
  buf[1] = pt.y;
  buf[2] = pt.pressure;
  buf[3] = pt.altitude;
  buf[4] = pt.azimuth;
  buf[5] = pt.twist;
  buf[6] = 0; // velocity.x — set via writeStylusUniformInto for 2D velocity
  buf[7] = 0; // velocity.y
  return buf;
}

/**
 * Write a StylusPoint into the given Float32Array at the specified byte offset.
 * Returns the same array for chaining.
 */
export function writeStylusUniformInto(
  buf: Float32Array,
  pt: StylusPoint,
  velocityX: number,
  velocityY: number,
): Float32Array {
  buf[0] = pt.x;
  buf[1] = pt.y;
  buf[2] = pt.pressure;
  buf[3] = pt.altitude;
  buf[4] = pt.azimuth;
  buf[5] = pt.twist;
  buf[6] = velocityX;
  buf[7] = velocityY;
  return buf;
}

// ---------------------------------------------------------------------------
// SimParams GPU uniform (must match WGSL struct SimParams)
// ---------------------------------------------------------------------------

/** Size of SimParams uniform in bytes (8 values: 1 u32 + 7 f32 = 32 bytes). */
export const SIM_PARAMS_BYTES = 32;

export interface BristleSimConfig {
  /** Number of bristles. */
  bristleCount: number;
  /** Delta time per sub-step in milliseconds. */
  dt: number;
  /** Brush radius in canvas pixels. */
  brushRadius: number;
  /** Maximum height above canvas (pixels). Ferrule sits here at zero pressure. */
  maxHeight: number;
  /** Velocity damping coefficient (0-1). */
  damping: number;
  /** Splay force multiplier. */
  splayStrength: number;
  /** Clumping force multiplier. */
  clumpStrength: number;
  /** Paint-load threshold above which clumping activates. */
  clumpThreshold: number;
}

/**
 * Build a BristleSimConfig from brush settings and frame context.
 */
export function buildBristleSimConfig(
  bristleCount: number,
  brushDiameter: number,
  dt: number,
  opts?: {
    damping?: number;
    splayStrength?: number;
    clumpStrength?: number;
    clumpThreshold?: number;
    maxHeightFactor?: number;
  },
): BristleSimConfig {
  const radius = brushDiameter / 2;
  return {
    bristleCount,
    dt,
    brushRadius: radius,
    maxHeight: radius * (opts?.maxHeightFactor ?? 1.5),
    damping: opts?.damping ?? 0.85,
    splayStrength: opts?.splayStrength ?? 0.4,
    clumpStrength: opts?.clumpStrength ?? 0.15,
    clumpThreshold: opts?.clumpThreshold ?? 0.1,
  };
}

/**
 * Serialize BristleSimConfig into a Float32Array for GPU upload.
 *
 * Layout (matches WGSL SimParams):
 *   [0]  bristle_count  (u32, reinterpreted)
 *   [1]  dt             (f32)
 *   [2]  brush_radius   (f32)
 *   [3]  max_height     (f32)
 *   [4]  damping        (f32)
 *   [5]  splay_strength (f32)
 *   [6]  clump_strength (f32)
 *   [7]  clump_threshold(f32)
 */
export function writeSimParamsUniform(config: BristleSimConfig): Float32Array {
  const buf = new Float32Array(8);
  const u32 = new Uint32Array(buf.buffer);
  u32[0] = config.bristleCount;
  buf[1] = config.dt;
  buf[2] = config.brushRadius;
  buf[3] = config.maxHeight;
  buf[4] = config.damping;
  buf[5] = config.splayStrength;
  buf[6] = config.clumpStrength;
  buf[7] = config.clumpThreshold;
  return buf;
}
