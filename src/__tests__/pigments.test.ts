import { describe, it, expect } from "vitest";
import { PIGMENTS, getPigmentById, getPigmentKS, type Pigment } from "../pigments";

// JS reference of K-M reflectance (mirrors the WGSL implementation)
function kmReflectance(K: number[], S: number[]): number[] {
  return K.map((k, i) => {
    const s = S[i];
    if (s < 1e-6) return 0;
    const a = k / s;
    return Math.max(0, Math.min(1, 1 + a - Math.sqrt(a * a + 2 * a)));
  });
}

describe("pigment database", () => {
  it("loads all 12 pigments", () => {
    expect(PIGMENTS).toHaveLength(12);
  });

  it("every pigment has required fields", () => {
    for (const p of PIGMENTS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.rgb).toHaveLength(3);
      expect(p.K).toHaveLength(3);
      expect(p.S).toHaveLength(3);
      expect(["opaque", "semi-opaque", "semi-transparent", "transparent"]).toContain(
        p.opacity,
      );
    }
  });

  it("RGB values are in 0–255 range", () => {
    for (const p of PIGMENTS) {
      for (const v of p.rgb) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("K and S coefficients are non-negative", () => {
    for (const p of PIGMENTS) {
      for (const v of [...p.K, ...p.S]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("pigment IDs are unique", () => {
    const ids = PIGMENTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getPigmentById", () => {
  it("finds existing pigments", () => {
    const tw = getPigmentById("titanium_white");
    expect(tw).toBeDefined();
    expect(tw!.name).toBe("Titanium White");
  });

  it("returns undefined for unknown id", () => {
    expect(getPigmentById("nonexistent")).toBeUndefined();
  });
});

describe("getPigmentKS", () => {
  it("returns Float32Arrays with correct values", () => {
    const tw = getPigmentById("titanium_white")!;
    const { K, S } = getPigmentKS(tw);
    expect(K).toBeInstanceOf(Float32Array);
    expect(S).toBeInstanceOf(Float32Array);
    expect(K.length).toBe(3);
    expect(S.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(K[i]).toBeCloseTo(tw.K[i], 4);
      expect(S[i]).toBeCloseTo(tw.S[i], 4);
    }
  });
});

describe("K-M reflectance matches listed RGB", () => {
  // Allow ±15 per channel (out of 255) — "reasonably close"
  const TOLERANCE = 15;

  for (const p of (
    // Eagerly evaluate so PIGMENTS is loaded at describe time
    (() => {
      // We need pigments from the import; use a simple re-import pattern
      return PIGMENTS;
    })()
  )) {
    it(`${p.name} (${p.id})`, () => {
      const refl = kmReflectance(p.K, p.S);
      const computed = refl.map((r) => Math.round(r * 255));
      for (let i = 0; i < 3; i++) {
        expect(
          Math.abs(computed[i] - p.rgb[i]),
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  }
});

describe("K-M color mixing behavior", () => {
  it("white + black gives a mid-gray", () => {
    const white = getPigmentById("titanium_white")!;
    const black = getPigmentById("ivory_black")!;
    const mixK = white.K.map((k, i) => (k + black.K[i]) / 2);
    const mixS = white.S.map((s, i) => (s + black.S[i]) / 2);
    const refl = kmReflectance(mixK, mixS);
    // Gray: all channels similar (within 0.08 of each other)
    expect(Math.abs(refl[0] - refl[1])).toBeLessThan(0.08);
    expect(Math.abs(refl[1] - refl[2])).toBeLessThan(0.08);
    // Mid-tone: between 0.15 and 0.85
    for (const r of refl) {
      expect(r).toBeGreaterThan(0.15);
      expect(r).toBeLessThan(0.85);
    }
  });

  it("blue + yellow produces subtractive mix (not gray like RGB averaging)", () => {
    const yellow = getPigmentById("cadmium_yellow")!;
    const blue = getPigmentById("ultramarine_blue")!;

    // K-M mixing
    const mixK = yellow.K.map((k, i) => (k + blue.K[i]) / 2);
    const mixS = yellow.S.map((s, i) => (s + blue.S[i]) / 2);
    const kmRefl = kmReflectance(mixK, mixS);

    // Simple RGB average (additive)
    const rgbAvg = yellow.rgb.map((c, i) => (c + blue.rgb[i]) / 2 / 255);

    // K-M mixing should produce a much darker blue channel than RGB averaging
    // because both pigments absorb blue (subtractive mixing)
    expect(kmRefl[2]).toBeLessThan(rgbAvg[2] - 0.1);

    // The green channel should survive better than blue in K-M mix
    expect(kmRefl[1]).toBeGreaterThan(kmRefl[2]);
  });
});
