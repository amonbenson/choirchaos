import { describe, expect, it } from "vitest";

import Measure from "./measure";
import {
  addMeasureToSpans,
  compareLocations,
  countOccurrences,
  deserializeLocation,
  expandRecording,
  findPosition,
  findRecordedPasses,
  type Location,
  type RecordingSpan,
  removeMeasureFromSpans,
  serializeLocation,
  validateLocation,
} from "./recording";

// IDs equal labels here, so spans and timelines read like the recording examples of the spec.
function makeScore(...labels: string[]): Measure[] {
  return labels.map(label => new Measure(label, label, 4));
}

function spans(...ranges: [string, string][]): RecordingSpan[] {
  return ranges.map(([from, to]) => ({ from, to }));
}

function played(measures: Measure[], recording: RecordingSpan[]): string[] {
  return expandRecording(measures, recording).map(entry => `${entry.measure}.${entry.occurrence}`);
}

const SCORE = makeScore("1", "2", "3", "4", "5", "6");

describe("expandRecording", () => {
  it("plays a span straight through", () => {
    expect(expandRecording(SCORE, spans(["1", "3"]))).toEqual([
      { position: 0, measure: "1", occurrence: 1 },
      { position: 1, measure: "2", occurrence: 1 },
      { position: 2, measure: "3", occurrence: 1 },
    ]);
  });

  it("counts occurrences across spans", () => {
    expect(played(SCORE, spans(["1", "3"], ["2", "3"], ["4", "4"]))).toEqual(["1.1", "2.1", "3.1", "2.2", "3.2", "4.1"]);
  });

  it("plays first and second endings", () => {
    const score = makeScore("1", "2", "3a", "3b", "4");

    expect(played(score, spans(["1", "3a"], ["1", "2"], ["3b", "4"]))).toEqual(["1.1", "2.1", "3a.1", "1.2", "2.2", "3b.1", "4.1"]);
  });

  it("is empty without spans", () => {
    expect(expandRecording(SCORE, [])).toEqual([]);
  });

  it("rejects spans with unknown measures or against score order", () => {
    expect(() => expandRecording(SCORE, spans(["1", "9"]))).toThrow(RangeError);
    expect(() => expandRecording(SCORE, spans(["3", "1"]))).toThrow(RangeError);
  });
});

describe("locations", () => {
  const timeline = expandRecording(SCORE, spans(["1", "3"], ["2", "3"]));

  it("finds the position of a measure occurrence", () => {
    expect(findPosition(timeline, { measure: "2", occurrence: 2 })).toBe(3);
    expect(findPosition(timeline, { measure: "2", occurrence: 3 })).toBeUndefined();
    expect(findPosition(timeline, { measure: "6", occurrence: 1 })).toBeUndefined();
  });

  it("counts how often a measure plays", () => {
    expect(countOccurrences(timeline, "2")).toBe(2);
    expect(countOccurrences(timeline, "1")).toBe(1);
    expect(countOccurrences(timeline, "6")).toBe(0);
  });

  it("orders locations by position, then beat, and unresolved ones last", () => {
    const at = (measure: string, beat: number, occurrence = 1): Location => ({ measure, beat, occurrence });

    expect(compareLocations(timeline, at("3", 0), at("2", 0, 2))).toBeLessThan(0);
    expect(compareLocations(timeline, at("2", 3), at("2", 1))).toBeGreaterThan(0);
    expect(compareLocations(timeline, at("6", 0), at("3", 0, 2))).toBeGreaterThan(0);
  });

  it("explains why a location does not resolve", () => {
    expect(validateLocation(SCORE, timeline, { measure: "2", beat: 3, occurrence: 2 })).toBeUndefined();
    expect(validateLocation(SCORE, timeline, { measure: "x", beat: 0, occurrence: 1 })).toMatch(/does not exist/);
    expect(validateLocation(SCORE, timeline, { measure: "2", beat: 4, occurrence: 1 })).toMatch(/no beat 5/);
    expect(validateLocation(SCORE, timeline, { measure: "2", beat: 0.5, occurrence: 1 })).toMatch(/no beat/);
    expect(validateLocation(SCORE, timeline, { measure: "2", beat: 0, occurrence: 3 })).toMatch(/not played 3 times/);
    expect(validateLocation(SCORE, timeline, { measure: "6", beat: 0, occurrence: 1 })).toMatch(/not played/);
  });

  it("stores the first occurrence without the occurrence field", () => {
    expect(serializeLocation({ measure: "2", beat: 1, occurrence: 1 })).toEqual({ measure: "2", beat: 1 });
    expect(serializeLocation({ measure: "2", beat: 1, occurrence: 2 })).toEqual({ measure: "2", beat: 1, occurrence: 2 });
    expect(deserializeLocation({ measure: "2", beat: 1 })).toEqual({ measure: "2", beat: 1, occurrence: 1 });
  });
});

