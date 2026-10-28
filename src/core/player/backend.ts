import type { NoteEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type Song from "../models/song";
import type AudioClock from "./audioClock";
import type { TimelinePosition } from "./timeline";
import type { SystemEvents } from "./types";

export type StepResult = {
  p0: Tick;
  p1: Tick;
  deltaTimeConsumed: number;
};

export type BackendCallbacks = {
  onTempoChanged: (bpm: number) => void;
  onTimeSignatureChanged: (sig: TimeSignature) => void;
  onNote: (event: NoteEvent) => void;
  onAmplitudes: (amplitudes: number[]) => void;
};

export type LoadResult = {
  duration: Tick;
  timeline: TimelinePosition[];
};

export abstract class PlayerBackend {
  protected playbackSpeed = 1.0;
  protected playbackTransposition = 0;

  constructor(
    protected readonly context: AudioContext,
    protected readonly clock: AudioClock,
    protected readonly masterInput: AudioNode,
    protected readonly systemEvents: SystemEvents,
    protected readonly callbacks: BackendCallbacks,
  ) {}

  /** Load the song and return its duration and timed timeline. Aborted via `signal`. */
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
   * Fire callbacks for any events (notes, tempo and time signature changes) encountered in the range.
   * A `limit` is where the engine jumps, so notes that would sound past it must not be queued.
   */
  abstract step(currentPosition: Tick, deltaTime: number, limit?: Tick, muteVocals?: boolean): StepResult;

  /** Called when the engine jumps the position by `offset` ticks to `newPosition` (a section pass or cut). */
  abstract onPositionJump(offset: Tick, newPosition: Tick): void;

  /**
   * Called every step with the next jump ahead, if any, so a backend can schedule it before the engine
   * reaches it. MIDI needs nothing: it holds back the notes before a limit.
   */
  prepareJump(_jump: { at: Tick; to: Tick } | undefined): void {}

  /** Called after a seek so the backend can re-anchor its tempo clock to `bpm`. */
  abstract onTempoRestored(bpm: number): void;

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
}
