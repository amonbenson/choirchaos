import { describe, expect, it } from "vitest";

import Measure, { type MeasureLayout } from "./measure";
import { expandRecording, type Location, type RecordingSpan } from "./recording";
import {
  describeJump,
  describeOverlays,
  describeSection,
  findRecordedRepeats,
  findRecordingJumps,
  formatJumpChip,
  formatPlayingSection,
  formatSectionChip,
  formatSectionPass,
  getMarkerOverlays,
  getSectionOverlays,
  splitIntoRuns,
} from "./scoreOverlays";
import { createSection, type Section } from "./sections";

const ROW_HEIGHT = 0.1;
const BOX_WIDTH = 0.2;
const PER_ROW = 4;

/** Measures "1" to "n" with ids "m1" to "mn", four boxes per row, eight per page. */
function makeMeasures(count: number): Measure[] {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / PER_ROW) % 2;
    const layout: MeasureLayout = {
      page: Math.floor(i / (2 * PER_ROW)),
      x: 0.1 + (i % PER_ROW) * BOX_WIDTH,
      y: 0.1 + row * 0.3,
      width: BOX_WIDTH,
      height: ROW_HEIGHT,
    };
    return new Measure(`m${i + 1}`, String(i + 1), 4, layout);
  });
}

function span(from: number, to: number): RecordingSpan {
  return { from: `m${from}`, to: `m${to}` };
}

function at(measure: number, beat = 0, occurrence = 1): Location {
  return { measure: `m${measure}`, beat, occurrence };
}

const measures = makeMeasures(16);
const straight = expandRecording(measures, [span(1, 16)]);

describe("splitIntoRuns", () => {
  it("starts a new run at each row and page", () => {
    const runs = splitIntoRuns(measures, ["m3", "m4", "m5", "m6", "m7", "m8", "m9"]);
    expect(runs.map(run => run.measures)).toEqual([["m3", "m4"], ["m5", "m6", "m7", "m8"], ["m9"]]);
    expect(runs[0]).toMatchObject({ page: 0, x: 0.5, y: 0.1 });
    expect(runs[0]!.width).toBeCloseTo(0.4);
    expect(runs[1]).toMatchObject({ page: 0, x: 0.1, y: 0.4 });
    expect(runs[2]).toMatchObject({ page: 1, x: 0.1, y: 0.1 });
  });

  it("keeps slightly uneven boxes in one row and starts a new run where the order goes back left", () => {
    const uneven = makeMeasures(4).map((measure, i) => new Measure(measure.id, measure.label, 4, { ...measure.layout!, y: 0.1 + i * 0.01 }));
    expect(splitIntoRuns(uneven, ["m1", "m2", "m3", "m4"]).map(run => run.y)).toEqual([0.1]);
    expect(splitIntoRuns(uneven, ["m3", "m4", "m1", "m2"]).map(run => run.measures)).toEqual([["m3", "m4"], ["m1", "m2"]]);
  });

  it("skips measures without a box", () => {
    const partly = [measures[0]!, new Measure("m2", "2", 4), measures[2]!];
    expect(splitIntoRuns(partly, ["m1", "m2", "m3"]).map(run => run.measures)).toEqual([["m1", "m3"]]);
  });
});

describe("getSectionOverlays", () => {
  it("covers the measures of the first pass, row by row", () => {
    const sections: Section[] = [createSection("vamp", at(3), at(6, 3)), createSection("cut", at(10), at(11, 3))];
    const [vamp, cut] = getSectionOverlays(measures, straight, sections);
    expect(vamp).toMatchObject({ index: 0, measures: ["m3", "m4", "m5", "m6"], lane: 0 });
    expect(vamp!.runs.map(run => run.measures)).toEqual([["m3", "m4"], ["m5", "m6"]]);
    expect(cut).toMatchObject({ index: 1, measures: ["m10", "m11"], lane: 0 });
  });

  it("draws only the first of several recorded passes", () => {
    const timeline = expandRecording(measures, [span(1, 3), span(2, 3), span(2, 3), span(4, 16)]);
    const [vamp] = getSectionOverlays(measures, timeline, [createSection("vamp", at(2), at(3, 3))]);
    expect(vamp!.measures).toEqual(["m2", "m3"]);
  });

  it("stacks sections on different occurrences of the same boxes", () => {
    const timeline = expandRecording(measures, [span(1, 4), span(1, 16)]);
    const sections = [createSection("repeat", at(1), at(2, 3)), createSection("cut", at(1, 0, 2), at(2, 3, 2))];
    expect(getSectionOverlays(measures, timeline, sections).map(overlay => overlay.lane)).toEqual([0, 1]);
  });

  it("leaves out sections that do not resolve", () => {
    expect(getSectionOverlays(measures, straight, [createSection("cut", at(2, 0, 2), at(3, 3, 2))])).toEqual([]);
  });
});

