/**
 * Bristle paint transfer and reduction parameters.
 *
 * Manages the TransferParams and ReduceParams uniform structs consumed
 * by bristle_transfer.wgsl and bristle_reduce.wgsl, plus atlas sizing
 * helpers.
 */

// ---------------------------------------------------------------------------
// Atlas sizing
// ---------------------------------------------------------------------------

/** Default mini-grid size per bristle (texels). */
export const DEFAULT_GRID_SIZE = 8;

export interface AtlasLayout {
  /** Width of the atlas texture in texels. */
  atlasWidth: number;
  /** Height of the atlas texture in texels. */
  atlasHeight: number;
  /** Number of bristle columns in the atlas grid. */
  atlasCols: number;
  /** Number of bristle rows in the atlas grid. */
  atlasRows: number;
  /** Mini-grid size per bristle. */
  gridSize: number;
}

/**
 * Compute atlas dimensions for a given bristle count and grid size.
 * Arranges bristle mini-grids in a roughly square layout.
 */
export function computeAtlasLayout(
  bristleCount: number,
  gridSize: number = DEFAULT_GRID_SIZE,
): AtlasLayout {
  const cols = Math.ceil(Math.sqrt(bristleCount));
  const rows = Math.ceil(bristleCount / cols);
  return {
    atlasWidth: cols * gridSize,
    atlasHeight: rows * gridSize,
    atlasCols: cols,
    atlasRows: rows,
    gridSize,
  };
}

// ---------------------------------------------------------------------------
// TransferParams GPU uniform (must match WGSL struct TransferParams)
// ---------------------------------------------------------------------------

/** Size of TransferParams uniform in bytes (16 values = 64 bytes). */
export const TRANSFER_PARAMS_BYTES = 64;

export interface BristleTransferConfig {
  bristleCount: number;
  gridSize: number;
  canvasWidth: number;
  canvasHeight: number;
  atlasWidth: number;
  atlasCols: number;
  depositionRate: number;
  pickupRate: number;
  pickupThreshold: number;
  paintThickness: number;
  wetness: number;
  velocityX: number;
  velocityY: number;
  viscosity: number;
  canvasTextureStrength: number;
}

/**
 * Build a BristleTransferConfig from brush settings and atlas layout.
 */
export function buildBristleTransferConfig(
  bristleCount: number,
  canvasWidth: number,
  canvasHeight: number,
  atlas: AtlasLayout,
  opts?: {
    depositionRate?: number;
    pickupRate?: number;
    pickupThreshold?: number;
    paintThickness?: number;
    wetness?: number;
    velocityX?: number;
    velocityY?: number;
    viscosity?: number;
    canvasTextureStrength?: number;
  },
): BristleTransferConfig {
  return {
    bristleCount,
    gridSize: atlas.gridSize,
    canvasWidth,
    canvasHeight,
    atlasWidth: atlas.atlasWidth,
    atlasCols: atlas.atlasCols,
    depositionRate: opts?.depositionRate ?? 0.15,
    pickupRate: opts?.pickupRate ?? 0.05,
    pickupThreshold: opts?.pickupThreshold ?? 0.3,
    paintThickness: opts?.paintThickness ?? 0.5,
    wetness: opts?.wetness ?? 0.7,
    velocityX: opts?.velocityX ?? 0,
    velocityY: opts?.velocityY ?? 0,
    viscosity: opts?.viscosity ?? 0.5,
    canvasTextureStrength: opts?.canvasTextureStrength ?? 0.3,
  };
}

/**
 * Serialize BristleTransferConfig into a Float32Array for GPU upload.
 *
 * Layout (matches WGSL TransferParams):
 *   [0]  bristle_count          (u32)
 *   [1]  grid_size              (u32)
 *   [2]  canvas_width           (u32)
 *   [3]  canvas_height          (u32)
 *   [4]  atlas_width            (u32)
 *   [5]  atlas_cols             (u32)
 *   [6]  deposition_rate        (f32)
 *   [7]  pickup_rate            (f32)
 *   [8]  pickup_threshold       (f32)
 *   [9]  paint_thickness        (f32)
 *   [10] wetness                (f32)
 *   [11] velocity_x             (f32)
 *   [12] velocity_y             (f32)
 *   [13] viscosity              (f32)
 *   [14] canvas_texture_strength(f32)
 *   [15] _pad                   (f32)
 */
