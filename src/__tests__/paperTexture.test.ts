import { describe, it, expect } from "vitest";
import { generatePaperTexture } from "../paperTexture";

describe("generatePaperTexture", () => {
  it("produces values in [0, 1]", () => {
    const data = generatePaperTexture(128, 128, 42);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it("returns correct size", () => {
    const data = generatePaperTexture(64, 32, 1);
    expect(data.length).toBe(64 * 32);
  });

  it("is deterministic for same seed", () => {
    const a = generatePaperTexture(64, 64, 99);
    const b = generatePaperTexture(64, 64, 99);
    expect(a).toEqual(b);
  });

  it("produces different results for different seeds", () => {
    const a = generatePaperTexture(64, 64, 1);
    const b = generatePaperTexture(64, 64, 2);
    // At least some values should differ
    let diffCount = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 0.001) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(a.length * 0.1);
  });

  it("has variation (not all same value)", () => {
    const data = generatePaperTexture(128, 128, 7);
    const min = Math.min(...data);
    const max = Math.max(...data);
    expect(max - min).toBeGreaterThan(0.1);
  });
});
