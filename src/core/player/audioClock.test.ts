import { describe, expect, it } from "vitest";

import AudioClock from "./audioClock";

/** A context clock that moves only in `step`s, like Firefox on Android, and a wall clock the test moves. */
function makeClock(): { clock: AudioClock; context: { currentTime: number }; advance: (seconds: number, step: number) => void } {
  const context = { currentTime: 0 };
  let wallTime = 0;
  const clock = new AudioClock(context as BaseAudioContext, () => wallTime);
  return {
    clock,
    context,
    advance: (seconds, step) => {
      wallTime += seconds;
      context.currentTime = Math.floor(wallTime / step + 1e-9) * step;
    },
  };
}

describe("AudioClock", () => {
  it("follows a fine context clock", () => {
    const { clock, advance } = makeClock();
    advance(0.02, 0.0025);
    advance(0.02, 0.0025);

    expect(clock.now()).toBeCloseTo(0.04, 6);
  });

  it("runs on smoothly between the updates of a coarse context clock", () => {
    const { clock, advance } = makeClock();
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      advance(0.02, 0.1);
      times.push(clock.now());
    }

    expect(times.slice(-4).map(time => Number(time.toFixed(3)))).toEqual([0.24, 0.26, 0.28, 0.3]);
  });

  it("stops one update step past the context clock when the audio stops", () => {
    const { clock, context, advance } = makeClock();
    for (let i = 0; i < 10; i++) {
      advance(0.02, 0.1);
      clock.now();
    }

    const frozen = context.currentTime;
    for (let i = 0; i < 20; i++) {
      advance(0.02, 0.1);
      context.currentTime = frozen;
    }

    expect(clock.now()).toBeCloseTo(frozen + 0.1, 6);
  });

  it("never goes back when the context clock lands behind the estimate", () => {
    const { clock, context, advance } = makeClock();
    for (let i = 0; i < 14; i++) {
      advance(0.02, 0.1);
      clock.now();
    }

    const before = clock.now();
    context.currentTime = before - 0.01;

    expect(clock.now()).toBe(before);
  });
});
