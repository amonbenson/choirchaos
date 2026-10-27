import { describe, expect, it } from "vitest";

import Measure from "./measure";
import {
  addMeasureToSpans,
  compareLocations,
  countOccurrences,
  deserializeLocation,
  expandRecording,
  findBackToBackPasses,
  findPosition,
  findRecordedPasses,
  findStretchAt,
  findUnplayedMeasures,
  formatRecording,
  getRecordingStretches,
  type Location,
  mapPositions,
  moveSpan,
  type Occurrence,
  type OccurrenceRange,
  parseRecording,
  type RecordingSpan,
  remapLocation,
  remapReferences,
  removeMeasureFromSpans,
  removeSpan,
  serializeLocation,
  setJump,
  setRecordedCount,
  spansFromSequence,
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

const at = (measure: string, occurrence = 1): Occurrence => ({ measure, occurrence });
const range = (from: string, to: string, occurrence = 1): OccurrenceRange => ({ from: at(from, occurrence), to: at(to, occurrence) });

// "0" to "28" with "12a" and "12b", like the recording mockup of the redesign.
const LONG = makeScore(...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "12a", "12b"], ...Array.from({ length: 16 }, (_, i) => String(i + 13)));

describe("findBackToBackPasses", () => {
  const timeline = expandRecording(SCORE, spans(["1", "3"], ["2", "3"], ["2", "4"]));

  it("finds the passes before and after the given one", () => {
    const all = [{ first: 1, last: 2 }, { first: 3, last: 4 }, { first: 5, last: 6 }];

    expect(findBackToBackPasses(timeline, range("2", "3"))).toEqual(all);
    expect(findBackToBackPasses(timeline, range("2", "3", 2))).toEqual(all);
    expect(findBackToBackPasses(timeline, range("2", "3", 3))).toEqual(all);
  });

  it("is empty for a range that does not resolve", () => {
    expect(findBackToBackPasses(timeline, range("2", "3", 4))).toEqual([]);
  });
});

describe("spansFromSequence", () => {
  const ids = ["1", "2", "3", "4", "5", "6"];

  it("compresses runs that move forward by one", () => {
    expect(spansFromSequence(ids, ["1", "2", "3", "5", "6"])).toEqual(spans(["1", "3"], ["5", "6"]));
  });

  it("ends a span that jumped back where the span before it ended", () => {
    expect(spansFromSequence(ids, ["1", "2", "3", "2", "3", "4", "5"])).toEqual(spans(["1", "3"], ["2", "3"], ["4", "5"]));
    expect(spansFromSequence(ids, ["1", "2", "2", "2", "3"])).toEqual(spans(["1", "2"], ["2", "2"], ["2", "2"], ["3", "3"]));
  });

  it("keeps endings and D.S. jumps as they are", () => {
    expect(spansFromSequence(ids, ["1", "2", "3", "1", "2", "4", "5"])).toEqual(spans(["1", "3"], ["1", "2"], ["4", "5"]));
    expect(spansFromSequence(ids, ["1", "2", "3", "4", "2", "3", "6"])).toEqual(spans(["1", "4"], ["2", "3"], ["6", "6"]));
  });

  it("rejects measures outside the score", () => {
    expect(() => spansFromSequence(ids, ["1", "9"])).toThrow(RangeError);
  });
});

describe("setRecordedCount", () => {
  it("adds back-to-back passes", () => {
    expect(setRecordedCount(SCORE, spans(["1", "6"]), range("2", "3"), 3)).toEqual(spans(["1", "3"], ["2", "3"], ["2", "3"], ["4", "6"]));
  });

  it("removes passes from the end, from any pass", () => {
    const recording = spans(["1", "3"], ["2", "3"], ["2", "3"], ["4", "6"]);

    expect(setRecordedCount(SCORE, recording, range("2", "3", 3), 2)).toEqual(spans(["1", "3"], ["2", "3"], ["4", "6"]));
    expect(setRecordedCount(SCORE, recording, range("2", "3", 2), 1)).toEqual(spans(["1", "6"]));
  });

  it("records the vamp of the mockup four times", () => {
    const recording = setRecordedCount(LONG, spans(["0", "28"]), range("19", "20"), 4);

    expect(formatRecording(recording, LONG)).toBe("0-20, 19-20 x3, 21-28");
    expect(expandRecording(LONG, recording)).toHaveLength(37);
  });

  it("rejects ranges the recording does not play and invalid counts", () => {
    expect(() => setRecordedCount(SCORE, spans(["1", "6"]), range("3", "2"), 2)).toThrow(RangeError);
    expect(() => setRecordedCount(SCORE, spans(["1", "6"]), range("2", "3"), 0)).toThrow(/1 to 100/);
    expect(() => setRecordedCount(SCORE, spans(["1", "6"]), range("2", "3"), 1.5)).toThrow(RangeError);
  });
});

