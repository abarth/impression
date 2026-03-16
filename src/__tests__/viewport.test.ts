import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ViewTransform } from "../hooks/useViewTransform";
import { useViewTransform } from "../hooks/useViewTransform";

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

describe("zoom anchor point stability", () => {
  // The canvas point under the anchor should remain at the same screen position
  // after zooming. This is what "zoom toward cursor" means.
  function canvasPointAtScreen(
    screenX: number,
    screenY: number,
    t: ViewTransform,
  ) {
    return {
      x: (screenX - t.tx) / t.scale,
      y: (screenY - t.ty) / t.scale,
    };
  }

  it("should keep anchor point fixed after zoom in", () => {
    const { result } = renderHook(() => useViewTransform());
    const anchorX = 300;
    const anchorY = 200;

    // Get canvas point under anchor before zoom
    const before = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    // Zoom in (negative delta = zoom in)
    act(() => result.current.zoom(-10, anchorX, anchorY));

    // Get canvas point under anchor after zoom
    const after = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("should keep anchor point fixed after multiple zooms at same point", () => {
    const { result } = renderHook(() => useViewTransform());
    const anchorX = 400;
    const anchorY = 350;

    const before = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    // Multiple zoom steps at the same anchor
    act(() => result.current.zoom(-5, anchorX, anchorY));
    act(() => result.current.zoom(-5, anchorX, anchorY));
    act(() => result.current.zoom(-5, anchorX, anchorY));

    const after = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("should keep anchor point fixed after zoom out", () => {
    const { result } = renderHook(() => useViewTransform());
    const anchorX = 250;
    const anchorY = 150;

    const before = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    // Zoom out (positive delta = zoom out)
    act(() => result.current.zoom(10, anchorX, anchorY));

    const after = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("should keep anchor fixed after pan then zoom at same viewport-local point", () => {
    const { result } = renderHook(() => useViewTransform());

    // Pan to simulate an offset canvas
    act(() => result.current.pan(100, 50));

    const anchorX = 300;
    const anchorY = 200;

    const before = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    // Zoom multiple times at the same viewport-local anchor
    act(() => result.current.zoom(-5, anchorX, anchorY));
    act(() => result.current.zoom(-5, anchorX, anchorY));
    act(() => result.current.zoom(3, anchorX, anchorY));

    const after = canvasPointAtScreen(
      anchorX,
      anchorY,
      result.current.transform,
    );

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});
