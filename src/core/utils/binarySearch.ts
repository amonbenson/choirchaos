export type BinarySearchOptions<T, K> = {
  comparator?: (a: K, b: T) => number;
  direction?: "forward" | "backward";
  inclusive?: boolean;
  includeBounds?: boolean;
};

/**
 * Performs a binary search on a sorted array with customizable options.
 * Allows for custom comparison, search direction, inclusivity, and boundary inclusion.
 * Returns the found element or undefined if not found.
 *
 * @param {Array} list The list to search through
 * @param {*} key The key to search for, can be a number or an object with a target property. Must match the type used in the comparator.
 * @param {Object} rest Options for the search
 * @param {Function} rest.comparator Function to compare the given key to an element in the list, defaults to numeric comparison
 * @param {string} rest.direction Direction of a match, either "forward" or "backward", defaults to "forward"
 * @param {boolean} rest.inclusive Whether to include a direct match in the search or to find the next/previous element, defaults to true
 * @param {boolean} rest.includeBounds Whether to include the lowest and highest elements in the search, defaults to false
 * @returns {*} The result of the search, which could be an element from the list or undefined if not found
 */
export function binarySearch<T, K>(list: T[], key: K, options: BinarySearchOptions<T, K> = {}) {
  const {
    comparator = (a, b) => Number(a) - Number(b),
    direction = "forward",
    inclusive = true,
    includeBounds = false,
  } = options;

  if (!Array.isArray(list) || list.length === 0) return undefined;

  let low = 0;
  let high = list.length - 1;
  let result;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cmp = comparator(key, list[mid]);

    // validate the comparator result
    if (typeof cmp !== "number" || isNaN(cmp)) {
      throw new Error(`Comparator returned an invalid result: ${cmp}`);
    }

    if (cmp === 0) {
      if (inclusive) {
        result = list[mid];
      } else {
        // Find next/previous element depending on direction
        if (direction === "forward") {
          result = list[mid + 1];
        } else {
          result = list[mid - 1];
        }
      }
      break;
    } else if (cmp < 0) {
      high = mid - 1;
      if (direction === "backward") result = list[mid];
    } else {
      low = mid + 1;
      if (direction === "forward") result = list[mid];
    }
  }

  // Only return bounds if includeBounds is true
  if (result === undefined && includeBounds) {
    if (direction === "forward" && low < list.length) {
      result = list[low];
    } else if (direction === "backward" && high >= 0) {
      result = list[high];
    }
  }

  // If result is out of bounds and includeBounds is false, return undefined
  if (!includeBounds) {
    if (
      direction === "forward" &&
      result === list[list.length - 1] &&
      comparator(key, list[list.length - 1]) > 0
    ) {
      return undefined;
    }
    if (
      direction === "backward" &&
      result === list[0] &&
      comparator(key, list[0]) < 0
    ) {
      return undefined;
    }
  }

  return result;
}

export type InsertSortedOptions<T> = {
  comparator?: (a: T, b: T) => number;
};

/**
 * Inserts an item into a sorted array, maintaining the sort order.
 * Uses binary search to find the correct insertion index efficiently.
 *
 * @param {Array} listThe sorted array to insert the item into.
 * @param {*} itemThe item to insert.
 * @param {Object} rest Optional settings.
 * @param {Function} rest.comparator A function to compare two items. Should return a negative number if first argument is less, zero if equal, and positive if greater.
 * @returns {Array} The array with the item inserted at the correct position.
 */
export function insertSorted<T>(list: T[], item: T, options: InsertSortedOptions<T> = {}) {
  const {
    comparator = (a, b) => Number(a) - Number(b),
  } = options;

  if (!Array.isArray(list)) return [item];

  let low = 0;
  let high = list.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cmp = comparator(item, list[mid]);

    if (cmp < 0) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // Insert item at the correct position
  list.splice(low, 0, item);
  return list;
}

export type BinarySortedListOptions<T> = BinarySearchOptions<T, T> & InsertSortedOptions<T>;

/**
 * Represents a list that maintains its items in sorted order using a binary search comparator.
 */
export class BinarySortedList<T> {
  private _items: T[];
  private _options: BinarySortedListOptions<T>;

  /**
   * Creates an instance of the class with an optional array of items and options.
   * Ensures items are sorted using the provided comparator or a default comparator.
   *
   * @param {Array} items The initial array of items.
   * @param {Object} rest Configuration options.
   * @param {Function} rest.comparator Optional comparator function for sorting items. Unlike the binarySearch comparator, this one must also be able to compare two items directly.
   */
  constructor(items: T[] = [], options: BinarySortedListOptions<T> = {}) {
    this._options = options;
    this._options.comparator = this._options.comparator ?? ((a, b) => Number(a) - Number(b));
    this._items = Array.isArray(items) ? items : [];

    // Ensure the initial items are sorted
    this.sort();
  }

  /**
   * Inserts an item into the sorted list, maintaining order.
   * @param {*} item The item to insert.
   */
  insert(item: T) {
    this._items = insertSorted(this._items, item, this._options);
  }

  /**
   * Searches for a key in the sorted list using binary search.
   * @param {*} keyItem The key item to search for.
   * @param {Object} options Optional settings for the search. These will override the class options.
   * @returns {*} The result of the binary search.
   */
  search(keyItem: T, options: BinarySearchOptions<T, T> = {}) {
    return binarySearch(this._items, keyItem, { ...this._options, ...options });
  }

  sort() {
    this._items.sort(this._options.comparator);
  }

  items() {
    return this._items;
  }
}
