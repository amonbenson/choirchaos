const NUMBERING_REGEX = /^(\d+)?([a-zA-Z])?(-(\d+))?$/;

export type Numbering = string;

export function isNumbering(value: unknown): value is Numbering {
  return typeof value === "string" && !!value && NUMBERING_REGEX.test(value);
}

export function asNumbering(value: unknown): Numbering {
  if (!isNumbering(value)) {
    throw new TypeError(`Expected a valid numbering string, got: ${value}`);
  }

  return value as Numbering;
}

export function compareNumberings(a: Numbering, b: Numbering): number {
  a = asNumbering(a);
  b = asNumbering(b);

  // group 1: number, group 2: letter, group 3: /, group 4: letter
  const matchA = a.match(NUMBERING_REGEX) as RegExpMatchArray;
  const matchB = b.match(NUMBERING_REGEX) as RegExpMatchArray;

  const numA = parseInt(matchA[1] ?? "0", 10);
  const numB = parseInt(matchB[1] ?? "0", 10);

  // Compare the numeric parts
  if (numA !== numB) {
    return numA - numB;
  }

  // If numeric parts are equal, compare iterations
  const iterA = parseInt(matchA[4] ?? "0", 10);
  const iterB = parseInt(matchB[4] ?? "0", 10);

  if (iterA !== iterB) {
    return iterA - iterB;
  }

  // If iterations are equal, compare the letter parts
  const letterA = matchA[2] ?? "";
  const letterB = matchB[2] ?? "";

  return letterA.localeCompare(letterB);
}

/** The next whole number after the highest existing numbering, e.g. "8" after "7a". */
export function getNextSongNumber(numbers: Numbering[]): Numbering {
  const highest = numbers
    .map(number => parseInt(number.match(NUMBERING_REGEX)?.[1] ?? "0", 10))
    .reduce((max, value) => Math.max(max, value), 0);
  return String(highest + 1);
}

const MEASURE_RANGE = /^(\d+)\s*\.\.\s*(\d+)$/;
const MAX_RANGE_LENGTH = 2000;

/**
 * Parses a comma separated list of measure numbers and ranges, e.g. "1..32, 33a".
 * Returns undefined if any part is invalid.
 */
export function parseMeasureList(input: string): Numbering[] | undefined {
  const parts = input.split(",").map(part => part.trim()).filter(Boolean);
  const result: Numbering[] = [];

  for (const part of parts) {
    const range = part.match(MEASURE_RANGE);
    if (range) {
      const from = parseInt(range[1]!, 10);
      const to = parseInt(range[2]!, 10);
      if (Math.abs(to - from) >= MAX_RANGE_LENGTH) {
        return undefined;
      }

      for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
        result.push(String(n));
      }
    } else if (isNumbering(part)) {
      result.push(part);
    } else {
      return undefined;
    }
  }

  return result.length > 0 ? result : undefined;
}
