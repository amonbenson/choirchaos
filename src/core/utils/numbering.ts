const NUMBERING_REGEX = /^(\d+)?(-(\d+))?([a-zA-Z])?/;

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

  // group 1: number, group 2: /, group 3: iteration, group 4: letter
  const matchA = a.match(NUMBERING_REGEX) as RegExpMatchArray;
  const matchB = b.match(NUMBERING_REGEX) as RegExpMatchArray;

  const numA = parseInt(matchA[1] ?? 0, 10);
  const numB = parseInt(matchB[1] ?? 0, 10);

  // Compare the numeric parts
  if (numA !== numB) {
    return numA - numB;
  }

  // If numeric parts are equal, compare iterations (if any)
  if (matchA[3] && matchB[3]) {
    const iterA = parseInt(matchA[3] ?? 0, 10);
    const iterB = parseInt(matchA[3] ?? 0, 10);
    if (iterA !== iterB) {
      return iterA - iterB;
    }
  }

  // If numeric parts are equal, compare the letter parts
  const letterA = matchA[4] ?? "";
  const letterB = matchB[4] ?? "";

  return letterA.localeCompare(letterB);
};
