import type { NoteEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type { MeasureReference } from "../models/measure";
import type Song from "../models/song";
import type { SystemEvents } from "./types";

export type StepResult = {
  p0: Tick;
  p1: Tick;
  barlineCrossed: boolean;
  // Wall-clock seconds consumed by this step. Less than `delta` when a `limit`
  // was provided and the step was cut short.
  deltaConsumed: number;
};

export type BackendCallbacks = {
  onMeasureChanged: (measure: MeasureReference) => void;
  onTempoChanged: (bpm: number) => void;
  onTimeSignatureChanged: (sig: TimeSignature) => void;
  onNote: (event: NoteEvent) => void;
  onAmplitudes: (amplitudes: number[]) => void;
};

export type LoadResult = {
  duration: Tick;
  finalMeasure: MeasureReference;
};

export abstract class PlayerBackend {
  protected _playbackSpeed = 1.0;
  protected _playbackTransposition = 0;

  constructor(
    protected readonly _context: AudioContext,
    protected readonly _masterInput: AudioNode,
    protected readonly _systemEvents: SystemEvents,
    protected readonly _callbacks: BackendCallbacks,
  ) {}

  abstract load(song: Song, signal: AbortSignal): Promise<LoadResult>;

  abstract play(currentPosition: Tick): void;

  abstract pause(currentPosition: Tick): void;

  // Seek the audio backend to `position`. The engine has already updated its
  // own _position; the backend must sync its internal clocks here.
  abstract seek(position: Tick): void;

  // Called by the engine on every tick. Returns the new position range and
  // whether a barline was crossed (used by the engine for "out-any-bar" vamp
  // exit detection). Must NOT modify the engine's position — just compute and return.
  // When `limit` is provided the backend must not schedule events past that tick
  // and must return early; `deltaConsumed` will reflect only the time up to `limit`.
  abstract step(currentPosition: Tick, delta: number, limit?: Tick): StepResult;

  // Called after a vamp jump. `offset` is the signed tick delta applied to
  // the engine position; `newPosition` is the absolute position after the jump.
  // Backends use whichever is appropriate for their internal clocks.
  abstract onPositionJump(offset: Tick, newPosition: Tick): void;

  // Called during seek to restore the correct tempo at the seek position so
  // the backend can keep its internal tick-duration in sync.
  abstract onTempoRestored(bpm: number): void;

  onPlaybackSpeedChanged(speed: number): void {
    this._playbackSpeed = speed;
  }

  onPlaybackTranspositionChanged(semitones: number): void {
    this._playbackTransposition = semitones;
  }

  // No-op default; AudioBackend overrides this.
  syncWarp(_song: Song): void {}

  abstract get ppqn(): number;

  abstract get audioBuffers(): AudioBuffer[];

  abstract dispose(): void;
}