export function writeTransferParamsUniform(
  config: BristleTransferConfig,
): Float32Array {
  const buf = new Float32Array(16);
  const u32 = new Uint32Array(buf.buffer);
  u32[0] = config.bristleCount;
  u32[1] = config.gridSize;
  u32[2] = config.canvasWidth;
  u32[3] = config.canvasHeight;
  u32[4] = config.atlasWidth;
  u32[5] = config.atlasCols;
  buf[6] = config.depositionRate;
  buf[7] = config.pickupRate;
  buf[8] = config.pickupThreshold;
  buf[9] = config.paintThickness;
  buf[10] = config.wetness;
  buf[11] = config.velocityX;
  buf[12] = config.velocityY;
  buf[13] = config.viscosity;
  buf[14] = config.canvasTextureStrength;
  buf[15] = 0; // _pad
  return buf;
}

// ---------------------------------------------------------------------------
// ReduceParams GPU uniform (must match WGSL struct ReduceParams)
// ---------------------------------------------------------------------------

/** Size of ReduceParams uniform in bytes (12 values = 48 bytes). */
export const REDUCE_PARAMS_BYTES = 48;

export interface BristleReduceConfig {
  bristleCount: number;
  gridSize: number;
  canvasWidth: number;
  canvasHeight: number;
  atlasWidth: number;
  atlasCols: number;
  mixingStrength: number;
  viscosity: number;
  velocityX: number;
  velocityY: number;
}

/**
 * Build a BristleReduceConfig from brush settings and atlas layout.
 */
export function buildBristleReduceConfig(
  bristleCount: number,
  canvasWidth: number,
  canvasHeight: number,
  atlas: AtlasLayout,
  opts?: {
    mixingStrength?: number;
    viscosity?: number;
    velocityX?: number;
    velocityY?: number;
  },
): BristleReduceConfig {
  return {
    bristleCount,
    gridSize: atlas.gridSize,
    canvasWidth,
    canvasHeight,
    atlasWidth: atlas.atlasWidth,
    atlasCols: atlas.atlasCols,
    mixingStrength: opts?.mixingStrength ?? 0.5,
    viscosity: opts?.viscosity ?? 0.5,
    velocityX: opts?.velocityX ?? 0,
    velocityY: opts?.velocityY ?? 0,
  };
}

/**
 * Serialize BristleReduceConfig into a Float32Array for GPU upload.
 *
 * Layout (matches WGSL ReduceParams):
 *   [0]  bristle_count   (u32)
 *   [1]  grid_size       (u32)
 *   [2]  canvas_width    (u32)
 *   [3]  canvas_height   (u32)
 *   [4]  atlas_width     (u32)
 *   [5]  atlas_cols      (u32)
 *   [6]  mixing_strength (f32)
 *   [7]  viscosity       (f32)
 *   [8]  velocity_x      (f32)
 *   [9]  velocity_y      (f32)
 *   [10] _pad0           (f32)
 *   [11] _pad1           (f32)
 */
export function writeReduceParamsUniform(
  config: BristleReduceConfig,
): Float32Array {
  const buf = new Float32Array(12);
  const u32 = new Uint32Array(buf.buffer);
  u32[0] = config.bristleCount;
  u32[1] = config.gridSize;
  u32[2] = config.canvasWidth;
  u32[3] = config.canvasHeight;
  u32[4] = config.atlasWidth;
  u32[5] = config.atlasCols;
  buf[6] = config.mixingStrength;
  buf[7] = config.viscosity;
  buf[8] = config.velocityX;
  buf[9] = config.velocityY;
  buf[10] = 0; // _pad0
  buf[11] = 0; // _pad1
  return buf;
}
