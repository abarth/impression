import { describe, it, expect } from "vitest";
import { BLEND_MODES, BLEND_MODE_COUNT, BLEND_MODE_GROUPS } from "../blendModes";

describe("BLEND_MODES", () => {
  it("should have 20 blend modes", () => {
    expect(BLEND_MODE_COUNT).toBe(20);
    expect(BLEND_MODES).toHaveLength(20);
  });

  it("should start with Normal at value 0", () => {
    expect(BLEND_MODES[0]).toMatchObject({ value: 0, label: "Normal" });
  });

  it("should have sequential values", () => {
    BLEND_MODES.forEach((mode, i) => {
      expect(mode.value).toBe(i);
    });
  });

  it("should include common Photoshop modes", () => {
    const labels = BLEND_MODES.map((m) => m.label);
    expect(labels).toContain("Multiply");
    expect(labels).toContain("Screen");
    expect(labels).toContain("Overlay");
    expect(labels).toContain("Soft Light");
    expect(labels).toContain("Hard Light");
    expect(labels).toContain("Darken");
    expect(labels).toContain("Lighten");
    expect(labels).toContain("Color Dodge");
    expect(labels).toContain("Color Burn");
    expect(labels).toContain("Difference");
    expect(labels).toContain("Exclusion");
  });

  it("should have 5 groups", () => {
    expect(BLEND_MODE_GROUPS).toHaveLength(5);
    expect(BLEND_MODE_GROUPS.map(g => g.group)).toEqual([
      "Normal", "Darken", "Lighten", "Contrast", "Inversion",
    ]);
  });

  it("should have all modes across groups", () => {
    const total = BLEND_MODE_GROUPS.reduce((sum, g) => sum + g.modes.length, 0);
    expect(total).toBe(20);
  });
});
