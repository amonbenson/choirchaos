import type { Tick } from "./types";

export type WarpMarker = {
  tick: Tick;
  time: number;
};

export type WarpSegment = {
  tickStart: number;
  tickEnd: number;
  timeStart: number;
  timeEnd: number;
  secondsPerTick: number;
};

export default class WarpMap {
  private _markers: WarpMarker[] = [];
  private _segments: WarpSegment[] = [];

  get markers(): readonly WarpMarker[] {
    return this._markers;
  }

  addMarker(marker: WarpMarker): void {
    const i = this._markers.findIndex(m => m.tick >= marker.tick);
    if (i === -1) {
      this._markers.push(marker);
    } else {
      if (this._markers[i].tick === marker.tick) {
        throw new Error("Duplicate tick");
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

  removeMarker(tick: Tick): void {
    const i = this._markers.findIndex(m => m.tick === tick);
    if (i === -1) {
      throw new Error("Marker not found");
    }

    this._markers.splice(i, 1);
    this._buildSegments();
  }

  tickToTime(tick: number): number {
    const seg = this._segmentForTick(tick);
    return seg.timeStart + (tick - seg.tickStart) * seg.secondsPerTick;
  }

  timeToTick(time: number): number {
    const seg = this._segmentForTime(time);
    return seg.tickStart + (time - seg.timeStart) / seg.secondsPerTick;
  }

  private _buildSegments(): void {
    const ms = this._markers;
    if (ms.length < 2) {
      // 0 markers: identity at origin. 1 marker: slope-1 extrapolation from it.
      const anchor = ms[0] ?? { tick: 0, time: 0 };
      this._segments = [{ tickStart: anchor.tick, tickEnd: anchor.tick, timeStart: anchor.time, timeEnd: anchor.time, secondsPerTick: 1 }];
      return;
    }

    const segs: WarpSegment[] = [];

    for (let i = 0; i < ms.length - 1; i++) {
      const sps = (ms[i + 1].time - ms[i].time) / (ms[i + 1].tick - ms[i].tick);
      segs.push({ tickStart: ms[i].tick, tickEnd: ms[i + 1].tick, timeStart: ms[i].time, timeEnd: ms[i + 1].time, secondsPerTick: sps });
    }

    this._segments = segs;
  }

  private _segmentForTick(tick: number): WarpSegment {
    const segs = this._segments;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].tickStart <= tick) {
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
