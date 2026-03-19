/**
 * Stroke input smoother using exponential moving average.
 *
 * At each input point, the smoothed position is:
 *   smoothed = prev_smoothed + alpha * (raw - prev_smoothed)
 *
 * where alpha = 1 - smoothing. At smoothing=0, alpha=1 (no smoothing).
 * At smoothing=1, alpha=0 (never moves — clamped to a minimum).
 *
 * Pressure is smoothed with the same factor to avoid abrupt pressure jumps.
 */

export interface SmoothedPoint {
  x: number;
  y: number;
  pressure: number;
}

export class StrokeSmoother {
  private sx: number = 0;
  private sy: number = 0;
  private sp: number = 0;
  private active: boolean = false;
  private alpha: number = 1;
  private catchUp: boolean = false;

  /**
   * Begin a new stroke.
   * @param smoothing 0–1, where 0 = no smoothing, 1 = maximum smoothing
   */
  begin(x: number, y: number, pressure: number, smoothing: number): SmoothedPoint {
    // alpha = 1 means "jump to raw input" (no smoothing).
    // Clamp minimum alpha so we never freeze entirely.
    this.alpha = Math.max(0.05, 1 - smoothing);
    this.sx = x;
    this.sy = y;
    this.sp = pressure;
    this.active = true;
    this.catchUp = false;
    return { x, y, pressure };
  }

  /**
   * Smooth a move event. Returns the smoothed point.
   */
  move(x: number, y: number, pressure: number): SmoothedPoint {
    if (!this.active || this.catchUp) {
      return { x, y, pressure };
    }
    const a = this.alpha;
    this.sx += a * (x - this.sx);
    this.sy += a * (y - this.sy);
    this.sp += a * (pressure - this.sp);
    return { x: this.sx, y: this.sy, pressure: this.sp };
  }

  /**
   * End the stroke. Returns a final catch-up point at the raw cursor
   * position so the stroke endpoint is accurate.
   */
  end(x: number, y: number, pressure: number): SmoothedPoint | null {
    if (!this.active) return null;
    this.active = false;
    this.catchUp = true;

    // If we're already very close, no catch-up needed.
    const dx = x - this.sx;
    const dy = y - this.sy;
    if (dx * dx + dy * dy < 0.5) return null;

    return { x, y, pressure };
  }

  /** Whether a stroke is in progress. */
  get isActive(): boolean {
    return this.active;
  }
}
