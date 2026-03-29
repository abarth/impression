import { describe, it, expect } from "vitest";

// JS reference implementation of Kubelka-Munk reflectance
function kmReflectance(K: number[], S: number[]): number[] {
  return K.map((k, i) => {
    const s = S[i];
    if (s < 1e-6) return 0;
    const a = k / s;
    return Math.max(0, Math.min(1, 1 + a - Math.sqrt(a * a + 2 * a)));
  });
}

function kmMix(
  K1: number[],
  S1: number[],
  K2: number[],
  S2: number[],
  t: number,
): { K: number[]; S: number[] } {
  return {
    K: K1.map((k, i) => k * (1 - t) + K2[i] * t),
    S: S1.map((s, i) => s * (1 - t) + S2[i] * t),
  };
}

function kmLayerOver(
  baseK: number[],
  baseS: number[],
  glazeK: number[],
  glazeS: number[],
  thickness: number,
): number[] {
  const rBase = kmReflectance(baseK, baseS);
  if (thickness < 1e-6) return rBase;
  const rGlaze = kmReflectance(glazeK, glazeS);
  return rGlaze.map((rg, i) => {
    const t2 = Math.exp(-2 * glazeS[i] * thickness);
    const rb = rBase[i];
    const denom = 1 - rg * rb * t2;
    if (Math.abs(denom) < 1e-8) return rg;
    const result = rg + (1 - rg) * (1 - rg) * rb * t2 / denom;
    return Math.max(0, Math.min(1, result));
  });
}

describe("Kubelka-Munk reflectance math", () => {
  it("returns 1.0 for K=0 (no absorption)", () => {
    const R = kmReflectance([0, 0, 0], [1, 1, 1]);
    R.forEach((r) => expect(r).toBeCloseTo(1.0, 4));
  });

  it("returns 0.0 for S=0 (no scattering)", () => {
    const R = kmReflectance([0.5, 0.5, 0.5], [0, 0, 0]);
    R.forEach((r) => expect(r).toBe(0));
  });

  it("handles K=0 and S=0 simultaneously (fully transparent)", () => {
    const R = kmReflectance([0, 0, 0], [0, 0, 0]);
    R.forEach((r) => expect(r).toBe(0));
  });

  it("returns ~0.268 for equal K and S", () => {
    // K/S = 1 → R = 2 - sqrt(3) ≈ 0.2679
    const R = kmReflectance([1, 1, 1], [1, 1, 1]);
    R.forEach((r) => expect(r).toBeCloseTo(2 - Math.sqrt(3), 3));
  });

  it("returns values in [0, 1] for a range of K/S ratios", () => {
    const ratios = [0.001, 0.01, 0.1, 0.5, 1.0, 2.0, 10.0, 100.0];
    for (const ratio of ratios) {
      const R = kmReflectance([ratio], [1]);
      expect(R[0]).toBeGreaterThanOrEqual(0);
      expect(R[0]).toBeLessThanOrEqual(1);
    }
  });

  it("reflectance decreases as K/S increases", () => {
    let prev = 1.0;
    for (const k of [0.01, 0.1, 0.5, 1.0, 5.0, 50.0]) {
      const R = kmReflectance([k], [1]);
      expect(R[0]).toBeLessThan(prev);
      prev = R[0];
    }
  });

  it("very large K/S gives near-zero reflectance", () => {
    const R = kmReflectance([100], [1]);
    expect(R[0]).toBeLessThan(0.005);
  });
});

describe("Kubelka-Munk mixing", () => {
  it("t=0 returns first pigment unchanged", () => {
    const { K, S } = kmMix([0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9], [1, 1, 1], 0);
    expect(K).toEqual([0.1, 0.2, 0.3]);
    expect(S).toEqual([0.4, 0.5, 0.6]);
  });

  it("t=1 returns second pigment unchanged", () => {
    const { K, S } = kmMix([0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9], [1, 1, 1], 1);
    expect(K).toEqual([0.7, 0.8, 0.9]);
    expect(S).toEqual([1, 1, 1]);
  });

  it("t=0.5 gives arithmetic mean", () => {
    const { K, S } = kmMix([0.2, 0.4, 0.6], [0.8, 0.6, 0.4], [0.6, 0.2, 0.8], [0.4, 1.0, 0.2], 0.5);
    K.forEach((k, i) =>
      expect(k).toBeCloseTo(([0.2, 0.4, 0.6][i] + [0.6, 0.2, 0.8][i]) / 2, 10),
    );
    S.forEach((s, i) =>
      expect(s).toBeCloseTo(([0.8, 0.6, 0.4][i] + [0.4, 1.0, 0.2][i]) / 2, 10),
    );
  });
});

describe("Kubelka-Munk layering", () => {
  it("thick glaze (large thickness) converges to glaze reflectance", () => {
    const baseK = [0.01, 0.01, 0.01];
    const baseS = [0.9, 0.9, 0.9];
    const glazeK = [0.5, 0.1, 0.3];
    const glazeS = [0.3, 0.6, 0.4];
    const result = kmLayerOver(baseK, baseS, glazeK, glazeS, 100);
    const glazeRefl = kmReflectance(glazeK, glazeS);
    result.forEach((r, i) => expect(r).toBeCloseTo(glazeRefl[i], 2));
  });

  it("zero thickness preserves base reflectance", () => {
    const baseK = [0.05, 0.05, 0.05];
    const baseS = [0.8, 0.8, 0.8];
    const glazeK = [0.5, 0.1, 0.3];
    const glazeS = [0.3, 0.6, 0.4];
    const result = kmLayerOver(baseK, baseS, glazeK, glazeS, 0);
    const baseRefl = kmReflectance(baseK, baseS);
    result.forEach((r, i) => expect(r).toBeCloseTo(baseRefl[i], 2));
  });

  it("glaze darkens a bright base", () => {
    const whiteK = [0.001, 0.001, 0.001];
    const whiteS = [0.9, 0.9, 0.9];
    const glazeK = [0.3, 0.3, 0.3];
    const glazeS = [0.2, 0.2, 0.2];
    const baseRefl = kmReflectance(whiteK, whiteS);
    const result = kmLayerOver(whiteK, whiteS, glazeK, glazeS, 1.0);
    result.forEach((r, i) => expect(r).toBeLessThan(baseRefl[i]));
  });
});
