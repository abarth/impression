import { hexToOklch, oklchToHex, maxChroma } from "./oklch";

/**
 * Classic color harmony hue offsets (degrees from base hue).
 * Produces 8 swatches: complementary, triadic ×2, split-complementary ×2, analogous ×4.
 */
const HARMONY_OFFSETS = [30, -30, 60, -60, 120, 150, 180, 210];

/**
 * Lightness steps used for achromatic fallback when the source color has no hue.
 */
const ACHROMATIC_LIGHTNESS = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];

/**
 * Generate a set of harmonious colors from a hex foreground color.
 *
 * For chromatic colors, rotates the OKLCH hue through classic harmony angles
 * while clamping chroma to stay in sRGB gamut (inspired by the Evil Martians
 * harmonizer approach of using OKLCH for perceptual consistency).
 *
 * For achromatic colors (grays, black, white), generates lightness variations
 * since there is no meaningful hue to rotate.
 */
export function generateHarmony(hex: string): string[] {
  const { l, c, h } = hexToOklch(hex);

  // Achromatic fallback — no hue to rotate
  if (c < 0.01) {
    return ACHROMATIC_LIGHTNESS.map((lv) => oklchToHex(lv, 0, 0));
  }

  return HARMONY_OFFSETS.map((offset) => {
    const newHue = ((h + offset) % 360 + 360) % 360;
    // Apply 0.99 safety factor — maxChroma binary search can land on the gamut
    // boundary, and hex round-tripping may push it slightly out.
    const mc = maxChroma(l, newHue) * 0.99;
    const clampedC = Math.min(c, mc);
    return oklchToHex(l, clampedC, newHue);
  });
}
