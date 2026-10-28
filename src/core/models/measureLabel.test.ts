import { describe, expect, it } from "vitest";

import Measure from "./measure";
import { parseLabel, parseLabelList, suggestLabel } from "./measureLabel";

function makeScore(...labels: string[]): Measure[] {
  return labels.map((label, i) => new Measure(`m${i + 1}`, label, 4));
}

describe("parseLabel", () => {
  it("parses a number with an optional letter", () => {
    expect(parseLabel("12")).toEqual({ number: 12, letter: "" });
    expect(parseLabel("12A")).toEqual({ number: 12, letter: "a" });
    expect(parseLabel("1R")).toEqual({ number: 1, letter: "r" });
  });

  it("does not parse other labels", () => {
    expect(parseLabel("Coda")).toBeUndefined();
    expect(parseLabel("12-2")).toBeUndefined();
    expect(parseLabel("")).toBeUndefined();
  });
});

describe("suggestLabel", () => {
  it("starts at the first measure or 1", () => {
    expect(suggestLabel(makeScore("5", "6"), undefined, "audio")).toBe("5");
    expect(suggestLabel([], undefined, "audio")).toBe("1");
    expect(suggestLabel([], undefined, "midi")).toBeUndefined();
  });

  it("continues with the next measure of the score in MIDI songs", () => {
    const score = makeScore("1", "2a", "Coda");

    expect(suggestLabel(score, score[0], "midi")).toBe("2a");
    expect(suggestLabel(score, score[1], "midi")).toBe("Coda");
    expect(suggestLabel(score, score[2], "midi")).toBeUndefined();
  });

  it("continues with the next whole number in audio songs", () => {
    const score = makeScore("3", "7");

    expect(suggestLabel(score, score[0], "audio")).toBe("4");
    expect(suggestLabel(makeScore("7a"), makeScore("7a")[0], "audio")).toBe("8");
  });

  it("prefers a following measure that comes before the next whole number", () => {
    const score = makeScore("4", "4a", "5");

    expect(suggestLabel(score, score[0], "audio")).toBe("4a");
    expect(suggestLabel(score, score[1], "audio")).toBe("5");
  });

  it("suggests nothing after a label that does not parse", () => {
    const score = makeScore("Intro", "1");

    expect(suggestLabel(score, score[0], "audio")).toBeUndefined();
  });
});

describe("parseLabelList", () => {
  it("parses labels and ranges", () => {
    expect(parseLabelList("4")).toEqual(["4"]);
    expect(parseLabelList("1..3, 3a, Coda")).toEqual(["1", "2", "3", "3a", "Coda"]);
    expect(parseLabelList("3 .. 1")).toEqual(["1", "2", "3"]);
  });

  it("rejects empty lists and huge ranges", () => {
    expect(parseLabelList(" , ")).toBeUndefined();
    expect(parseLabelList("1..99999")).toBeUndefined();
  });
});
