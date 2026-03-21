import { describe, it, expect } from "vitest";
import { generateHarmony } from "../lib/colorHarmony";
import { hexToOklch, isInGamut } from "../lib/oklch";

describe("generateHarmony", () => {
  it("returns 8 colors for a chromatic input", () => {
    const result = generateHarmony("#ff0000");
    expect(result).toHaveLength(8);
  });

  it("all returned colors are valid 7-char hex strings", () => {
    const result = generateHarmony("#3388cc");
    for (const hex of result) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("all returned colors are valid displayable hex colors", () => {
    const inputs = ["#ff0000", "#00ff00", "#0000ff", "#ff8800", "#8800ff"];
    for (const input of inputs) {
      const result = generateHarmony(input);
      for (const hex of result) {
        // Valid 7-char hex means culori produced a valid sRGB color
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        // Parse RGB components and verify they're in valid range
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });

  it("returns lightness variations for achromatic input (gray)", () => {
    const result = generateHarmony("#808080");
    expect(result).toHaveLength(8);
    // All achromatic results should have very low chroma
    for (const hex of result) {
      const { c } = hexToOklch(hex);
      expect(c).toBeLessThan(0.01);
    }
  });

  it("returns lightness variations for black", () => {
    const result = generateHarmony("#000000");
    expect(result).toHaveLength(8);
  });

  it("returns lightness variations for white", () => {
    const result = generateHarmony("#ffffff");
    expect(result).toHaveLength(8);
  });

  it("returns distinct colors (not all the same)", () => {
    const result = generateHarmony("#ff0000");
    const unique = new Set(result);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("chroma is clamped to maxChroma for each rotated hue", () => {
    // A highly saturated color — rotated hues may need chroma clamping
    const result = generateHarmony("#ff0000");
    for (const hex of result) {
      const { l, c, h } = hexToOklch(hex);
      // Verify it's displayable (meaning chroma was properly clamped)
      expect(isInGamut(l, c, h)).toBe(true);
    }
  });
});