describe("setJump", () => {
  // "1" to "7", "8a", "8b", "9" to "12"
  const score = makeScore("1", "2", "3", "4", "5", "6", "7", "8a", "8b", "9", "10", "11", "12");

  it("builds first and second endings with two jumps", () => {
    const first = setJump(score, spans(["1", "12"]), at("8a"), "1");
    const second = setJump(score, first, at("7", 2), "8b");

    expect(formatRecording(second, score)).toBe("1-8a, 1-7, 8b-12");
  });

  it("builds a D.S. al coda with two jumps", () => {
    const sign = setJump(score, spans(["1", "12"]), at("10"), "3");
    const coda = setJump(score, sign, at("5", 2), "11");

    expect(formatRecording(coda, score)).toBe("1-10, 3-5, 11-12");
  });

  it("skips ahead to a later part that plays the measure", () => {
    expect(setJump(score, spans(["1", "12"]), at("3"), "9")).toEqual(spans(["1", "3"], ["9", "12"]));
    expect(setJump(score, spans(["1", "5"], ["10", "12"]), at("2"), "11")).toEqual(spans(["1", "2"], ["11", "12"]));
  });

  it("plays to the end of the score when the measure lies beyond what comes next", () => {
    expect(setJump(score, spans(["1", "5"], ["8a", "8b"]), at("2"), "10")).toEqual(spans(["1", "2"], ["10", "12"]));
  });

  it("continues after the end of the recording", () => {
    expect(setJump(score, spans(["1", "4"]), at("4"), "1")).toEqual(spans(["1", "4"], ["1", "4"], ["5", "12"]));
  });

  it("removes a jump when continuing at the next measure", () => {
    const endings = spans(["1", "8a"], ["1", "7"], ["8b", "12"]);

    expect(setJump(score, endings, at("8a"), "8b")).toEqual(spans(["1", "12"]));
    expect(setJump(score, spans(["1", "12"]), at("4"), "5")).toEqual(spans(["1", "12"]));
  });

  it("rejects unknown measures and occurrences", () => {
    expect(() => setJump(score, spans(["1", "12"]), at("4", 2), "1")).toThrow(/not played 2 times/);
    expect(() => setJump(score, spans(["1", "12"]), at("4"), "99")).toThrow(/does not exist/);
  });
});

describe("getRecordingStretches", () => {
  it("names each span's first occurrence and where the recording comes from", () => {
    const stretches = getRecordingStretches(SCORE, spans(["1", "3"], ["2", "3"], ["4", "6"]));

    expect(stretches).toEqual([
      { span: { from: "1", to: "3" }, first: 0, last: 2, occurrence: 1 },
      { span: { from: "2", to: "3" }, first: 3, last: 4, occurrence: 2, after: at("3") },
      { span: { from: "4", to: "6" }, first: 5, last: 7, occurrence: 1, after: at("3", 2) },
    ]);
  });
});

describe("moving and removing spans", () => {
  it("merges spans that continue each other afterwards", () => {
    const recording = spans(["1", "1"], ["3", "4"], ["2", "2"]);

    expect(moveSpan(SCORE.slice(0, 4), recording, 2, -1)).toEqual(spans(["1", "4"]));
    expect(moveSpan(SCORE.slice(0, 4), recording, 0, 1)).toEqual(spans(["3", "4"], ["1", "2"]));
    expect(removeSpan(SCORE, spans(["1", "2"], ["5", "5"], ["3", "4"]), 1)).toEqual(spans(["1", "4"]));
  });

  it("finds the stretch that plays a position", () => {
    const stretches = getRecordingStretches(SCORE, spans(["1", "3"], ["2", "3"]));

    expect([0, 2, 3, 4, 5].map(position => findStretchAt(stretches, position))).toEqual([0, 0, 1, 1, -1]);
  });
});

