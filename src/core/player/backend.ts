import type { NoteEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type { MeasureReference } from "../models/measure";
import type Song from "../models/song";
import type { SystemEvents } from "./types";

export type StepResult = {
  p0: Tick;
  p1: Tick;
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
  protected playbackSpeed = 1.0;
  protected playbackTransposition = 0;

  constructor(
    protected readonly context: AudioContext,
    protected readonly masterInput: AudioNode,
    protected readonly systemEvents: SystemEvents,
    protected readonly callbacks: BackendCallbacks,
  ) {}

  abstract load(song: Song, signal: AbortSignal): Promise<LoadResult>;
  abstract play(currentPosition: Tick): void;
  abstract pause(currentPosition: Tick): void;
  abstract seek(position: Tick): void;
  abstract step(currentPosition: Tick, delta: number, limit?: Tick): StepResult;
  abstract onPositionJump(offset: Tick, newPosition: Tick): void;
  abstract onTempoRestored(bpm: number): void;
  abstract getPpqn(): number;
  abstract getAudioBuffers(): AudioBuffer[];
  abstract dispose(): void;

  onPlaybackSpeedChanged(speed: number): void {
    this.playbackSpeed = speed;
  }

  onPlaybackTranspositionChanged(semitones: number): void {
    this.playbackTransposition = semitones;
  }

  syncWarp(_song: Song): void {}
}
