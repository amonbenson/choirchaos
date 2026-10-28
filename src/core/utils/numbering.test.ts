import { describe, expect, it } from "vitest";

import { compareNumberings, getNextSongNumber, isNumbering } from "./numbering";

describe("compareNumberings", () => {
  it("returns 0 for equal numbers", () => {
    expect(compareNumberings("1", "1")).toBe(0);
    expect(compareNumberings("2a", "2a")).toBe(0);
  });

  it("compares numeric parts", () => {
    expect(compareNumberings("1", "2")).toBeLessThan(0);
    expect(compareNumberings("12b", "11b")).toBeGreaterThan(0);
    expect(compareNumberings("10", "2")).toBeGreaterThan(0);
  });

  it("compares letter parts when numbers are equal", () => {
    expect(compareNumberings("5a", "5b")).toBeLessThan(0);
    expect(compareNumberings("5", "5a")).toBeLessThan(0);
    expect(compareNumberings("5a", "5")).toBeGreaterThan(0);
  });

  it("throws an error for invalid numbers", () => {
    expect(() => compareNumberings("foo", "bar")).toThrow(TypeError);
    expect(() => compareNumberings("", "")).toThrow(TypeError);
    expect(() => compareNumberings("1#", "1")).toThrow(TypeError);
  });
});

describe("isNumbering", () => {
  it("accepts song numbers only", () => {
    expect(isNumbering("12")).toBe(true);
    expect(isNumbering("12a")).toBe(true);
    expect(isNumbering("12-2")).toBe(false);
    expect(isNumbering("")).toBe(false);
  });
});

describe("getNextSongNumber", () => {
  it("continues after the highest number", () => {
    expect(getNextSongNumber([])).toBe("1");
    expect(getNextSongNumber(["1", "7a", "3"])).toBe("8");
  });
});