describe("findRecordedPasses", () => {
  const range = (from: string, to: string, fromOccurrence = 1, toOccurrence = 1): { from: Location; to: Location } => ({
    from: { measure: from, beat: 0, occurrence: fromOccurrence },
    to: { measure: to, beat: 3, occurrence: toOccurrence },
  });

  it("finds a single pass when the recording plays the range once", () => {
    const timeline = expandRecording(SCORE, spans(["1", "6"]));

    expect(findRecordedPasses(timeline, range("2", "3"))).toEqual([{ first: 1, last: 2 }]);
  });

  it("finds every back-to-back repetition", () => {
    const timeline = expandRecording(SCORE, spans(["1", "3"], ["2", "3"], ["2", "4"]));

    expect(findRecordedPasses(timeline, range("2", "3"))).toEqual([
      { first: 1, last: 2 },
      { first: 3, last: 4 },
      { first: 5, last: 6 },
    ]);
  });

  it("finds baked passes of a single measure", () => {
    const timeline = expandRecording(SCORE, spans(["1", "2"], ["2", "2"], ["2", "2"], ["2", "4"]));

    expect(findRecordedPasses(timeline, range("2", "2"))).toHaveLength(4);
  });

  it("does not count passes with a different ending", () => {
    const score = makeScore("1", "2", "3a", "3b", "4");
    const timeline = expandRecording(score, spans(["1", "3a"], ["1", "2"], ["3b", "4"]));

    expect(findRecordedPasses(timeline, range("1", "3a"))).toEqual([{ first: 0, last: 2 }]);
  });

  it("starts at the occurrence of from", () => {
    const timeline = expandRecording(SCORE, spans(["1", "3"], ["2", "3"], ["2", "4"]));

    expect(findRecordedPasses(timeline, range("2", "3", 2, 2))).toEqual([{ first: 3, last: 4 }, { first: 5, last: 6 }]);
  });

  it("is empty for unresolved or reversed ranges", () => {
    const timeline = expandRecording(SCORE, spans(["1", "6"]));

    expect(findRecordedPasses(timeline, range("3", "2"))).toEqual([]);
    expect(findRecordedPasses(timeline, range("2", "3", 2))).toEqual([]);
  });
});

describe("addMeasureToSpans", () => {
  function insert(score: string[], recording: RecordingSpan[], measure: string, index: number): RecordingSpan[] {
    const ids = [...score];
    ids.splice(index, 0, measure);
    return addMeasureToSpans(recording, ids, measure);
  }

  const ids = ["1", "2", "3", "4"];

  it("gives the first measure its own span", () => {
    expect(addMeasureToSpans([], ["1"], "1")).toEqual(spans(["1", "1"]));
  });

  it("leaves spans unchanged when the measure lies inside one", () => {
    expect(insert(ids, spans(["1", "4"]), "2a", 2)).toEqual(spans(["1", "4"]));
  });

  it("extends the last span ending right before the new measure", () => {
    expect(insert(ids, spans(["1", "4"], ["2", "4"]), "5", 4)).toEqual(spans(["1", "4"], ["2", "5"]));
  });

  it("does not extend a span when another one already plays the measure", () => {
    expect(insert(ids, spans(["1", "2"], ["1", "4"]), "2a", 2)).toEqual(spans(["1", "2"], ["1", "4"]));
  });

  it("extends the first span starting right after a new first measure", () => {
    expect(insert(ids, spans(["1", "4"], ["1", "2"]), "0", 0)).toEqual(spans(["0", "4"], ["1", "2"]));
  });

  it("leaves measures outside every span unplayed", () => {
    expect(insert(ids, spans(["1", "2"]), "3a", 3)).toEqual(spans(["1", "2"]));
  });
});

describe("removeMeasureFromSpans", () => {
  const ids = ["1", "2", "3", "4"];

  it("moves span ends inward", () => {
    expect(removeMeasureFromSpans(spans(["1", "4"], ["2", "3"]), ids, "2")).toEqual(spans(["1", "4"], ["3", "3"]));
    expect(removeMeasureFromSpans(spans(["1", "4"], ["2", "3"]), ids, "3")).toEqual(spans(["1", "4"], ["2", "2"]));
  });

  it("drops spans that become empty", () => {
    expect(removeMeasureFromSpans(spans(["1", "3"], ["4", "4"]), ids, "4")).toEqual(spans(["1", "3"]));
  });
});