describe("findRecordedRepeats", () => {
  it("finds a written repeat in compressed spans", () => {
    const timeline = expandRecording(measures, [span(1, 8), span(5, 16)]);
    expect(findRecordedRepeats(timeline)).toEqual([{ first: 4, last: 7, times: 2, measures: ["m5", "m6", "m7", "m8"] }]);
  });

  it("counts every back-to-back pass of a recorded vamp", () => {
    const timeline = expandRecording(measures, [span(1, 11), span(10, 11), span(10, 11), span(10, 11), span(12, 16)]);
    expect(findRecordedRepeats(timeline)).toEqual([{ first: 9, last: 10, times: 4, measures: ["m10", "m11"] }]);
  });

  it("finds several repeats and repeats of a single measure", () => {
    const timeline = expandRecording(measures, [span(1, 2), span(2, 6), span(5, 16)]);
    expect(findRecordedRepeats(timeline).map(({ measures, times }) => ({ measures, times }))).toEqual([
      { measures: ["m2"], times: 2 },
      { measures: ["m5", "m6"], times: 2 },
    ]);
  });

  it("does not count endings or a D.S. as repetitions", () => {
    const withEndings = expandRecording(measures, [span(1, 8), span(1, 7), span(9, 16)]);
    const dalSegno = expandRecording(measures, [span(1, 12), span(5, 8), span(13, 16)]);
    expect(findRecordedRepeats(withEndings)).toEqual([]);
    expect(findRecordedRepeats(dalSegno)).toEqual([]);
    expect(findRecordedRepeats(straight)).toEqual([]);
  });
});

describe("findRecordingJumps", () => {
  it("finds the jumps of endings and a D.S.", () => {
    const withEndings = expandRecording(measures, [span(1, 8), span(1, 7), span(9, 16)]);
    const dalSegno = expandRecording(measures, [span(1, 12), span(5, 8), span(13, 16)]);

    expect(findRecordingJumps(measures, withEndings)).toEqual([
      { position: 7, after: { measure: "m8", occurrence: 1 }, to: { measure: "m1", occurrence: 2 } },
      { position: 14, after: { measure: "m7", occurrence: 2 }, to: { measure: "m9", occurrence: 1 } },
    ]);
    expect(findRecordingJumps(measures, dalSegno).map(jump => jump.position)).toEqual([11, 15]);
  });

  it("leaves out the returns of passages played back to back and straight playing", () => {
    const repeated = expandRecording(measures, [span(1, 11), span(10, 11), span(10, 11), span(12, 16)]);
    const repeatThenEnding = expandRecording(measures, [span(1, 4), span(1, 4), span(1, 3), span(5, 16)]);

    expect(findRecordingJumps(measures, repeated)).toEqual([]);
    expect(findRecordingJumps(measures, straight)).toEqual([]);
    expect(findRecordingJumps(measures, repeatThenEnding).map(jump => jump.position)).toEqual([7, 10]);
  });

  it("names the jump on the chip and in full", () => {
    const withEndings = expandRecording(measures, [span(1, 8), span(1, 7), span(9, 16)]);
    const [back, ending] = findRecordingJumps(measures, withEndings);

    expect(formatJumpChip(measures, back!)).toBe("to 1, 2nd time");
    expect(formatJumpChip(measures, ending!)).toBe("to 9");
    expect(describeJump(measures, withEndings, back!)).toBe("After 8, the recording continues at 1, 2nd time");
    expect(describeJump(measures, withEndings, ending!)).toBe("After 7, 2nd time, the recording continues at 9");
  });
});

