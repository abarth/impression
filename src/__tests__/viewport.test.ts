import { describe, it, expect } from "vitest";
import type { ViewTransform } from "../hooks/useViewTransform";

// Test the screen-to-canvas coordinate transform logic
// This is extracted here since the actual function is inline in CanvasViewport
function screenToCanvas(
  screenX: number,
  screenY: number,
  transform: ViewTransform,
): { x: number; y: number } {
  return {
    x: (screenX - transform.tx) / transform.scale,
    y: (screenY - transform.ty) / transform.scale,
  };
}

describe("screenToCanvas coordinate transform", () => {
  it("should be identity when no transform", () => {
    const result = screenToCanvas(100, 200, { tx: 0, ty: 0, scale: 1 });
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("should account for translation", () => {
    const result = screenToCanvas(150, 250, { tx: 50, ty: 50, scale: 1 });
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("should account for scale", () => {
    const result = screenToCanvas(200, 400, { tx: 0, ty: 0, scale: 2 });
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("should account for both translation and scale", () => {
    const result = screenToCanvas(250, 450, { tx: 50, ty: 50, scale: 2 });
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("should handle fractional scale", () => {
    const result = screenToCanvas(50, 100, { tx: 0, ty: 0, scale: 0.5 });
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });
});
