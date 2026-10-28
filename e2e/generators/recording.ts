import { TICKS_PER_UNIT, type Timeline, type TimelineMeasure } from "./score/timeline";

/** How a beat map names the passes of a repeated bar "12": "12-1", "12-2" or "12", "12R", "12RR". */
export type RepeatLabels = "dash" | "R";

/** A range of printed bars that the recording plays several times back to back. */
export type RecordedRepeat = {
  /** Printed numbers of the first and the last bar of the range. */
  from: string;
  to: string;
  /** Number of passes the recording contains. */
  passes: number;
  labels?: RepeatLabels;
};

export type RecordedBar = {
  /** The printed bar this recorded bar plays. */
  measure: TimelineMeasure;
  /** 1-based count of how often the recording has played this printed bar so far. */
  occurrence: number;
  /** The bar's `meas` label in the MTI beat map. */
  beatMapLabel: string;
};

export type Recording = {
  /** The bars and notes in playing order, so MIDI, beat map and audio exports play the repeats. */
  timeline: Timeline;
  bars: RecordedBar[];
};

type Pass = { measures: TimelineMeasure[]; pass: number; repeat: RecordedRepeat | undefined };

function passLabel(number: string, pass: number, labels: RepeatLabels): string {
  if (labels === "dash") {
    return `${number}-${pass}`;
  }

  if (!/^\d+$/.test(number)) {
    throw new Error(`Bar '${number}' cannot carry an R label, which needs a plain number.`);
  }

  return number + "R".repeat(pass - 1);
}

function findRange(score: Timeline, repeat: RecordedRepeat): [number, number] {
  const first = score.measures.findIndex(measure => measure.number === repeat.from);
  const last = score.measures.findIndex(measure => measure.number === repeat.to);
  if (first === -1 || last === -1 || first > last || repeat.passes < 1) {
    throw new Error(`Invalid recorded repeat ${repeat.from}..${repeat.to} x${repeat.passes}.`);
  }

  return [first, last];
}

function planPasses(score: Timeline, repeats: readonly RecordedRepeat[]): Pass[] {
  const ranges = repeats.map(repeat => ({ repeat, range: findRange(score, repeat) })).sort((a, b) => a.range[0] - b.range[0]);
  const passes: Pass[] = [];
  let next = 0;

  for (const { repeat, range: [first, last] } of ranges) {
    if (first < next) {
      throw new Error(`Recorded repeat ${repeat.from}..${repeat.to} overlaps another one.`);
    }

    passes.push({ measures: score.measures.slice(next, first), pass: 1, repeat: undefined });
    for (let pass = 1; pass <= repeat.passes; pass++) {
      passes.push({ measures: score.measures.slice(first, last + 1), pass, repeat });
    }

    next = last + 1;
  }

  passes.push({ measures: score.measures.slice(next), pass: 1, repeat: undefined });
  return passes;
}

/**
 * Plays the printed score with the given repeats. Every recorded bar keeps its printed number, and
 * notes are copied from the printed bar, so a repeated pass sounds exactly like the first one.
 */
export function recordTimeline(score: Timeline, repeats: readonly RecordedRepeat[] = []): Recording {
  const bars: RecordedBar[] = [];
  const measures: TimelineMeasure[] = [];
  const occurrences = new Map<string, number>();
  let tick = 0;
  let tempo: number | undefined;

  for (const { measures: printed, pass, repeat } of planPasses(score, repeats)) {
    for (const measure of printed) {
      const occurrence = (occurrences.get(measure.number) ?? 0) + 1;
      occurrences.set(measure.number, occurrence);
      const beatMapLabel = repeat ? passLabel(measure.number, pass, repeat.labels ?? "dash") : measure.number;

      const recorded: TimelineMeasure = {
        ...measure,
        index: measures.length,
        startTick: tick,
        tempoChange: measure.tempo !== tempo ? measure.tempo : undefined,
      };
      measures.push(recorded);
      bars.push({ measure, occurrence, beatMapLabel });
      tick += measure.lengthUnits * TICKS_PER_UNIT;
      tempo = measure.tempo;
    }
  }

  const events = measures.flatMap(recorded => score.events
    .filter(event => event.measureIndex === bars[recorded.index]!.measure.index)
    .map(event => ({ ...event, measureIndex: recorded.index })));

  const tempoChanges = measures
    .filter(measure => measure.tempoChange !== undefined)
    .map(measure => ({ tick: measure.startTick, bpm: measure.tempoChange! }));

  return {
    timeline: { spec: score.spec, measures, events, tempoChanges, durationTicks: tick },
    bars,
  };
}
