import { describe, expect, it } from "vitest";

import { getPulse } from "./pulse";

describe("getPulse", () => {
  it.each([
    ["4/4 at 120", 120, 4, 1, { noteValue: "quarter", bpm: 120, beatsPerPulse: 1 }],
    ["4/4 at 210", 210, 4, 1, { noteValue: "half", bpm: 105, beatsPerPulse: 2 }],
    ["3/4 at 120", 120, 3, 1, { noteValue: "quarter", bpm: 120, beatsPerPulse: 1 }],
    ["3/4 at 210", 210, 3, 1, { noteValue: "dottedHalf", bpm: 70, beatsPerPulse: 3 }],
    ["2/2 at 100", 100, 2, 2, { noteValue: "half", bpm: 100, beatsPerPulse: 1 }],
    ["6/8 at 180", 180, 6, 0.5, { noteValue: "dottedQuarter", bpm: 60, beatsPerPulse: 3 }],
    ["6/8 at 540", 540, 6, 0.5, { noteValue: "dottedHalf", bpm: 90, beatsPerPulse: 6 }],
    ["12/8 at 180", 180, 12, 0.5, { noteValue: "dottedQuarter", bpm: 60, beatsPerPulse: 3 }],
    ["6/4 at 180", 180, 6, 1, { noteValue: "dottedHalf", bpm: 60, beatsPerPulse: 3 }],
    ["7/8 at 280", 280, 7, 0.5, { noteValue: "quarter", bpm: 140, beatsPerPulse: 2 }],
  ])("beats %s", (_, beatBpm, beats, beatQuarters, expected) => {
    expect(getPulse(beatBpm, beats, beatQuarters)).toEqual(expected);
  });

  it("keeps the longest pulse when even that is too fast", () => {
    expect(getPulse(800, 4, 1)).toEqual({ noteValue: "half", bpm: 400, beatsPerPulse: 2 });
  });

  it("counts compound bars without a time signature in eighths", () => {
    expect(getPulse(180, 6)).toEqual({ noteValue: "dottedQuarter", bpm: 60, beatsPerPulse: 3 });
    expect(getPulse(120, 4)).toEqual({ noteValue: "quarter", bpm: 120, beatsPerPulse: 1 });
  });
});
