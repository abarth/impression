/**
 * Canvas texture generator with realistic weave patterns.
 * Produces R32Float textures representing canvas surface height for
 * wet media paint interaction (absorption, flow, texture catchment).
 *
 * Supports multiple canvas types: fine linen, medium cotton, coarse jute,
 * and smooth panel. Each uses a loom-style warp/weft weave simulation
 * with per-thread random fiber variation.
 */

/** Canvas surface type determining weave pattern and absorption. */
export type CanvasType =
  | "fine_linen"
  | "medium_cotton"
  | "coarse_jute"
  | "smooth_panel";

/** Parameters defining a canvas weave pattern. */
export interface CanvasWeaveParams {
  /** Horizontal spacing between warp threads in pixels. */
  warpSpacing: number;
  /** Vertical spacing between weft threads in pixels. */
  weftSpacing: number;
  /** Thread width as fraction of spacing (0.0–1.0). */
  threadWidth: number;
  /** Thread height (peak elevation) (0.0–1.0). */
  threadHeight: number;
  /** Weave pattern: plain (1/1), twill (2/1), or satin (4/1). */
  weavePattern: "plain" | "twill" | "satin";
  /** Random fiber variation amount (0.0–1.0). */
  fiberVariation: number;
  /** Background height (canvas base level, 0.0–1.0). */
  baseHeight: number;
  /** Paint absorption rate for this canvas type (0.0–1.0). */
  absorptionRate: number;
}

/** Default weave parameters for each canvas type. */
export const CANVAS_PRESETS: Record<CanvasType, CanvasWeaveParams> = {
  fine_linen: {
    warpSpacing: 4,
    weftSpacing: 4,
    threadWidth: 0.7,
    threadHeight: 0.3,
    weavePattern: "plain",
    fiberVariation: 0.1,
    baseHeight: 0.35,
    absorptionRate: 0.02,
  },
  medium_cotton: {
    warpSpacing: 6,
    weftSpacing: 6,
    threadWidth: 0.65,
    threadHeight: 0.5,
    weavePattern: "plain",
    fiberVariation: 0.15,
    baseHeight: 0.3,
    absorptionRate: 0.04,
  },
  coarse_jute: {
    warpSpacing: 10,
    weftSpacing: 10,
    threadWidth: 0.6,
    threadHeight: 0.8,
    weavePattern: "twill",
    fiberVariation: 0.25,
    baseHeight: 0.2,
    absorptionRate: 0.06,
  },
  smooth_panel: {
    warpSpacing: 2,
    weftSpacing: 2,
    threadWidth: 0.9,
    threadHeight: 0.05,
    weavePattern: "plain",
    fiberVariation: 0.02,
    baseHeight: 0.48,
    absorptionRate: 0.01,
  },
};

/** Seeded hash for deterministic random generation (splitmix32). */
function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return (t >>> 0) / 0xffffffff;
  };
}

/** Smooth transition curve for thread cross-section profile. */
function threadProfile(t: number): number {
  // Raised cosine: smooth bump that goes from 0 at edges to 1 at center
  return t <= 0 || t >= 1 ? 0 : 0.5 * (1 - Math.cos(t * Math.PI * 2 - Math.PI)) * 0.5 + 0.5 * Math.sin(t * Math.PI);
}

/**
 * Generate a realistic canvas weave texture.
 * Returns a Float32Array of height values in [0, 1] for the given dimensions.
 */
