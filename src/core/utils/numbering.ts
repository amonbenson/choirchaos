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

  const numA = parseInt(matchA[1] ?? 0, 10);
  const numB = parseInt(matchB[1] ?? 0, 10);

  // Compare the numeric parts
  if (numA !== numB) {
    return numA - numB;
  }

  // If numeric parts are equal, compare iterations
  const iterA = parseInt(matchA[4] ?? 0, 10);
  const iterB = parseInt(matchB[4] ?? 0, 10);

  if (iterA !== iterB) {
    return iterA - iterB;
  }

  // If iterations are equal, compare the letter parts
  const letterA = matchA[2] ?? "";
  const letterB = matchB[2] ?? "";

  return letterA.localeCompare(letterB);
};
