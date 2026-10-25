const NUMBERING_REGEX = /^(\d+)?([a-zA-Z])?$/;

/** A song's number within its show, e.g. "12" or "12a". */
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
  const matchA = asNumbering(a).match(NUMBERING_REGEX) as RegExpMatchArray;
  const matchB = asNumbering(b).match(NUMBERING_REGEX) as RegExpMatchArray;

  const numA = parseInt(matchA[1] ?? "0", 10);
  const numB = parseInt(matchB[1] ?? "0", 10);
  if (numA !== numB) {
    return numA - numB;
  }

  return (matchA[2] ?? "").localeCompare(matchB[2] ?? "");
}

/** The next whole number after the highest existing numbering, e.g. "8" after "7a". */
export function getNextSongNumber(numbers: Numbering[]): Numbering {
  const highest = numbers
    .map(number => parseInt(number.match(NUMBERING_REGEX)?.[1] ?? "0", 10))
    .reduce((max, value) => Math.max(max, value), 0);
  return String(highest + 1);
}
