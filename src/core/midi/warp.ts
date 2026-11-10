export const DEFAULT_SECONDS_PER_BEAT = 0.5;

/** Anchors a beat, counted from the start of the timeline, to a time in the recording, in seconds. */
export type WarpMarker = {
  beat: number;
  time: number;
};

export type WarpSegment = {
  beatStart: number;
  beatEnd: number;
  timeStart: number;
  timeEnd: number;
  secondsPerBeat: number;
};

function createDefaultSegment(anchor: WarpMarker): WarpSegment {
  return {
    beatStart: anchor.beat,
    beatEnd: anchor.beat,
    timeStart: anchor.time,
    timeEnd: anchor.time,
    secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
  };
}

/** Maps beats to recording times, linear between markers and extrapolated beyond them. */
export default class WarpMap {
  private markers: WarpMarker[] = [];
  private segments: WarpSegment[] = [createDefaultSegment({ beat: 0, time: 0 })];

  getMarkers(): readonly WarpMarker[] {
    return this.markers;
  }

  addMarker(marker: WarpMarker): void {
    if (!Number.isInteger(marker.beat)) {
      throw new Error("Marker beat must be an integer");
    }

    const i = this.markers.findIndex(m => m.beat >= marker.beat);
    if (i === -1) {
      this.markers.push(marker);
      this.buildSegments();
      return;
    }

    if (this.markers[i]!.beat === marker.beat) {
      throw new Error("Duplicate beat");
    }

    const prev = this.markers[i - 1];
    const next = this.markers[i]!;
    if (prev && marker.time <= prev.time) {
      throw new Error("Marker time crosses previous marker");
    }

    if (marker.time >= next.time) {
      throw new Error("Marker time crosses next marker");
    }

    this.markers.splice(i, 0, marker);
    this.buildSegments();
  }

  setMarkers(markers: WarpMarker[]): void {
    const sorted = [...markers].sort((a, b) => a.beat - b.beat);
    for (let i = 0; i < sorted.length; i++) {
      if (!Number.isInteger(sorted[i]!.beat)) {
        throw new Error("Marker beat must be an integer");
      }

      if (i === 0) {
        continue;
      }

      if (sorted[i]!.beat === sorted[i - 1]!.beat) {
        throw new Error("Duplicate beat");
      }

      if (sorted[i]!.time <= sorted[i - 1]!.time) {
        throw new Error("Marker times must be strictly increasing");
      }
    }

    this.markers = sorted;
    this.buildSegments();
  }

  removeMarker(beat: number): void {
    const i = this.markers.findIndex(m => m.beat === beat);
    if (i === -1) {
      throw new Error("Marker not found");
    }

    this.markers.splice(i, 1);
    this.buildSegments();
  }

  beatToTime(beat: number): number {
    const seg = this.findSegmentByBeat(beat);
    return seg.timeStart + (beat - seg.beatStart) * seg.secondsPerBeat;
  }

  /** The length of a beat from `beat` on, up to the next marker. */
  getSecondsPerBeat(beat: number): number {
    return this.findSegmentByBeat(beat).secondsPerBeat;
  }

  timeToBeat(time: number): number {
    const seg = this.findSegmentByTime(time);
    return seg.beatStart + (time - seg.timeStart) / seg.secondsPerBeat;
  }

  private buildSegments(): void {
    const ms = this.markers;
    if (ms.length < 2) {
      this.segments = [createDefaultSegment(ms[0] ?? { beat: 0, time: 0 })];
      return;
    }

    this.segments = ms.slice(0, -1).map((start, i) => {
      const end = ms[i + 1]!;
      return {
        beatStart: start.beat,
        beatEnd: end.beat,
        timeStart: start.time,
        timeEnd: end.time,
        secondsPerBeat: (end.time - start.time) / (end.beat - start.beat),
      };
    });
  }

  private findLastSegment(startsBefore: (segment: WarpSegment) => boolean): WarpSegment {
    const segs = this.segments;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (startsBefore(segs[mid]!)) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return segs[lo]!;
  }

  private findSegmentByBeat(beat: number): WarpSegment {
    return this.findLastSegment(segment => segment.beatStart <= beat);
  }

  private findSegmentByTime(time: number): WarpSegment {
    return this.findLastSegment(segment => segment.timeStart <= time);
  }
}
