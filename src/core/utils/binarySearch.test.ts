/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { binarySearch, insertSorted, BinarySortedList } from "./binarySearch";

type TestKey = number;
type TestItem = { id: TestKey };

describe("binarySearch", () => {
  const sortedNumbers = [1, 3, 5, 7, 9, 11];

  it("finds an existing element (default options)", () => {
    expect(binarySearch(sortedNumbers, 5)).toBe(5);
    expect(binarySearch(sortedNumbers, 1)).toBe(1);
    expect(binarySearch(sortedNumbers, 11)).toBe(11);
  });

  it("returns undefined for out-of-range element (default options)", () => {
    expect(binarySearch(sortedNumbers, 100)).toBeUndefined();
    expect(binarySearch([], 1)).toBeUndefined();
  });

  it("finds next element when inclusive=false, direction=forward", () => {
    expect(binarySearch(sortedNumbers, 5, { inclusive: false, direction: "forward" })).toBe(7);
    expect(binarySearch(sortedNumbers, 11, { inclusive: false, direction: "forward" })).toBeUndefined();
  });

  it("finds previous element when inclusive=false, direction=backward", () => {
    expect(binarySearch(sortedNumbers, 5, { inclusive: false, direction: "backward" })).toBe(3);
    expect(binarySearch(sortedNumbers, 1, { inclusive: false, direction: "backward" })).toBeUndefined();
  });

  it("returns closest bound when includeBounds=true", () => {
    expect(binarySearch(sortedNumbers, 0, { includeBounds: true, direction: "forward" })).toBe(1);
    expect(binarySearch(sortedNumbers, 12, { includeBounds: true, direction: "backward" })).toBe(11);
  });

  it("uses custom comparator for objects", () => {
    const objects = [
      { id: 1 }, { id: 3 }, { id: 5 }, { id: 7 },
    ];
    const comparator = (key: TestKey, obj: TestItem) => key - obj.id;
    expect(binarySearch(objects, 5, { comparator })).toEqual({ id: 5 });
    expect(binarySearch(objects, 8, { comparator })).toBeUndefined();
  });

  it("returns undefined for invalid input", () => {
    expect(binarySearch(null as any, 1)).toBeUndefined();
    expect(binarySearch(undefined as any, 1)).toBeUndefined();
    expect(binarySearch([], 1)).toBeUndefined();
  });

  it("finds next/previous element with custom comparator and inclusive=false", () => {
    const objects = [
      { id: 1 }, { id: 3 }, { id: 5 }, { id: 7 },
    ];
    const comparator = (key: TestKey, obj: TestItem) => key - obj.id;
    expect(binarySearch(objects, 3, { comparator, inclusive: false, direction: "forward" })).toEqual({ id: 5 });
    expect(binarySearch(objects, 3, { comparator, inclusive: false, direction: "backward" })).toEqual({ id: 1 });
  });

  it("returns bound with custom comparator and includeBounds=true", () => {
    const objects = [
      { id: 1 }, { id: 3 }, { id: 5 }, { id: 7 },
    ];
    const comparator = (key: TestKey, obj: TestItem) => key - obj.id;
    expect(binarySearch(objects, 0, { comparator, includeBounds: true, direction: "forward" })).toEqual({ id: 1 });
    expect(binarySearch(objects, 8, { comparator, includeBounds: true, direction: "backward" })).toEqual({ id: 7 });
  });
});

describe("insertSorted", () => {
  it("inserts into an empty array", () => {
    expect(insertSorted([], 5)).toEqual([5]);
  });

  it("inserts at the beginning", () => {
    expect(insertSorted([3, 5, 7], 1)).toEqual([1, 3, 5, 7]);
  });

  it("inserts at the end", () => {
    expect(insertSorted([1, 3, 5], 7)).toEqual([1, 3, 5, 7]);
  });

  it("inserts in the middle", () => {
    expect(insertSorted([1, 3, 7], 5)).toEqual([1, 3, 5, 7]);
  });

  it("inserts duplicate values", () => {
    expect(insertSorted([1, 3, 5], 3)).toEqual([1, 3, 3, 5]);
  });

  it("uses a custom comparator for objects", () => {
    const arr = [{ id: 1 }, { id: 3 }, { id: 5 }];
    const item = { id: 4 };
    const comparator = (a: TestItem, b: TestItem) => a.id - b.id;
    expect(insertSorted([...arr], item, { comparator })).toEqual([
      { id: 1 }, { id: 3 }, { id: 4 }, { id: 5 },
    ]);
  });

  it("returns array with item if input is not array", () => {
    expect(insertSorted(null as any, 5)).toEqual([5]);
    expect(insertSorted(undefined as any, 5)).toEqual([5]);
  });
});

describe("BinarySortedList", () => {
  it("initializes with sorted items", () => {
    const list = new BinarySortedList([5, 1, 3]);
    expect(list.items()).toEqual([1, 3, 5]);
  });

  it("inserts items and maintains sort order", () => {
    const list = new BinarySortedList([1, 3, 5]);
    list.insert(4);
    expect(list.items()).toEqual([1, 3, 4, 5]);
    list.insert(0);
    expect(list.items()).toEqual([0, 1, 3, 4, 5]);
    list.insert(6);
    expect(list.items()).toEqual([0, 1, 3, 4, 5, 6]);
  });

  it("searches for items using binarySearch", () => {
    const list = new BinarySortedList([1, 3, 5, 7]);
    expect(list.search(5)).toBe(5);
    expect(list.search(-1)).toBeUndefined();
  });

  it("works with custom comparator for objects", () => {
    const arr = [{ id: 1 }, { id: 3 }, { id: 5 }];
    const comparator = (a: TestItem, b: TestItem) => a.id - b.id;
    const list = new BinarySortedList(arr, { comparator });
    list.insert({ id: 4 });
    expect(list.items()).toEqual([
      { id: 1 }, { id: 3 }, { id: 4 }, { id: 5 },
    ]);
    expect(list.search({ id: 4 })).toEqual({ id: 4 });
    expect(list.search({ id: 0 })).toBeUndefined();
  });

  it("sorts items after construction", () => {
    const arr = [{ id: 5 }, { id: 1 }, { id: 3 }];
    const comparator = (a: TestItem, b: TestItem) => a.id - b.id;
    const list = new BinarySortedList(arr, { comparator });
    expect(list.items()).toEqual([
      { id: 1 }, { id: 3 }, { id: 5 },
    ]);
  });
});
