import { describe, it, expect } from "vitest";
import { hexToRgb } from "../hooks/useColorState";

describe("hexToRgb", () => {
  it("should parse black", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("should parse white", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  it("should parse red", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
  });

  it("should parse without hash prefix", () => {
    expect(hexToRgb("00ff00")).toEqual([0, 255, 0]);
  });

  it("should parse mixed color", () => {
    expect(hexToRgb("#8040c0")).toEqual([128, 64, 192]);
  });
});
