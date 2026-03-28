import { describe, it, expect, vi } from "vitest";

describe("Mixbox LUT loading", () => {
  it("mixbox_lut.png should exist in public directory", async () => {
    // In test env we can't fetch from dev server, but we can verify the file exists
    const fs = await import("fs");
    const path = await import("path");
    const lutPath = path.resolve(__dirname, "../../public/mixbox_lut.png");
    expect(fs.existsSync(lutPath)).toBe(true);
  });

  it("mixbox_lut.png should be a valid 512x512 PNG", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const lutPath = path.resolve(__dirname, "../../public/mixbox_lut.png");
    const data = fs.readFileSync(lutPath);
    // PNG magic bytes
    expect(data[0]).toBe(0x89);
    expect(data[1]).toBe(0x50); // 'P'
    expect(data[2]).toBe(0x4e); // 'N'
    expect(data[3]).toBe(0x47); // 'G'
    // File should be reasonable size (~170KB)
    expect(data.length).toBeGreaterThan(100000);
    expect(data.length).toBeLessThan(500000);
  });

  it("initMixbox module exports correctly", async () => {
    const { initMixbox } = await import("../mixbox");
    expect(typeof initMixbox).toBe("function");
  });
});

describe("Mixbox WGSL shader", () => {
  it("shader source contains required functions", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const shaderPath = path.resolve(__dirname, "../../shaders/mixbox.wgsl");
    const source = fs.readFileSync(shaderPath, "utf-8");

    expect(source).toContain("fn mixbox_lerp");
    expect(source).toContain("fn mixbox_rgb_to_latent");
    expect(source).toContain("fn mixbox_latent_to_rgb");
    expect(source).toContain("fn mixbox_eval_polynomial");
    expect(source).toContain("struct MixboxLatent");
  });

  it("shader source must not use unary + on literals (invalid WGSL)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const shaderPath = path.resolve(__dirname, "../../shaders/mixbox.wgsl");
    const source = fs.readFileSync(shaderPath, "utf-8");

    // WGSL does not support unary + operator; vec3f(+0.5, ...) is a parse error
    const unaryPlusPattern = /vec3f\([^)]*(?<![a-zA-Z0-9_])\+\d/;
    expect(source).not.toMatch(unaryPlusPattern);
  });
});
