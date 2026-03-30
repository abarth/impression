/**
 * Bristle collision parameters.
 *
 * Manages the CollisionParams uniform struct consumed by
 * bristle_collide.wgsl and provides helper functions for building
 * and serializing the configuration.
 */

// ---------------------------------------------------------------------------
// CollisionParams GPU uniform (must match WGSL struct CollisionParams)
// ---------------------------------------------------------------------------

/** Size of CollisionParams uniform in bytes (8 values = 32 bytes). */
export const COLLISION_PARAMS_BYTES = 32;

export interface BristleCollisionConfig {
  /** Number of bristles. */
  bristleCount: number;
  /** Canvas width in pixels. */
  canvasWidth: number;
  /** Canvas height in pixels. */
  canvasHeight: number;
  /** Paper roughness (0-1). Higher = more friction drag. */
  roughness: number;
  /**
   * Hover threshold (0-1 normalized).
   * If a bristle tip floats above the surface by more than this
   * fraction of the height scale, it won't deposit paint (dry-brush).
   */
  hoverThreshold: number;
  /** Brush radius in canvas pixels. */
  brushRadius: number;
}

/**
 * Build a BristleCollisionConfig from canvas dimensions and brush settings.
 */
export function buildBristleCollisionConfig(
  bristleCount: number,
  canvasWidth: number,
  canvasHeight: number,
  brushDiameter: number,
  opts?: {
    roughness?: number;
    hoverThreshold?: number;
  },
): BristleCollisionConfig {
  return {
    bristleCount,
    canvasWidth,
    canvasHeight,
    roughness: opts?.roughness ?? 0.5,
    hoverThreshold: opts?.hoverThreshold ?? 0.3,
    brushRadius: brushDiameter / 2,
  };
}

/**
 * Serialize BristleCollisionConfig into a Float32Array for GPU upload.
 *
 * Layout (matches WGSL CollisionParams):
 *   [0]  bristle_count   (u32)
 *   [1]  canvas_width    (u32)
 *   [2]  canvas_height   (u32)
 *   [3]  roughness       (f32)
 *   [4]  hover_threshold (f32)
 *   [5]  brush_radius    (f32)
 *   [6]  _pad0           (f32)
 *   [7]  _pad1           (f32)
 */
export function writeCollisionParamsUniform(
  config: BristleCollisionConfig,
): Float32Array {
  const buf = new Float32Array(8);
  const u32 = new Uint32Array(buf.buffer);
  u32[0] = config.bristleCount;
  u32[1] = config.canvasWidth;
  u32[2] = config.canvasHeight;
  buf[3] = config.roughness;
  buf[4] = config.hoverThreshold;
  buf[5] = config.brushRadius;
  buf[6] = 0; // _pad0
  buf[7] = 0; // _pad1
  return buf;
}
