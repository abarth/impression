/**
 * Deterministic 2D Perlin noise generator for canvas grain texture.
 * Produces an R32Float texture representing paper surface height.
 */

/** Seeded hash for gradient table generation (splitmix32). */
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

/** Generate 2D Perlin noise in [0, 1] for the given dimensions and seed. */
export function generatePaperTexture(
  width: number,
  height: number,
  seed: number,
  scale = 8.0,
): Float32Array {
  const rng = splitmix32(seed);

  // Gradient table (256 random unit vectors)
  const GRAD_SIZE = 256;
  const perm = new Uint8Array(512);
  const gradX = new Float32Array(GRAD_SIZE);
  const gradY = new Float32Array(GRAD_SIZE);

  // Shuffle permutation table
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
      // Two octaves for natural-looking paper grain
      const n1 = perlin(x * invW, y * invH);
      const n2 = perlin(x * invW * 2, y * invH * 2) * 0.5;
      // Map from [-1.25, 1.25] to [0, 1]
      data[y * width + x] = Math.max(0, Math.min(1, (n1 + n2) * 0.4 + 0.5));
    }
  }

  return data;
}
