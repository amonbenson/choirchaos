export const DEFAULT_SECONDS_PER_POSITION = 2;

/** Anchors a timeline position to a time in the recording, in seconds. */
export type WarpMarker = {
  position: number;
  time: number;
};

export type WarpSegment = {
  positionStart: number;
  positionEnd: number;
  timeStart: number;
  timeEnd: number;
  secondsPerPosition: number;
};

function createDefaultSegment(anchor: WarpMarker): WarpSegment {
  return {
    positionStart: anchor.position,
    positionEnd: anchor.position,
    timeStart: anchor.time,
    timeEnd: anchor.time,
    secondsPerPosition: DEFAULT_SECONDS_PER_POSITION,
  };
}

/** Maps timeline positions to recording times, linear between markers and extrapolated beyond them. */
export default class WarpMap {
  private markers: WarpMarker[] = [];
  private segments: WarpSegment[] = [createDefaultSegment({ position: 0, time: 0 })];

  getMarkers(): readonly WarpMarker[] {
    return this.markers;
  }

  addMarker(marker: WarpMarker): void {
    if (!Number.isInteger(marker.position)) {
      throw new Error("Marker position must be an integer");
    }

    const i = this.markers.findIndex(m => m.position >= marker.position);
    if (i === -1) {
      this.markers.push(marker);
      this.buildSegments();
      return;
    }

    if (this.markers[i]!.position === marker.position) {
      throw new Error("Duplicate position");
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
    const sorted = [...markers].sort((a, b) => a.position - b.position);
    for (let i = 0; i < sorted.length; i++) {
      if (!Number.isInteger(sorted[i]!.position)) {
        throw new Error("Marker position must be an integer");
      }

      if (i === 0) {
        continue;
      }

      if (sorted[i]!.position === sorted[i - 1]!.position) {
        throw new Error("Duplicate position");
      }

      if (sorted[i]!.time <= sorted[i - 1]!.time) {
        throw new Error("Marker times must be strictly increasing");
      }
    }

    this.markers = sorted;
    this.buildSegments();
  }

  removeMarker(position: number): void {
    const i = this.markers.findIndex(m => m.position === position);
    if (i === -1) {
      throw new Error("Marker not found");
    }

    this.markers.splice(i, 1);
    this.buildSegments();
  }

  positionToTime(position: number): number {
    const seg = this.findSegmentByPosition(position);
    return seg.timeStart + (position - seg.positionStart) * seg.secondsPerPosition;
  }

  timeToPosition(time: number): number {
    const seg = this.findSegmentByTime(time);
    return seg.positionStart + (time - seg.timeStart) / seg.secondsPerPosition;
  }

  private buildSegments(): void {
    const ms = this.markers;
    if (ms.length < 2) {
      this.segments = [createDefaultSegment(ms[0] ?? { position: 0, time: 0 })];
      return;
    }

    this.segments = ms.slice(0, -1).map((start, i) => {
      const end = ms[i + 1]!;
      return {
        positionStart: start.position,
        positionEnd: end.position,
        timeStart: start.time,
        timeEnd: end.time,
        secondsPerPosition: (end.time - start.time) / (end.position - start.position),
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

  private findSegmentByPosition(position: number): WarpSegment {
    return this.findLastSegment(segment => segment.positionStart <= position);
  }

  private findSegmentByTime(time: number): WarpSegment {
    return this.findLastSegment(segment => segment.timeStart <= time);
  }
}
