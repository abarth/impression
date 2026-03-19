import { describe, it, expect } from "vitest";
import { StrokeSmoother } from "../strokeSmoothing";

describe("StrokeSmoother", () => {
  it("passes through points unchanged at smoothing=0", () => {
    const s = new StrokeSmoother();
    s.begin(10, 20, 1.0, 0);

    const p1 = s.move(30, 40, 0.8);
    expect(p1.x).toBeCloseTo(30);
    expect(p1.y).toBeCloseTo(40);
    expect(p1.pressure).toBeCloseTo(0.8);

    const p2 = s.move(50, 60, 0.5);
    expect(p2.x).toBeCloseTo(50);
    expect(p2.y).toBeCloseTo(60);
  });

  it("smooths points toward raw input at high smoothing", () => {
    const s = new StrokeSmoother();
    s.begin(0, 0, 1.0, 0.9);

    // With smoothing=0.9, alpha=0.1 — smoothed point should barely move
    const p1 = s.move(100, 0, 1.0);
    expect(p1.x).toBeGreaterThan(0);
    expect(p1.x).toBeLessThan(20); // should be close to 10 (alpha=0.1)
    expect(p1.y).toBeCloseTo(0);
  });

  it("converges toward raw input with repeated moves", () => {
    const s = new StrokeSmoother();
    s.begin(0, 0, 1.0, 0.5);

    // Keep feeding the same target — should converge
    let pt = { x: 0, y: 0, pressure: 1.0 };
    for (let i = 0; i < 50; i++) {
      pt = s.move(100, 100, 1.0);
    }
    expect(pt.x).toBeCloseTo(100, 0);
    expect(pt.y).toBeCloseTo(100, 0);
  });

  it("returns first point unchanged on begin", () => {
    const s = new StrokeSmoother();
    const pt = s.begin(42, 99, 0.7, 0.8);
    expect(pt.x).toBe(42);
    expect(pt.y).toBe(99);
    expect(pt.pressure).toBe(0.7);
  });

  it("returns catch-up point on end when smoothed position differs", () => {
    const s = new StrokeSmoother();
    s.begin(0, 0, 1.0, 0.9);
    s.move(100, 100, 1.0); // smoothed position is ~(10, 10)

    const catchUp = s.end(100, 100, 1.0);
    expect(catchUp).not.toBeNull();
    expect(catchUp!.x).toBe(100);
    expect(catchUp!.y).toBe(100);
  });

  it("returns null catch-up when already at cursor position", () => {
    const s = new StrokeSmoother();
    s.begin(50, 50, 1.0, 0);
    s.move(50, 50, 1.0);

    const catchUp = s.end(50, 50, 1.0);
    expect(catchUp).toBeNull();
  });

  it("smooths pressure along with position", () => {
    const s = new StrokeSmoother();
    s.begin(0, 0, 1.0, 0.5);

    // alpha = 0.5, so pressure should move halfway
    const pt = s.move(0, 0, 0.0);
    expect(pt.pressure).toBeCloseTo(0.5); // 1.0 + 0.5 * (0 - 1.0) = 0.5
  });

  it("can be reused for multiple strokes", () => {
    const s = new StrokeSmoother();

    // First stroke
    s.begin(0, 0, 1.0, 0.5);
    s.move(100, 100, 1.0);
    s.end(100, 100, 1.0);

    // Second stroke — should reset smoothing state
    const pt = s.begin(0, 0, 1.0, 0.5);
    expect(pt.x).toBe(0);
    expect(pt.y).toBe(0);

    const p2 = s.move(100, 0, 1.0);
    // Should smooth from (0,0) not from the previous stroke's state
    expect(p2.x).toBeCloseTo(50); // alpha=0.5, so 0 + 0.5*100 = 50
    expect(p2.y).toBeCloseTo(0);
  });

  it("handles smoothing=1 (maximum) without freezing", () => {
    const s = new StrokeSmoother();
    s.begin(0, 0, 1.0, 1.0);

    // alpha should be clamped to 0.05 minimum
    const pt = s.move(100, 0, 1.0);
    expect(pt.x).toBeGreaterThan(0); // should move at least a little
    expect(pt.x).toBeCloseTo(5); // 0.05 * 100 = 5
  });
});