describe("recording text", () => {
  const labeled = [new Measure("m1", "1", 4), new Measure("m2", "2", 4), new Measure("m3", "8-1", 4), new Measure("m4", "Coda", 4)];

  function parse(text: string, measures: Measure[] = LONG): RecordingSpan[] | string {
    const result = parseRecording(text, measures);
    return result.status === "ok" ? result.spans : result.reason;
  }

  it("formats spans by label and counts back-to-back copies", () => {
    expect(formatRecording(spans(["0", "20"], ["19", "20"], ["19", "20"], ["19", "20"], ["21", "28"]), LONG)).toBe("0-20, 19-20 x3, 21-28");
    expect(formatRecording(spans(["1", "1"], ["2", "3"]), SCORE)).toBe("1, 2-3");
    expect(formatRecording([], SCORE)).toBe("");
  });

  it("parses what it formats", () => {
    const recording = spans(["0", "20"], ["19", "20"], ["19", "20"], ["21", "21"], ["12a", "28"]);

    expect(parse(formatRecording(recording, LONG))).toEqual(recording);
  });

  it("accepts other range and count spellings", () => {
    expect(parse("0..20 , 19 – 20 X2,21 - 28,")).toEqual(spans(["0", "20"], ["19", "20"], ["19", "20"], ["21", "28"]));
    expect(parse("19-20x2")).toEqual(spans(["19", "20"], ["19", "20"]));
    expect(parse("12A-13")).toEqual(spans(["12a", "13"]));
  });

  it("reads labels that contain a dash", () => {
    expect(parse("1-8-1, coda", labeled)).toEqual(spans(["m1", "m3"], ["m4", "m4"]));
    expect(parse("8-1", labeled)).toEqual(spans(["m3", "m3"]));
  });

  it("explains what is wrong", () => {
    expect(parse("")).toMatch(/at least one measure/);
    expect(parse("0-20, 29-30")).toBe("There is no measure \"29\".");
    expect(parse("0-99")).toBe("There is no measure \"99\".");
    expect(parse("0-")).toBe("\"0-\" is missing a measure.");
    expect(parse("20-19")).toBe("\"20-19\" runs backwards: 19 comes before 20 in the score.");
    expect(parse("19-20 x0")).toBe("\"19-20 x0\": a passage is recorded 1 to 100 times.");
    expect(parse("19-20 x101")).toMatch(/1 to 100 times/);
    expect(parse("1-2-3", makeScore("1", "2", "3", "1-2", "2-3"))).toMatch(/more than one way/);
  });
});

describe("remapReferences", () => {
  function remap(before: RecordingSpan[], after: RecordingSpan[], occurrence: Occurrence, replacements?: Map<string, string>): Occurrence | undefined {
    return remapReferences(expandRecording(SCORE, before), expandRecording(SCORE, after), replacements)(occurrence);
  }

  it("moves positions after an inserted pass", () => {
    const before = spans(["1", "6"]);
    const after = spans(["1", "3"], ["2", "3"], ["4", "6"]);

    expect(mapPositions(expandRecording(SCORE, before), expandRecording(SCORE, after))).toEqual([0, 1, 2, 5, 6, 7]);
    expect(remap(before, after, at("3"))).toEqual(at("3"));
    expect(remap(before, after, at("5"))).toEqual(at("5"));
  });

  it("keeps the first passes when passes are removed", () => {
    const before = spans(["1", "3"], ["2", "3"], ["2", "3"], ["4", "6"]);
    const after = spans(["1", "3"], ["2", "3"], ["4", "6"]);

    expect(remap(before, after, at("2", 2))).toEqual(at("2", 2));
    expect(remap(before, after, at("2", 3))).toBeUndefined();
    expect(remap(before, after, at("4"))).toEqual(at("4"));
  });

  it("keeps the occurrence where it plays in an unchanged stretch", () => {
    const before = spans(["1", "6"]);
    const after = spans(["1", "4"], ["2", "3"], ["6", "6"]);

    expect(remap(before, after, at("5"))).toBeUndefined();
    expect(remap(before, after, at("6"))).toEqual(at("6"));
  });

  it("follows replaced measures to their new occurrence", () => {
    const before = spans(["1", "6"]);
    const after = spans(["1", "2"], ["1", "2"], ["5", "6"]);
    const replacements = new Map([["3", "1"], ["4", "2"]]);

    expect(remap(before, after, at("4"), replacements)).toEqual(at("2", 2));
    expect(remap(before, after, at("5"), replacements)).toEqual(at("5"));
  });

  it("moves locations with their beat and drops unresolved ones", () => {
    const map = remapReferences(expandRecording(SCORE, spans(["1", "6"])), expandRecording(SCORE, spans(["2", "6"])));

    expect(remapLocation(map, { measure: "3", beat: 2, occurrence: 1 })).toEqual({ measure: "3", beat: 2, occurrence: 1 });
    expect(remapLocation(map, { measure: "1", beat: 2, occurrence: 1 })).toBeUndefined();
    expect(remapLocation(map, { measure: "3", beat: 2, occurrence: 2 })).toBeUndefined();
  });
});

describe("findUnplayedMeasures", () => {
  it("lists measures no span covers, in score order", () => {
    const unplayed = findUnplayedMeasures(SCORE, expandRecording(SCORE, spans(["1", "2"], ["5", "5"])));

    expect(unplayed.map(measure => measure.id)).toEqual(["3", "4", "6"]);
  });
});
