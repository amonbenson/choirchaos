// Wheel deltas arrive in pixels, lines or pages depending on browser and device. Firefox on macOS
// reports lines, which would make every wheel tick a huge zoom step without scaling them to pixels.
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

export function normalizeWheelDelta(event: Pick<WheelEvent, "deltaY" | "deltaMode">): number {
  switch (event.deltaMode) {
    case 1:
      return event.deltaY * LINE_HEIGHT_PX;
    case 2:
      return event.deltaY * PAGE_HEIGHT_PX;
    default:
      return event.deltaY;
  }
}

export type ZoomLadderOptions = {
  min: number;
  max: number;
  stepsPerDoubling?: number;
  pixelsPerStep?: number;
};

/**
 * Zoom levels on a geometric ladder between min and max. Wheel input accumulates until it covers
 * a full step, so trackpads (many small deltas) and mice (few large deltas) zoom equally fast,
 * and caches keyed by level stay small because only ladder values ever occur.
 */
export class ZoomLadder {
  private readonly ratio: number;
  private readonly pixelsPerStep: number;
  private pendingPixels = 0;

  constructor(private readonly options: ZoomLadderOptions) {
    this.ratio = Math.pow(2, 1 / (options.stepsPerDoubling ?? 4));
    this.pixelsPerStep = options.pixelsPerStep ?? 50;
  }

  public clamp(value: number): number {
    return Math.min(this.options.max, Math.max(this.options.min, value));
  }

  public snap(value: number): number {
    const step = Math.round(Math.log(value / this.options.min) / Math.log(this.ratio));
    return this.clamp(this.options.min * Math.pow(this.ratio, step));
  }

  public step(value: number, steps: number): number {
    return this.snap(this.snap(value) * Math.pow(this.ratio, steps));
  }

  /** Returns the next level after a wheel delta in pixels. Positive deltas zoom out (larger values). */
  public applyWheel(value: number, deltaPixels: number): number {
    this.pendingPixels += deltaPixels;
    const steps = Math.trunc(this.pendingPixels / this.pixelsPerStep);
    this.pendingPixels -= steps * this.pixelsPerStep;
    return steps === 0 ? value : this.step(value, steps);
  }
}

/**
 * Scroll offset in pixels after zooming, chosen so that the tick under the pointer stays under the
 * pointer.
 */
export function getAnchoredOffset(anchorTick: number, anchorX: number, ticksPerPixel: number): number {
  return Math.max(0, Math.round(anchorTick / ticksPerPixel - anchorX));
}
