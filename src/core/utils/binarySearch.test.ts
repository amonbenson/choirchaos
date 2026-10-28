import { describe, expect, it } from "vitest";

import { binarySearch, type BinarySearchOptions, BinarySortedList, insertSorted } from "./binarySearch";

type TestItem = { p: number };

describe("binarySearch", () => {
  const items: TestItem[] = [{ p: 10 }, { p: 20 }, { p: 30 }];
  const comparator = (a: TestItem, b: TestItem): number => a.p - b.p;

  it("finds the correct element with default parameters", () => {
    const options = { comparator };

    // test around lower bound
    expect(binarySearch(items, { p: 9 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 10 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 11 }, options)).toEqual(1);

    // test around mid bound
    expect(binarySearch(items, { p: 19 }, options)).toEqual(1);
    expect(binarySearch(items, { p: 20 }, options)).toEqual(1);
    expect(binarySearch(items, { p: 21 }, options)).toEqual(2);

    // test around high bound
    expect(binarySearch(items, { p: 29 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 30 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 31 }, options)).toEqual(2);
  });

  it("finds the correct element in exclusive mode", () => {
    const options = {
      comparator,
      inclusive: false,
    };

    // test around lower bound
    expect(binarySearch(items, { p: 9 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 10 }, options)).toEqual(1);
    expect(binarySearch(items, { p: 11 }, options)).toEqual(1);

    // test around mid bound
    expect(binarySearch(items, { p: 19 }, options)).toEqual(1);
    expect(binarySearch(items, { p: 20 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 21 }, options)).toEqual(2);

    // test around high bound
    expect(binarySearch(items, { p: 29 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 30 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 31 }, options)).toEqual(2);
  });

  it("finds the correct element in non-extending mode", () => {
    const options = {
      comparator,
      extend: false,
    };

    // test around lower bound
    expect(binarySearch(items, { p: 9 }, options)).toEqual(-1);
    expect(binarySearch(items, { p: 10 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 11 }, options)).toEqual(1);

    // test around high bound
    expect(binarySearch(items, { p: 29 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 30 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 31 }, options)).toEqual(-1);
  });

  it("finds the correct element in backwards mode", () => {
    const options: BinarySearchOptions<TestItem, TestItem> = {
      comparator,
      direction: "backward",
    };

    // test around lower bound
    expect(binarySearch(items, { p: 9 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 10 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 11 }, options)).toEqual(0);

    // test around mid bound
    expect(binarySearch(items, { p: 19 }, options)).toEqual(0);
    expect(binarySearch(items, { p: 20 }, options)).toEqual(1);
    expect(binarySearch(items, { p: 21 }, options)).toEqual(1);

    // test around high bound
    expect(binarySearch(items, { p: 29 }, options)).toEqual(1);
    expect(binarySearch(items, { p: 30 }, options)).toEqual(2);
    expect(binarySearch(items, { p: 31 }, options)).toEqual(2);
  });

  it("searches single-element lists", () => {
    const singleItem = [{ p: 10 }];
    const options: BinarySearchOptions<TestItem, TestItem> = { comparator };

    expect(binarySearch(singleItem, { p: 9 }, options)).toEqual(0);
    expect(binarySearch(singleItem, { p: 10 }, options)).toEqual(0);
    expect(binarySearch(singleItem, { p: 11 }, options)).toEqual(0);

    options.extend = false;
    expect(binarySearch(singleItem, { p: 9 }, options)).toEqual(-1);
    expect(binarySearch(singleItem, { p: 10 }, options)).toEqual(0);
    expect(binarySearch(singleItem, { p: 11 }, options)).toEqual(-1);

    options.inclusive = false;
    expect(binarySearch(singleItem, { p: 9 }, options)).toEqual(-1);
    expect(binarySearch(singleItem, { p: 10 }, options)).toEqual(-1);
    expect(binarySearch(singleItem, { p: 11 }, options)).toEqual(-1);
  });

  it("searches empty lists", () => {
    const options = { comparator };
    expect(binarySearch([], { p: 10 }, options)).toEqual(-1);
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
    expect(list.search(-1)).toBe(1);
  });

  it("works with custom comparator for objects", () => {
    const items: TestItem[] = [{ p: 1 }, { p: 3 }, { p: 5 }];
    const comparator = (a: TestItem, b: TestItem): number => a.p - b.p;
    const list = new BinarySortedList(items, { comparator });
    list.insert({ p: 4 });
    expect(list.items()).toEqual([
      { p: 1 }, { p: 3 }, { p: 4 }, { p: 5 },
    ]);
    expect(list.search({ p: 4 })).toEqual({ p: 4 });
    expect(list.search({ p: 6 })).toEqual({ p: 5 });
  });

  it("sorts items after construction", () => {
    const arr = [{ p: 5 }, { p: 1 }, { p: 3 }];
    const comparator = (a: TestItem, b: TestItem): number => a.p - b.p;
    const list = new BinarySortedList(arr, { comparator });
    expect(list.items()).toEqual([
      { p: 1 }, { p: 3 }, { p: 5 },
    ]);
  });
});
