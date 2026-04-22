export const DEFAULT_SECONDS_PER_MEASURE = 2;

export type WarpMarker = {
  measure: number; // integer measure index
  time: number;
};

export type WarpSegment = {
  measureStart: number;
  measureEnd: number;
  timeStart: number;
  timeEnd: number;
  secondsPerMeasure: number;
};

export default class WarpMap {
  private _markers: WarpMarker[] = [];
  private _segments: WarpSegment[];

  constructor() {
    this._segments = [{ measureStart: 0, measureEnd: 0, timeStart: 0, timeEnd: 0, secondsPerMeasure: DEFAULT_SECONDS_PER_MEASURE }];
  }

  get markers(): readonly WarpMarker[] {
    return this._markers;
  }

  addMarker(marker: WarpMarker): void {
    if (!Number.isInteger(marker.measure)) {
      throw new Error("Marker measure must be an integer");
    }

    const i = this._markers.findIndex(m => m.measure >= marker.measure);
    if (i === -1) {
      this._markers.push(marker);
    } else {
      if (this._markers[i].measure === marker.measure) {
        throw new Error("Duplicate measure");
      }

      const prev = this._markers[i - 1];
      const next = this._markers[i];
      if (prev && marker.time <= prev.time) {
        throw new Error("Marker time crosses previous marker");
      }

      if (next && marker.time >= next.time) {
        throw new Error("Marker time crosses next marker");
      }

      this._markers.splice(i, 0, marker);
    }

    this._buildSegments();
  }

  setMarkers(markers: WarpMarker[]): void {
    const sorted = [...markers].sort((a, b) => a.measure - b.measure);
    for (let i = 0; i < sorted.length; i++) {
      if (!Number.isInteger(sorted[i].measure)) {
        throw new Error("Marker measure must be an integer");
      }

      if (i > 0) {
        if (sorted[i].measure === sorted[i - 1].measure) {
          throw new Error("Duplicate measure");
        }

        if (sorted[i].time <= sorted[i - 1].time) {
          throw new Error("Marker times must be strictly increasing");
        }
      }
    }

    this._markers = sorted;
    this._buildSegments();
  }

  removeMarker(measure: number): void {
    const i = this._markers.findIndex(m => m.measure === measure);
    if (i === -1) {
      throw new Error("Marker not found");
    }

    this._markers.splice(i, 1);
    this._buildSegments();
  }

  measureToTime(measure: number): number {
    const seg = this._segmentForMeasure(measure);
    return seg.timeStart + (measure - seg.measureStart) * seg.secondsPerMeasure;
  }

  timeToMeasure(time: number): number {
    const seg = this._segmentForTime(time);
    return seg.measureStart + (time - seg.timeStart) / seg.secondsPerMeasure;
  }

  private _buildSegments(): void {
    const ms = this._markers;
    if (ms.length < 2) {
      const anchor = ms[0] ?? { measure: 0, time: 0 };
      this._segments = [{ measureStart: anchor.measure, measureEnd: anchor.measure, timeStart: anchor.time, timeEnd: anchor.time, secondsPerMeasure: DEFAULT_SECONDS_PER_MEASURE }];
      return;
    }

    const segs: WarpSegment[] = [];
    for (let i = 0; i < ms.length - 1; i++) {
      const spm = (ms[i + 1].time - ms[i].time) / (ms[i + 1].measure - ms[i].measure);
      segs.push({ measureStart: ms[i].measure, measureEnd: ms[i + 1].measure, timeStart: ms[i].time, timeEnd: ms[i + 1].time, secondsPerMeasure: spm });
    }

    this._segments = segs;
  }

  private _segmentForMeasure(measure: number): WarpSegment {
    const segs = this._segments;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].measureStart <= measure) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return segs[lo];
  }

  private _segmentForTime(time: number): WarpSegment {
    const segs = this._segments;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].timeStart <= time) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return segs[lo];
  }
}
