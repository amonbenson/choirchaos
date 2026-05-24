import type { NoteEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type { MeasureReference } from "../models/measure";
import type Song from "../models/song";
import type { SystemEvents } from "./types";

export type StepResult = {
  p0: Tick;
  p1: Tick;
  deltaTimeConsumed: number;
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
  protected playbackSpeed = 1.0;
  protected playbackTransposition = 0;

  constructor(
    protected readonly context: AudioContext,
    protected readonly masterInput: AudioNode,
    protected readonly systemEvents: SystemEvents,
    protected readonly callbacks: BackendCallbacks,
  ) {}

  /** Load the song and return its duration and final measure. Aborted via `signal`. */
  abstract load(song: Song, signal: AbortSignal): Promise<LoadResult>;

  /** Begin audio output from `currentPosition`. */
  abstract play(currentPosition: Tick): void;

  /** Suspend audio output at `currentPosition`. */
  abstract pause(currentPosition: Tick): void;

  /** Snap the internal playback cursor to `position` without changing play/pause state. */
  abstract seek(position: Tick): void;

  /**
   * Advance playback by `deltaTime` seconds from `currentPosition`.
   * Must not cross `limit` (if given); returns the actual tick range consumed and wall-clock time spent.
   * Fire callbacks for any events (notes, measure/tempo/time-signature changes) encountered in the range.
   */
  abstract step(currentPosition: Tick, deltaTime: number, limit?: Tick): StepResult;

  /** Called when the engine jumps the position by `offset` ticks (e.g. a vamp loop). */
  abstract onPositionJump(offset: Tick, newPosition: Tick): void;

  /** Called after a seek so the backend can re-anchor its tempo clock to `bpm`. */
  abstract onTempoRestored(bpm: number): void;

  /** Ticks per quarter note for the loaded song. */
  abstract getPpqn(): number;

  /** Raw decoded audio buffers, one per track (empty in MIDI mode). */
  abstract getAudioBuffers(): AudioBuffer[];

  /** Stop all output and release all resources. */
  abstract dispose(): void;

  /** Called when the user changes playback speed; override to apply it to the audio pipeline. */
  onPlaybackSpeedChanged(speed: number): void {
    this.playbackSpeed = speed;
  }

  /** Called when the user changes playback transposition; override to apply it to the audio pipeline. */
  onPlaybackTranspositionChanged(semitones: number): void {
    this.playbackTransposition = semitones;
  }

  /** Called after warp markers are edited; override to rebuild the timing map (audio mode only). */
  syncWarp(_song: Song): void {}
}
