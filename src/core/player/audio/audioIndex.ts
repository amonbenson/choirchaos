/** One recording's entry in a song's `audioIndex` file, written by the backend's `audio.js`. */
export type AudioIndexEntry = {
  preSkip: number;
  headerBytes: number;
  /** Size of every audio page. */
  pageBytes: number[];
  /** How far each audio page advances the granule position, which counts the pre-skip. */
  pageSamples: number[];
};

/** A song's index file: one entry per stored recording file name. */
export type AudioIndex = Record<string, AudioIndexEntry>;

export type ByteRange = { start: number; end: number };

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === "number");
}

function isEntry(value: unknown): value is AudioIndexEntry {
  const entry = value as Partial<AudioIndexEntry> | null;
  return !!entry && typeof entry.preSkip === "number" && typeof entry.headerBytes === "number"
    && isNumberList(entry.pageBytes) && isNumberList(entry.pageSamples) && entry.pageBytes.length === entry.pageSamples.length;
}

export function parseAudioIndex(value: unknown): AudioIndex {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid audio index");
  }

  for (const [name, entry] of Object.entries(value)) {
    if (!isEntry(entry)) {
      throw new Error(`Invalid audio index entry for '${name}'`);
    }
  }

  return value as AudioIndex;
}

/** Where every audio page of a recording lies in its file and up to which sample it decodes. */
export class SeekIndex {
  /** Byte offset of every page, plus the end of the file. */
  private readonly offsets: number[];
  /** Granule position at the end of every page. */
  private readonly granules: number[];

  constructor(private readonly entry: AudioIndexEntry) {
    this.offsets = [entry.headerBytes];
    this.granules = [];
    let granule = 0;
    entry.pageBytes.forEach((size, i) => {
      this.offsets.push(this.offsets[i]! + size);
      granule += entry.pageSamples[i]!;
      this.granules.push(granule);
    });
  }

  getPreSkip(): number {
    return this.entry.preSkip;
  }

  getSampleCount(): number {
    return Math.max(0, (this.granules.at(-1) ?? 0) - this.entry.preSkip);
  }

  getByteLength(): number {
    return this.offsets.at(-1)!;
  }

  /**
   * The pages that decode samples [from, to) after a decoder reset `leadIn` samples earlier. A page's
   * packets start no later than where the page before it ends.
   */
  getByteRange(from: number, to: number, leadIn: number): ByteRange {
    const want = from - leadIn + this.entry.preSkip;
    const until = to + this.entry.preSkip;
    let first = 0;
    while (first + 1 < this.granules.length && this.granules[first]! <= want) {
      first++;
    }

    let last = first;
    while (last + 1 < this.granules.length && this.granules[last]! < until) {
      last++;
    }

    return { start: this.offsets[first]!, end: this.offsets[last + 1]! };
  }
}
