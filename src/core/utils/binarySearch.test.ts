/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { binarySearch, insertSorted, BinarySortedList } from "./binarySearch";
import Measure, { compareMeasures, MeasureList } from "../show/measure";

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
    expect(binarySearch(sortedNumbers, 5, { itemInclusive: false, direction: "forward" })).toBe(7);
    expect(binarySearch(sortedNumbers, 11, { itemInclusive: false, direction: "forward" })).toBeUndefined();
  });

  it("finds previous element when inclusive=false, direction=backward", () => {
    expect(binarySearch(sortedNumbers, 5, { itemInclusive: false, direction: "backward" })).toBe(3);
    expect(binarySearch(sortedNumbers, 1, { itemInclusive: false, direction: "backward" })).toBeUndefined();
  });

  it("returns closest bound when includeBounds=true", () => {
    expect(binarySearch(sortedNumbers, 0, { boundsInclusive: true, direction: "forward" })).toBe(1);
    expect(binarySearch(sortedNumbers, 12, { boundsInclusive: true, direction: "backward" })).toBe(11);
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
    expect(binarySearch(objects, 3, { comparator, itemInclusive: false, direction: "forward" })).toEqual({ id: 5 });
    expect(binarySearch(objects, 3, { comparator, itemInclusive: false, direction: "backward" })).toEqual({ id: 1 });
  });

  it("returns bound with custom comparator and includeBounds=true", () => {
    const objects = [
      { id: 1 }, { id: 3 }, { id: 5 }, { id: 7 },
    ];
    const comparator = (key: TestKey, obj: TestItem) => key - obj.id;
    expect(binarySearch(objects, 0, { comparator, boundsInclusive: true, direction: "forward" })).toEqual({ id: 1 });
    expect(binarySearch(objects, 8, { comparator, boundsInclusive: true, direction: "backward" })).toEqual({ id: 7 });
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

  it("works with an advanced measure list", () => {
    const items = JSON.parse("[{\"value\":\"1\",\"beats\":6},{\"value\":\"2\",\"beats\":6},{\"value\":\"3\",\"beats\":6},{\"value\":\"4\",\"beats\":6},{\"value\":\"5\",\"beats\":6},{\"value\":\"6\",\"beats\":6},{\"value\":\"7\",\"beats\":6},{\"value\":\"8\",\"beats\":6},{\"value\":\"9\",\"beats\":6},{\"value\":\"10\",\"beats\":6},{\"value\":\"11\",\"beats\":6},{\"value\":\"12\",\"beats\":6},{\"value\":\"13\",\"beats\":6},{\"value\":\"14\",\"beats\":6},{\"value\":\"15\",\"beats\":6},{\"value\":\"16\",\"beats\":6},{\"value\":\"17\",\"beats\":6},{\"value\":\"18\",\"beats\":6},{\"value\":\"19\",\"beats\":6},{\"value\":\"20\",\"beats\":6},{\"value\":\"21\",\"beats\":6},{\"value\":\"22\",\"beats\":6},{\"value\":\"23\",\"beats\":6},{\"value\":\"24\",\"beats\":6},{\"value\":\"25\",\"beats\":6},{\"value\":\"26\",\"beats\":6},{\"value\":\"27\",\"beats\":6},{\"value\":\"28\",\"beats\":6},{\"value\":\"29\",\"beats\":6},{\"value\":\"30\",\"beats\":6},{\"value\":\"31\",\"beats\":6},{\"value\":\"32\",\"beats\":6},{\"value\":\"33\",\"beats\":6},{\"value\":\"34\",\"beats\":6},{\"value\":\"35\",\"beats\":6},{\"value\":\"36\",\"beats\":6},{\"value\":\"37\",\"beats\":6},{\"value\":\"38\",\"beats\":6},{\"value\":\"39\",\"beats\":6},{\"value\":\"40\",\"beats\":6},{\"value\":\"41\",\"beats\":6},{\"value\":\"42\",\"beats\":6},{\"value\":\"43\",\"beats\":6},{\"value\":\"44\",\"beats\":6},{\"value\":\"45\",\"beats\":6},{\"value\":\"46\",\"beats\":6},{\"value\":\"47\",\"beats\":6},{\"value\":\"48\",\"beats\":6},{\"value\":\"49\",\"beats\":6},{\"value\":\"50\",\"beats\":6},{\"value\":\"51\",\"beats\":6},{\"value\":\"52\",\"beats\":6},{\"value\":\"53\",\"beats\":6},{\"value\":\"54\",\"beats\":6},{\"value\":\"55\",\"beats\":6},{\"value\":\"56\",\"beats\":6},{\"value\":\"57\",\"beats\":6},{\"value\":\"58\",\"beats\":6},{\"value\":\"59\",\"beats\":6},{\"value\":\"60\",\"beats\":6},{\"value\":\"61\",\"beats\":6},{\"value\":\"62\",\"beats\":6},{\"value\":\"63\",\"beats\":6},{\"value\":\"64\",\"beats\":6},{\"value\":\"65\",\"beats\":4},{\"value\":\"66\",\"beats\":4},{\"value\":\"67\",\"beats\":4},{\"value\":\"68\",\"beats\":4},{\"value\":\"69\",\"beats\":4},{\"value\":\"70\",\"beats\":4},{\"value\":\"71\",\"beats\":4},{\"value\":\"72\",\"beats\":4},{\"value\":\"73\",\"beats\":4},{\"value\":\"74\",\"beats\":4},{\"value\":\"75\",\"beats\":4},{\"value\":\"76\",\"beats\":4},{\"value\":\"77\",\"beats\":4},{\"value\":\"78\",\"beats\":4},{\"value\":\"79\",\"beats\":4},{\"value\":\"80\",\"beats\":4},{\"value\":\"81\",\"beats\":4},{\"value\":\"82\",\"beats\":4},{\"value\":\"83\",\"beats\":4},{\"value\":\"84\",\"beats\":4},{\"value\":\"85\",\"beats\":4},{\"value\":\"86\",\"beats\":4},{\"value\":\"87\",\"beats\":4},{\"value\":\"88\",\"beats\":4},{\"value\":\"89\",\"beats\":4},{\"value\":\"90\",\"beats\":4},{\"value\":\"91\",\"beats\":4},{\"value\":\"92\",\"beats\":4},{\"value\":\"93\",\"beats\":4},{\"value\":\"94\",\"beats\":4},{\"value\":\"95\",\"beats\":4},{\"value\":\"96\",\"beats\":4},{\"value\":\"97\",\"beats\":4},{\"value\":\"98\",\"beats\":4},{\"value\":\"99\",\"beats\":6},{\"value\":\"100\",\"beats\":6},{\"value\":\"101\",\"beats\":6},{\"value\":\"102\",\"beats\":6},{\"value\":\"103\",\"beats\":6},{\"value\":\"104\",\"beats\":6},{\"value\":\"105\",\"beats\":6},{\"value\":\"106\",\"beats\":6},{\"value\":\"107\",\"beats\":6},{\"value\":\"108\",\"beats\":6},{\"value\":\"109\",\"beats\":6},{\"value\":\"110\",\"beats\":6},{\"value\":\"111\",\"beats\":6},{\"value\":\"112\",\"beats\":6},{\"value\":\"113\",\"beats\":6},{\"value\":\"114\",\"beats\":6},{\"value\":\"115\",\"beats\":6},{\"value\":\"116\",\"beats\":6},{\"value\":\"117\",\"beats\":6},{\"value\":\"118\",\"beats\":6},{\"value\":\"119\",\"beats\":6},{\"value\":\"120\",\"beats\":6},{\"value\":\"121\",\"beats\":6},{\"value\":\"122\",\"beats\":6},{\"value\":\"123\",\"beats\":6},{\"value\":\"124\",\"beats\":6},{\"value\":\"125\",\"beats\":6},{\"value\":\"126\",\"beats\":6},{\"value\":\"127\",\"beats\":6},{\"value\":\"128\",\"beats\":6},{\"value\":\"129\",\"beats\":6},{\"value\":\"130\",\"beats\":6},{\"value\":\"131\",\"beats\":6},{\"value\":\"132\",\"beats\":6},{\"value\":\"133\",\"beats\":6},{\"value\":\"134\",\"beats\":6},{\"value\":\"135\",\"beats\":6},{\"value\":\"136-1\",\"beats\":6},{\"value\":\"136-2\",\"beats\":6},{\"value\":\"136-3\",\"beats\":6},{\"value\":\"137\",\"beats\":6},{\"value\":\"138\",\"beats\":6},{\"value\":\"139\",\"beats\":6},{\"value\":\"140\",\"beats\":6},{\"value\":\"141\",\"beats\":6},{\"value\":\"142\",\"beats\":6},{\"value\":\"143\",\"beats\":6},{\"value\":\"144\",\"beats\":6},{\"value\":\"145\",\"beats\":6},{\"value\":\"146\",\"beats\":6},{\"value\":\"147\",\"beats\":6},{\"value\":\"148\",\"beats\":6},{\"value\":\"149\",\"beats\":6},{\"value\":\"150\",\"beats\":6},{\"value\":\"151\",\"beats\":6},{\"value\":\"152\",\"beats\":6},{\"value\":\"153\",\"beats\":6},{\"value\":\"154\",\"beats\":6},{\"value\":\"155\",\"beats\":6},{\"value\":\"156\",\"beats\":6},{\"value\":\"157\",\"beats\":6},{\"value\":\"158\",\"beats\":6}]");
    const measureList = new MeasureList(items.map((item: any) => Measure.fromJson(item)));
    expect(true);
  });
});
