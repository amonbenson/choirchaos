import type Measure from "./measure";

/**
 * Labels are free text. Only labels of the form number plus optional letter ("12", "12a") are parsed,
 * and only to suggest the label of a new box.
 */
const PARSABLE_LABEL = /^(\d+)([a-zA-Z])?$/;
const LABEL_RANGE = /^(\d+)\s*\.\.\s*(\d+)$/;
const MAX_RANGE_LENGTH = 2000;

export const FIRST_LABEL = "1";

export type ParsedLabel = { number: number; letter: string };

export function parseLabel(label: string): ParsedLabel | undefined {
  const match = label.trim().match(PARSABLE_LABEL);
  return match ? { number: parseInt(match[1]!, 10), letter: match[2]?.toLowerCase() ?? "" } : undefined;
}

function isLabelBefore(a: ParsedLabel, b: ParsedLabel): boolean {
  return a.number < b.number || (a.number === b.number && a.letter < b.letter);
}

/**
 * The label of a new box after `previous`, its predecessor in reading order. MIDI songs only know the
 * measures of their beat map, so they continue with the next measure of the score. Audio songs continue
 * with the next whole number, unless the next measure of the score (such as "4a" after "4") comes first.
 */
export function suggestLabel(score: readonly Measure[], previous: Measure | undefined, mode: "midi" | "audio"): string | undefined {
  if (!previous) {
    return score[0]?.label ?? (mode === "audio" ? FIRST_LABEL : undefined);
  }

  const following = score[score.indexOf(previous) + 1];
  if (mode === "midi") {
    return following?.label;
  }

  const parsedPrevious = parseLabel(previous.label);
  if (!parsedPrevious) {
    return undefined;
  }

  const nextWhole = { number: parsedPrevious.number + 1, letter: "" };
  const parsedFollowing = following ? parseLabel(following.label) : undefined;
  if (parsedFollowing && isLabelBefore(parsedPrevious, parsedFollowing) && isLabelBefore(parsedFollowing, nextWhole)) {
    return following!.label;
  }

  return String(nextWhole.number);
}

/**
 * Parses a comma separated list of labels and number ranges, e.g. "1..32, 33a".
 * Returns undefined if the list is empty or a range is too long.
 */
export function parseLabelList(input: string): string[] | undefined {
  const parts = input.split(",").map(part => part.trim()).filter(Boolean);
  const result: string[] = [];

  for (const part of parts) {
    const range = part.match(LABEL_RANGE);
    if (!range) {
      result.push(part);
      continue;
    }

    const from = parseInt(range[1]!, 10);
    const to = parseInt(range[2]!, 10);
    if (Math.abs(to - from) >= MAX_RANGE_LENGTH) {
      return undefined;
    }

    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
      result.push(String(n));
    }
  }

  return result.length > 0 ? result : undefined;
}
