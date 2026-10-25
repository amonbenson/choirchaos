export type MeasureLayout = {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Set by automatic detection on boxes it is unsure about, until someone checks them. */
  readonly review?: boolean;
};

export function needsReview(layout: MeasureLayout | undefined): boolean {
  return layout?.review === true;
}

export function withoutReview(layout: MeasureLayout): MeasureLayout {
  if (!needsReview(layout)) {
    return layout;
  }

  return { page: layout.page, x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

/** Compares boxes by position, since stored boxes come back as new objects or reactive proxies. */
export function isSameLayout(a: MeasureLayout, b: MeasureLayout): boolean {
  return a.page === b.page && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Stable identity of a measure. Labels are display only and may change. */
export type MeasureId = string;

export type StoredMeasure = {
  id: MeasureId;
  label: string;
  beats: number;
  layout?: MeasureLayout;
};

const MEASURE_ID_PREFIX = "m";
const MEASURE_ID_PATTERN = /^m(\d+)$/;

export default class Measure {
  constructor(
    public readonly id: MeasureId,
    public label: string,
    public beats: number,
    public layout?: MeasureLayout,
  ) {}

  public serialize(): StoredMeasure {
    const stored: StoredMeasure = { id: this.id, label: this.label, beats: this.beats };
    if (this.layout) {
      stored.layout = this.layout;
    }

    return stored;
  }

  public static deserialize({ id, label, beats, layout }: StoredMeasure): Measure {
    return new Measure(id, label, beats, layout);
  }
}

/** The IDs following the highest existing one, so removed IDs are never handed out again within the song. */
export function nextMeasureIds(measures: readonly Measure[], count: number): MeasureId[] {
  const highest = measures
    .map(measure => parseInt(measure.id.match(MEASURE_ID_PATTERN)?.[1] ?? "0", 10))
    .reduce((max, value) => Math.max(max, value), 0);
  return Array.from({ length: count }, (_, i) => `${MEASURE_ID_PREFIX}${highest + i + 1}`);
}

export type MeasureAddition = {
  label: string;
  beats: number;
  layout?: MeasureLayout;
  /** Index in the score after the edit. */
  index: number;
};

/** Every change of one Measures tab action, saved by `Song.applyMeasureEdit()` in one request. */
export type MeasureEdit = {
  additions: MeasureAddition[];
  removals: MeasureId[];
  relabels: Map<MeasureId, string>;
  layouts: Map<MeasureId, MeasureLayout | undefined>;
  beats: Map<MeasureId, number>;
  /** The new list of boxes without a measure, or undefined to keep the current one. */
  unnumberedBoxes?: MeasureLayout[];
};

export function createEmptyMeasureEdit(): MeasureEdit {
  return { additions: [], removals: [], relabels: new Map(), layouts: new Map(), beats: new Map() };
}

export function isEmptyMeasureEdit(edit: MeasureEdit): boolean {
  return edit.additions.length === 0 && edit.removals.length === 0 && edit.relabels.size === 0
    && edit.layouts.size === 0 && edit.beats.size === 0 && edit.unnumberedBoxes === undefined;
}

/** Labels and layouts are not part of the timeline, so only these changes make the player reload. */
export function changesPlayback(edit: MeasureEdit): boolean {
  return edit.additions.length > 0 || edit.removals.length > 0 || edit.beats.size > 0;
}