export function generateCanvasTexture(
  width: number,
  height: number,
  seed: number,
  canvasType: CanvasType = "medium_cotton",
): Float32Array {
  const params = CANVAS_PRESETS[canvasType];
  const rng = splitmix32(seed);
  const data = new Float32Array(width * height);

  // Pre-generate per-thread random variations
  const maxWarpThreads = Math.ceil(width / params.warpSpacing) + 2;
  const maxWeftThreads = Math.ceil(height / params.weftSpacing) + 2;
  const warpJitter = new Float32Array(maxWarpThreads);
  const weftJitter = new Float32Array(maxWeftThreads);
  const warpWidthVar = new Float32Array(maxWarpThreads);
  const weftWidthVar = new Float32Array(maxWeftThreads);

  for (let i = 0; i < maxWarpThreads; i++) {
    warpJitter[i] = (rng() - 0.5) * params.fiberVariation * params.warpSpacing;
    warpWidthVar[i] = 1.0 + (rng() - 0.5) * params.fiberVariation;
  }
  for (let i = 0; i < maxWeftThreads; i++) {
    weftJitter[i] = (rng() - 0.5) * params.fiberVariation * params.weftSpacing;
    weftWidthVar[i] = 1.0 + (rng() - 0.5) * params.fiberVariation;
  }

  // Weave over/under pattern lookup
  const isWarpOver = (warpIdx: number, weftIdx: number): boolean => {
    switch (params.weavePattern) {
      case "plain":
        return (warpIdx + weftIdx) % 2 === 0;
      case "twill":
        return (warpIdx + weftIdx * 2) % 3 < 2;
      case "satin":
        return (warpIdx + weftIdx * 3) % 5 < 1;
    }
  };

  const halfThreadW = (params.threadWidth * params.warpSpacing) * 0.5;
  const halfThreadH = (params.threadWidth * params.weftSpacing) * 0.5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let h = params.baseHeight;

      // Find nearest warp thread (vertical threads)
      const warpIdx = Math.round(x / params.warpSpacing);
      const warpCenter = warpIdx * params.warpSpacing + (warpJitter[Math.abs(warpIdx) % maxWarpThreads] || 0);
      const warpDist = Math.abs(x - warpCenter);
      const warpHalfW = halfThreadW * (warpWidthVar[Math.abs(warpIdx) % maxWarpThreads] || 1);

      // Find nearest weft thread (horizontal threads)
      const weftIdx = Math.round(y / params.weftSpacing);
      const weftCenter = weftIdx * params.weftSpacing + (weftJitter[Math.abs(weftIdx) % maxWeftThreads] || 0);
      const weftDist = Math.abs(y - weftCenter);
      const weftHalfW = halfThreadH * (weftWidthVar[Math.abs(weftIdx) % maxWeftThreads] || 1);

      // Thread cross-section profiles
      const warpProfile = warpDist < warpHalfW ? threadProfile(1 - warpDist / warpHalfW) : 0;
      const weftProfile = weftDist < weftHalfW ? threadProfile(1 - weftDist / weftHalfW) : 0;

      // Determine which thread is on top
      const warpOnTop = isWarpOver(
        Math.abs(warpIdx) % 1024,
        Math.abs(weftIdx) % 1024,
      );

      if (warpProfile > 0 && weftProfile > 0) {
        // At intersection: top thread gets full height, bottom gets partial
        if (warpOnTop) {
          h += params.threadHeight * warpProfile;
        } else {
          h += params.threadHeight * weftProfile;
        }
      } else if (warpProfile > 0) {
        h += params.threadHeight * warpProfile * 0.8;
      } else if (weftProfile > 0) {
        h += params.threadHeight * weftProfile * 0.8;
      }
      // In the gaps between threads, height stays at baseHeight (valleys)

      data[y * width + x] = Math.max(0, Math.min(1, h));
    }
  }

  return data;
}

/**
 * Legacy API: Generate paper texture using Perlin noise.
 * Maintained for backward compatibility; new code should use generateCanvasTexture.
 */
export function generatePaperTexture(
  width: number,
  height: number,
  seed: number,
  scale = 8.0,
): Float32Array {
  const rng = splitmix32(seed);

  const GRAD_SIZE = 256;
  const perm = new Uint8Array(512);
  const gradX = new Float32Array(GRAD_SIZE);
  const gradY = new Float32Array(GRAD_SIZE);

  const indices = Array.from({ length: GRAD_SIZE }, (_, i) => i);
  for (let i = GRAD_SIZE - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let i = 0; i < GRAD_SIZE; i++) {
    perm[i] = perm[i + GRAD_SIZE] = indices[i];
    const angle = rng() * Math.PI * 2;
    gradX[i] = Math.cos(angle);
    gradY[i] = Math.sin(angle);
  }

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + t * (b - a);
  const dot = (gi: number, x: number, y: number) =>
    gradX[gi % GRAD_SIZE] * x + gradY[gi % GRAD_SIZE] * y;

  const perlin = (px: number, py: number): number => {
    const xi = Math.floor(px) & 255;
    const yi = Math.floor(py) & 255;
    const xf = px - Math.floor(px);
    const yf = py - Math.floor(py);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    return lerp(
      lerp(dot(aa, xf, yf), dot(ba, xf - 1, yf), u),
      lerp(dot(ab, xf, yf - 1), dot(bb, xf - 1, yf - 1), u),
      v,
    );
  };

  const data = new Float32Array(width * height);
  const invW = scale / width;
  const invH = scale / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n1 = perlin(x * invW, y * invH);
      const n2 = perlin(x * invW * 2, y * invH * 2) * 0.5;
      data[y * width + x] = Math.max(0, Math.min(1, (n1 + n2) * 0.4 + 0.5));
    }
  }

  return data;
}
