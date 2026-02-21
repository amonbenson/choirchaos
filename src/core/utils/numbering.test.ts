import { describe, expect, it } from "vitest";

import { compareNumberings } from "./numbering";

describe("compareMeasures", () => {
  it("returns 0 for equal measures", () => {
    expect(compareNumberings("1", "1")).toBe(0);
    expect(compareNumberings("2a", "2a")).toBe(0);
    expect(compareNumberings("10b", "10b")).toBe(0);
  });

  it("compares numeric parts", () => {
    expect(compareNumberings("1", "2")).toBeLessThan(0);
    expect(compareNumberings("3", "2")).toBeGreaterThan(0);
    expect(compareNumberings("10a", "11a")).toBeLessThan(0);
    expect(compareNumberings("12b", "11b")).toBeGreaterThan(0);
  });

  it("compares letter parts when numbers are equal", () => {
    expect(compareNumberings("5a", "5b")).toBeLessThan(0);
    expect(compareNumberings("5b", "5a")).toBeGreaterThan(0);
    expect(compareNumberings("5", "5a")).toBeLessThan(0);
    expect(compareNumberings("5a", "5")).toBeGreaterThan(0);
    expect(compareNumberings("7", "7")).toBe(0);
    expect(compareNumberings("7a", "7a")).toBe(0);
  });

  it("handles empty or missing letter part", () => {
    expect(compareNumberings("8", "8a")).toBeLessThan(0);
    expect(compareNumberings("8a", "8")).toBeGreaterThan(0);
    expect(compareNumberings("9", "9")).toBe(0);
  });

  it("throws an error for invalid measures", () => {
    expect(() => compareNumberings("foo", "bar")).toThrow(TypeError);
    expect(() => compareNumberings("1", "bar")).toThrow(TypeError);
    expect(() => compareNumberings("foo", "1")).toThrow(TypeError);
    expect(() => compareNumberings("", "")).toThrow(TypeError);
    expect(() => compareNumberings("1#", "1")).toThrow(TypeError);
  });

  it("handles multi-digit numbers", () => {
    expect(compareNumberings("10", "2")).toBeGreaterThan(0);
    expect(compareNumberings("2", "10")).toBeLessThan(0);
    expect(compareNumberings("10a", "10b")).toBeLessThan(0);
    expect(compareNumberings("10b", "10a")).toBeGreaterThan(0);
  });

  it("handles iteration suffixes for measures", () => {
    expect(compareNumberings("10a-2", "10a-1")).toBeGreaterThan(0);
    expect(compareNumberings("10a-1", "10a")).toBeGreaterThan(0);
    expect(compareNumberings("11a-1", "11b")).toBeGreaterThan(0);
  });
});
