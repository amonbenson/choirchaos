// Enough recent updates to see the clock's real step through a few stalled or skipped ones.
const STEP_HISTORY = 8;

const MILLISECONDS_PER_SECOND = 1000;

function wallClock(): number {
  return performance.now() / MILLISECONDS_PER_SECOND;
}

/**
 * A smooth, never decreasing estimate of `context.currentTime`. Some browsers move `currentTime` only once per
 * audio callback (Firefox on Android: about 0.1 s) or round it (Firefox's reduced timer precision), so stepping
 * playback by it stalls and then leaps, and events scheduled from a stale value land late. Between updates this
 * clock runs on with the wall clock, by at most the smallest recent update step, so it stops when the audio does.
 */
export default class AudioClock {
  private anchor: { contextTime: number; wallTime: number };
  private steps: number[] = [];
  private lastTime = 0;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly getWallTime: () => number = wallClock,
  ) {
    this.anchor = { contextTime: context.currentTime, wallTime: getWallTime() };
  }

  now(): number {
    const contextTime = this.context.currentTime;
    const wallTime = this.getWallTime();
    if (contextTime !== this.anchor.contextTime) {
      this.steps = [...this.steps, contextTime - this.anchor.contextTime].slice(-STEP_HISTORY);
      this.anchor = { contextTime, wallTime };
    }

    const maxElapsed = this.steps.length > 0 ? Math.min(...this.steps) : 0;
    const elapsed = Math.min(Math.max(0, wallTime - this.anchor.wallTime), maxElapsed);
    this.lastTime = Math.max(this.lastTime, contextTime + elapsed);
    return this.lastTime;
  }
}
