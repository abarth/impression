import { describe, it, expect } from "vitest";
import { BLEND_MODES, BLEND_MODE_COUNT, getBlendState } from "../blendModes";

describe("BLEND_MODES", () => {
  it("should have 11 blend modes", () => {
    expect(BLEND_MODE_COUNT).toBe(11);
    expect(BLEND_MODES).toHaveLength(11);
  });

  it("should start with Normal at value 0", () => {
    expect(BLEND_MODES[0]).toEqual({ value: 0, label: "Normal" });
  });

  it("should have sequential values", () => {
    BLEND_MODES.forEach((mode, i) => {
      expect(mode.value).toBe(i);
    });
  });
});

describe("getBlendState", () => {
  it("should return Normal (source-over) for mode 0", () => {
    const state = getBlendState(0);
    expect(state.color.srcFactor).toBe("one");
    expect(state.color.dstFactor).toBe("one-minus-src-alpha");
  });

  it("should return Copy for mode 10", () => {
    const state = getBlendState(10);
    expect(state.color.srcFactor).toBe("one");
    expect(state.color.dstFactor).toBe("zero");
  });

  it("should return Lighter (add) for mode 9", () => {
    const state = getBlendState(9);
    expect(state.color.srcFactor).toBe("one");
    expect(state.color.dstFactor).toBe("one");
  });

  it("should fall back to Normal for unknown mode", () => {
    const state = getBlendState(999);
    expect(state.color.srcFactor).toBe("one");
    expect(state.color.dstFactor).toBe("one-minus-src-alpha");
  });

  it("should return valid blend state for all modes", () => {
    for (let i = 0; i < BLEND_MODE_COUNT; i++) {
      const state = getBlendState(i);
      expect(state.color).toBeDefined();
      expect(state.alpha).toBeDefined();
      expect(state.color.operation).toBe("add");
      expect(state.alpha.operation).toBe("add");
    }
  });
});
