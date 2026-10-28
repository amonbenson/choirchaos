import { describe, expect, it } from "vitest";

import { locationOf, makeMidiSongWithRepeat } from "@/test/fixtures";

import { formatLocation, formatOccurrence, formatOccurrenceShort, formatOrdinal, formatTimes } from "./locationFormat";

describe("formatOrdinal", () => {
  it("uses English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(formatOrdinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    expect(formatTimes(2)).toBe("2nd time");
  });
});

describe("formatOccurrence", () => {
  it("names the occurrence only when the measure has played before", () => {
    expect(formatOccurrence("12", 1)).toBe("12");
    expect(formatOccurrence("12", 2)).toBe("12, 2nd time");
    expect(formatOccurrenceShort("12", 1)).toBe("12");
    expect(formatOccurrenceShort("12", 3)).toBe("12 (3rd)");
  });
});

describe("formatLocation", () => {
  it("names the occurrence only for measures the recording plays more than once", () => {
    const song = makeMidiSongWithRepeat();
    expect(formatLocation(song, locationOf(song, "1"))).toBe("1");
    expect(formatLocation(song, locationOf(song, "2"))).toBe("2, 1st time");
    expect(formatLocation(song, locationOf(song, "2", 0, 2))).toBe("2, 2nd time");
  });
});
