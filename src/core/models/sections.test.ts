import { describe, expect, it } from "vitest";

import { deserializeMarker, serializeMarker } from "./markers";
import Measure from "./measure";
import { expandRecording, type Location } from "./recording";
import {
  createSection,
  deserializeSection,
  getSectionExtent,
  type Section,
  serializeSection,
  validateSection,
  validateSections,
} from "./sections";

const SCORE = ["1", "2", "3", "4", "5"].map(label => new Measure(label, label, 4));

// Measures 2 and 3 are recorded three times.
const TIMELINE = expandRecording(SCORE, [
  { from: "1", to: "3" },
  { from: "2", to: "3" },
  { from: "2", to: "5" },
]);

function at(measure: string, beat = 0, occurrence = 1): Location {
  return { measure, beat, occurrence };
}

function cut(from: Location, to: Location): Section {
  return { kind: "cut", from, to };
}

describe("section defaults", () => {
  it("creates each kind with its defaults", () => {
    expect(createSection("cut", at("1"), at("1", 3))).toEqual({ kind: "cut", from: at("1"), to: at("1", 3) });
    expect(createSection("repeat", at("1"), at("1", 3))).toMatchObject({ kind: "repeat", passes: 2 });
    expect(createSection("vamp", at("1"), at("1", 3))).toMatchObject({ kind: "vamp", passes: 0, out: "onEnd", vocals: "all" });
  });
});

describe("section storage", () => {
  it("round-trips sections and stores first occurrences without the field", () => {
    const section: Section = { kind: "vamp", from: at("2", 0, 2), to: at("3", 3, 2), passes: 0, out: "anyBar", vocals: "split" };

    const stored = serializeSection(section);

    expect(stored).toEqual({ kind: "vamp", from: { measure: "2", beat: 0, occurrence: 2 }, to: { measure: "3", beat: 3, occurrence: 2 }, passes: 0, out: "anyBar", vocals: "split" });
    expect(serializeSection(cut(at("1"), at("1", 3)))).toEqual({ kind: "cut", from: { measure: "1", beat: 0 }, to: { measure: "1", beat: 3 } });
    expect(deserializeSection(stored)).toEqual(section);
  });

  it("round-trips markers", () => {
    const marker = { at: at("2", 1, 3), text: "Solo" };

    expect(serializeMarker({ at: at("2", 1), text: "Solo" })).toEqual({ at: { measure: "2", beat: 1 }, text: "Solo" });
    expect(deserializeMarker(serializeMarker(marker))).toEqual(marker);
  });
});

describe("validateSection", () => {
  it("accepts valid sections", () => {
    expect(validateSection(SCORE, TIMELINE, cut(at("1"), at("1", 3)))).toBeUndefined();
    expect(validateSection(SCORE, TIMELINE, { kind: "repeat", from: at("2"), to: at("3", 3), passes: 1 })).toBeUndefined();
    expect(validateSection(SCORE, TIMELINE, { ...createSection("vamp", at("4"), at("5", 3)) })).toBeUndefined();
  });

  it("rejects locations that do not resolve", () => {
    expect(validateSection(SCORE, TIMELINE, cut(at("9"), at("1", 3)))).toMatch(/does not exist/);
    expect(validateSection(SCORE, TIMELINE, cut(at("1"), at("1", 4)))).toMatch(/no beat 5/);
    expect(validateSection(SCORE, TIMELINE, cut(at("2", 0, 4), at("3", 3, 4)))).toMatch(/not played 4 times/);
  });

  it("rejects ranges that do not move forward", () => {
    expect(validateSection(SCORE, TIMELINE, cut(at("3"), at("2", 3)))).toMatch(/start before it ends/);
    expect(validateSection(SCORE, TIMELINE, cut(at("2", 1), at("2", 1)))).toMatch(/start before it ends/);
    expect(validateSection(SCORE, TIMELINE, cut(at("2", 0, 2), at("3", 3, 1)))).toMatch(/start before it ends/);
  });

  it("checks passes and vamp options", () => {
    const repeat = { kind: "repeat", from: at("1"), to: at("1", 3) } as const;
    const vamp = createSection("vamp", at("1"), at("1", 3));

    expect(validateSection(SCORE, TIMELINE, { ...repeat, passes: 0 })).toMatch(/at least 1/);
    expect(validateSection(SCORE, TIMELINE, { ...repeat, passes: 1.5 })).toMatch(/at least 1/);
    expect(validateSection(SCORE, TIMELINE, { ...vamp, passes: -1 } as Section)).toMatch(/at least 0/);
    expect(validateSection(SCORE, TIMELINE, { ...vamp, out: "never" } as unknown as Section)).toMatch(/exit and vocals/);
    expect(validateSection(SCORE, TIMELINE, { ...vamp, vocals: "none" } as unknown as Section)).toMatch(/exit and vocals/);
  });
});

describe("section extents and overlaps", () => {
  it("covers all recorded passes", () => {
    expect(getSectionExtent(TIMELINE, cut(at("2", 1), at("3", 2)))).toEqual({
      from: { position: 1, beat: 1 },
      to: { position: 6, beat: 2 },
    });
    expect(getSectionExtent(TIMELINE, cut(at("9"), at("1")))).toBeUndefined();
  });

  it("reports sections that overlap counting recorded passes", () => {
    const sections = [
      cut(at("2"), at("3", 3)),
      cut(at("3", 0, 3), at("4", 3)),
      cut(at("5"), at("5", 3)),
    ];

    expect(validateSections(SCORE, TIMELINE, sections)).toEqual([{ index: 1, reason: "Sections must not overlap." }]);
  });

  it("allows sections that touch without sharing a beat", () => {
    const sections = [cut(at("1"), at("1", 1)), cut(at("1", 2), at("1", 3))];

    expect(validateSections(SCORE, TIMELINE, sections)).toEqual([]);
  });

  it("reports invalid sections with their index", () => {
    expect(validateSections(SCORE, TIMELINE, [cut(at("1"), at("1", 3)), cut(at("9"), at("1"))])).toEqual([
      { index: 1, reason: "Measure 9 does not exist." },
    ]);
  });
});