describe("getMarkerOverlays", () => {
  it("groups markers by measure", () => {
    const markers = [{ at: at(1), text: "A" }, { at: at(5), text: "B" }, { at: at(5, 0, 2), text: "B2" }];
    expect(getMarkerOverlays(markers)).toEqual([{ measure: "m1", texts: ["A"] }, { measure: "m5", texts: ["B", "B2"] }]);
  });
});

describe("section texts", () => {
  const repeat = { ...createSection("repeat", at(14), at(15, 3)), passes: 3 } as Section;
  const vamp = createSection("vamp", at(10, 0, 2), at(11, 3, 2));
  const cut = createSection("cut", at(16), at(16, 3));

  it("names the kind and the planned passes", () => {
    expect(formatSectionChip(repeat)).toBe("Repeat 3×");
    expect(formatSectionChip(vamp)).toBe("Vamp, 2nd time");
    expect(formatSectionChip(cut)).toBe("Cut");
    expect(describeSection(measures, repeat)).toBe("Repeat 14 to 15, 3 times");
    expect(describeSection(measures, vamp)).toBe("Vamp 10 to 11, 2nd time");
    expect(describeSection(measures, cut)).toBe("Cut 16");
  });

  it("names the pass while the section plays", () => {
    expect(formatSectionChip(repeat, { section: 0, pass: 2, passes: 3, released: false })).toBe("Repeat 2/3");
    expect(formatSectionChip(vamp, { section: 0, pass: 2, released: false })).toBe("Vamp 2");
    expect(formatSectionChip(vamp, { section: 0, pass: 3, released: true })).toBe("Vamp, exiting");
    expect(describeSection(measures, repeat, { section: 0, pass: 2, passes: 3, released: false })).toBe("Repeat 14 to 15, pass 2 of 3");
    expect(formatPlayingSection("repeat", { section: 0, pass: 2, passes: 4, released: false })).toBe("Repeat pass 2 of 4");
    expect(formatPlayingSection("vamp", { section: 0, pass: 2, released: false })).toBe("Vamp pass 2");
    expect(formatPlayingSection("vamp", { section: 0, pass: 4, released: true })).toBe("Vamp exiting");
  });

  it("names the playing pass in short like the header", () => {
    expect(formatSectionPass("vamp", { section: 0, pass: 3, released: false })).toBe("Vamp 3");
    expect(formatSectionPass("repeat", { section: 0, pass: 2, passes: 3, released: false })).toBe("Repeat 2/3");
  });
});

describe("describeOverlays", () => {
  it("joins what each box shows", () => {
    const timeline = expandRecording(measures, [span(1, 11), span(10, 11), span(10, 11), span(12, 16)]);
    const sectionList = [createSection("vamp", at(10), at(11, 3))];
    const markers = [{ at: at(10, 0, 2), text: "D" }, { at: at(12), text: "E" }];
    const descriptions = describeOverlays({
      measures,
      timeline,
      sections: getSectionOverlays(measures, timeline, sectionList),
      repeats: findRecordedRepeats(timeline),
      markers,
      playing: { section: 0, pass: 2, released: false },
    });

    expect(descriptions.get("m10")).toBe("Vamp 10 to 11, pass 2. Recorded 3 times. Marker D, 2nd time.");
    expect(descriptions.get("m11")).toBe("Vamp 10 to 11, pass 2. Recorded 3 times.");
    expect(descriptions.get("m12")).toBe("Marker E.");
    expect(descriptions.has("m1")).toBe(false);
  });

  it("names the jumps after a box", () => {
    const timeline = expandRecording(measures, [span(1, 8), span(1, 7), span(9, 16)]);
    const descriptions = describeOverlays({ measures, timeline, sections: [], repeats: [], markers: [], jumps: findRecordingJumps(measures, timeline) });

    expect(descriptions.get("m7")).toBe("After 7, 2nd time, the recording continues at 9.");
  });
});
