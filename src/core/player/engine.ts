import type { NoteEvent } from "../midi/events";
import { MeasureEvent, MidiEventList, TempoEvent, TimeSignatureEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type { MeasureReference } from "../models/measure";
import type Song from "../models/song";
import { Emitter, type Emitters, Property } from "../utils/events";
import { SetIntervalUpdater, type UpdateCallback, type Updater } from "../utils/updater";
import AudioBackend from "./audio/backend";
import { PlayerBackend } from "./backend";
import MidiBackend from "./midi/backend";
import {
  type PlayerMode,
  type PlayerSegueState,
  type PlayerStatus,
  type PlayerVamp,
  type PlayerVampState,
  type SystemEvents,
  type TrackEvents,
} from "./types";

const STEP_DURATION = 1 / 50;

export type { PlayerMode, PlayerSegueState, PlayerStatus, PlayerVampState };
export type MidiPlayerStatus = PlayerStatus;
export type MidiPlayerVampState = PlayerVampState;
export type MidiPlayerSegueState = PlayerSegueState;
export type MidiSystemEvents = SystemEvents;
export type MidiTrackEvents = TrackEvents;
export type MidiPlayerEvents = { system: SystemEvents; track: TrackEvents[] };

type VampAction = "repeat" | "exit-at-end" | "exit-at-barline";

export default class PlayerEngine {
  private readonly status = new Property<PlayerStatus>("idle");
  private readonly playing = new Property(false);
  private readonly position = new Property<Tick>(0);
  private readonly duration = new Property<Tick>(0);
  private readonly currentMeasure = new Property<MeasureReference>(["1", 0]);
  private readonly currentTempo = new Property(120);
  private readonly currentTimeSignature = new Property<TimeSignature>([4, 2]);
  private readonly finalMeasure = new Property<MeasureReference>(["1", 0]);
  private readonly currentVamp = new Property<PlayerVampState | undefined>(undefined);
  private readonly currentSegue = new Property<PlayerSegueState | undefined>(undefined);
  private readonly playbackSpeedProp = new Property(1.0);
  private readonly playbackTranspositionProp = new Property(0);

  readonly onStatusChange = this.status.onChange;
  readonly onPlayingChange = this.playing.onChange;
  readonly onPositionChange = this.position.onChange;
  readonly onDurationChange = this.duration.onChange;
  readonly onCurrentMeasureChange = this.currentMeasure.onChange;
  readonly onCurrentTempoChange = this.currentTempo.onChange;
  readonly onCurrentTimeSignatureChange = this.currentTimeSignature.onChange;
  readonly onFinalMeasureChange = this.finalMeasure.onChange;
  readonly onCurrentVampChange = this.currentVamp.onChange;
  readonly onCurrentSegueChange = this.currentSegue.onChange;
  readonly onPlaybackSpeedChange = this.playbackSpeedProp.onChange;
  readonly onPlaybackTranspositionChange = this.playbackTranspositionProp.onChange;

  private readonly emitters = {
    note: new Emitter<NoteEvent>(),
    trackAmplitudesChange: new Emitter<number[]>(),
    segue: new Emitter<void>(),
    audioContextZombie: new Emitter<void>(),
  } satisfies Emitters;

  readonly onNote = this.emitters.note.event;
  readonly onTrackAmplitudesChange = this.emitters.trackAmplitudesChange.event;
  readonly onSegue = this.emitters.segue.event;
  readonly onAudioContextZombie = this.emitters.audioContextZombie.event;

  private mode: PlayerMode = "none";
  private currentSong?: Song;
  private vamps: PlayerVamp[] = [];

  private audioContext: AudioContext;
  private masterInput?: AudioNode;
  private chainOutput?: GainNode;
  private subplayer?: PlayerBackend;
  private loadAbortController?: AbortController;
  private updater: Updater;

  private systemEvents: SystemEvents = {
    measure: new MidiEventList<MeasureEvent>(),
    tempo: new MidiEventList<TempoEvent>(),
    timeSignature: new MidiEventList<TimeSignatureEvent>(),
  };

  constructor(audioContext?: AudioContext, updaterFactory?: (callback: UpdateCallback) => Updater) {
    this.audioContext = audioContext ?? new AudioContext({ latencyHint: "playback" });
    this.updater = updaterFactory
      ? updaterFactory(delta => this.handleStep(delta))
      : new SetIntervalUpdater(delta => this.handleStep(delta), {
          interval: STEP_DURATION,
          maximumLag: 5.0,
          timeProvider: () => this.audioContext?.currentTime ?? 0,
        });
    this.setupAudioContextMonitoring();
  }

  getStatus(): PlayerStatus {
    return this.status.get();
  }

  isPlaying(): boolean {
    return this.playing.get();
  }

  getPosition(): Tick {
    return this.position.get();
  }

  getDuration(): Tick {
    return this.duration.get();
  }

  getCurrentMeasure(): MeasureReference {
    return this.currentMeasure.get();
  }

  getCurrentTempo(): number {
    return this.currentTempo.get();
  }

  getCurrentTimeSignature(): TimeSignature {
    return this.currentTimeSignature.get();
  }

  getFinalMeasure(): MeasureReference {
    return this.finalMeasure.get();
  }

  getCurrentVamp(): PlayerVampState | undefined {
    return this.currentVamp.get();
  }

  getCurrentSegue(): PlayerSegueState | undefined {
    return this.currentSegue.get();
  }

  getMode(): PlayerMode {
    return this.mode;
  }

  getPpqn(): number {
    return this.subplayer?.getPpqn() ?? 480;
  }

  getCurrentSong(): Song | undefined {
    return this.currentSong;
  }

  getAudioBuffers(): AudioBuffer[] {
    return this.subplayer?.getAudioBuffers() ?? [];
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeedProp.get();
  }

  getPlaybackTransposition(): number {
    return this.playbackTranspositionProp.get();
  }

  getMidiEvents(): MidiPlayerEvents {
    const track = this.subplayer instanceof MidiBackend ? this.subplayer.getNoteEvents() : [];
    return { system: this.systemEvents, track };
  }

  resumeAudioContext(): void {
    if (this.audioContext.state !== "running") {
      this.audioContext.resume().catch(() => {});
    }
  }

  setPlaybackSpeed(value: number): void {
    this.playbackSpeedProp.set(Math.max(0.1, Math.min(3.0, value)));
    this.subplayer?.onPlaybackSpeedChanged(this.playbackSpeedProp.get());
  }

  setPlaybackTransposition(value: number): void {
    this.playbackTranspositionProp.set(Math.floor(Math.max(-12, Math.min(12, value))));
    this.subplayer?.onPlaybackTranspositionChanged(this.playbackTranspositionProp.get());
  }

  private setupMasterChain(): void {
    const ctx = this.audioContext;
    this.chainOutput?.disconnect();

    const input = ctx.createGain();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.15;

    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 200;
    low.gain.value = 0;

    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 1;
    mid.gain.value = 0;

    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 6000;
    high.gain.value = 0;

    const output = ctx.createGain();

    input.connect(compressor);
    compressor.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(output);
    output.connect(ctx.destination);

    this.masterInput = input;
    this.chainOutput = output;
  }

  private setupAudioContextMonitoring(): void {
    this.audioContext.addEventListener("statechange", () => {
      if (this.playing.get() && this.audioContext.state !== "running") {
        this.audioContext.resume().catch(() => {});
      }
    });

    let [lastCt, lastWall] = [0, 0];
    setInterval(() => {
      const [ct, wall] = [this.audioContext.currentTime, performance.now()];
      const elapsed = (wall - lastWall) / 1000;
      if (this.playing.get() && this.audioContext.state === "running" && elapsed > 0.5 && ct - lastCt < elapsed * 0.5) {
        this.emitters.audioContextZombie.fire(undefined);
      }

      [lastCt, lastWall] = [ct, wall];
    }, 500);
  }

  play(): void {
    if (this.status.get() !== "ready" || this.playing.get()) {
      return;
    }

    this.resumeAudioContext();
    this.playing.set(true);
    this.subplayer?.play(this.position.get());
    this.updater.start();
  }

  pause(): void {
    if (this.status.get() !== "ready" || !this.playing.get()) {
      return;
    }

    this.subplayer?.pause(this.position.get());
    this.updater.stop();
    this.playing.set(false);
  }

  stop(): void {
    this.pause();
    this.seek(0);
    const vamp = this.currentVamp.get();
    if (vamp) {
      this.currentVamp.set({ ...vamp, currentIteration: 0 });
    }
  }

  seek(position: Tick): void {
    if (this.status.get() !== "ready") {
      return;
    }

    const wasPlaying = this.playing.get();
    this.pause();
    this.position.set(Math.max(0, Math.min(this.duration.get(), position)));
    this.syncStateAt(this.position.get());
    const newVamp = this.vampAt(this.position.get());
    if (newVamp?.start !== this.currentVamp.get()?.start) {
      this.currentVamp.set(newVamp);
    }

    if (wasPlaying) {
      this.play();
    }
  }

  exitVamp(): void {
    const vamp = this.currentVamp.get();
    if (vamp) {
      this.currentVamp.set({ ...vamp, manualExit: true });
    }
  }

  resetVamp(): void {
    const vamp = this.currentVamp.get();
    if (vamp) {
      this.currentVamp.set({ ...vamp, manualExit: false, currentIteration: 0 });
    }
  }

  toggleVamp(): void {
    if (this.currentVamp.get()?.manualExit) {
      this.resetVamp();
    } else {
      this.exitVamp();
    }
  }

  setSegueEnabled(enabled: boolean): void {
    const segue = this.currentSegue.get();
    if (segue) {
      this.currentSegue.set({ ...segue, enabled });
    }
  }

  toggleSegue(): void {
    this.setSegueEnabled(!this.currentSegue.get()?.enabled);
  }

  async load(song: Song): Promise<void> {
    this.loadAbortController?.abort();
    const controller = new AbortController();
    this.loadAbortController = controller;
    const { signal } = controller;

    if (this.status.get() !== "idle") {
      this.unload();
    }

    if (song.measures.items().length === 0 || song.playerMode === "none") {
      return;
    }

    this.status.set("loading");
    this.mode = song.playerMode;
    this.currentSong = song;
    this.resumeAudioContext();
    this.setupMasterChain();

    this.systemEvents = {
      measure: new MidiEventList<MeasureEvent>(),
      tempo: new MidiEventList<TempoEvent>(),
      timeSignature: new MidiEventList<TimeSignatureEvent>(),
    };

    const callbacks = {
      onMeasureChanged: (m: MeasureReference) => this.currentMeasure.set(m),
      onTempoChanged: (bpm: number) => this.currentTempo.set(bpm),
      onTimeSignatureChanged: (sig: TimeSignature) => this.currentTimeSignature.set(sig),
      onNote: (e: NoteEvent) => this.emitters.note.fire(e),
      onAmplitudes: (a: number[]) => this.emitters.trackAmplitudesChange.fire(a),
    };

    this.subplayer = this.mode === "midi"
      ? new MidiBackend(this.audioContext, this.masterInput!, this.systemEvents, callbacks)
      : new AudioBackend(this.audioContext, this.masterInput!, this.systemEvents, callbacks);

    this.subplayer.onPlaybackSpeedChanged(this.playbackSpeedProp.get());
    this.subplayer.onPlaybackTranspositionChanged(this.playbackTranspositionProp.get());

    let loadResult: { duration: Tick; finalMeasure: MeasureReference };
    try {
      loadResult = await this.subplayer.load(song, signal);
    } catch (err) {
      if (signal.aborted) {
        return;
      }

      this.unload();
      throw err;
    }

    if (signal.aborted) {
      return;
    }

    this.duration.set(loadResult.duration);
    this.finalMeasure.set(loadResult.finalMeasure);
    this.resolveEventTicks(song);
    this.status.set("ready");
    this.seek(0);
  }

  unload(): void {
    if (this.status.get() === "idle") {
      return;
    }

    this.pause();
    this.subplayer?.dispose();
    this.subplayer = undefined;
    this.mode = "none";
    this.currentSong = undefined;
    this.position.set(0);
    this.duration.set(0);
    this.status.set("idle");
  }

  syncWarp(song: Song): void {
    if (this.status.get() !== "ready" || this.mode !== "audio") {
      return;
    }

    this.subplayer?.syncWarp(song);
  }

  private vampAt(tick: Tick): PlayerVampState | undefined {
    const v = this.vamps.find(v => tick >= v.start && tick < v.end);
    return v ? { ...v, currentIteration: 0, manualExit: false } : undefined;
  }

  private barlineBetween(after: Tick, before: Tick): Tick | undefined {
    return this.systemEvents.measure.items()
      .find(e => e.tick > after && e.tick < before && e.measure[1] === 0)?.tick;
  }

  private vampAction(p0: Tick): { action: VampAction | null; limit?: Tick } {
    const vamp = this.currentVamp.get();
    if (!vamp) {
      return { action: null };
    }

    const shouldExit = vamp.manualExit
      || (vamp.iterations > 0 && vamp.currentIteration >= vamp.iterations);
    if (!shouldExit) {
      return { action: "repeat", limit: vamp.end };
    }

    const barline = this.barlineBetween(p0, vamp.end);
    return barline !== undefined
      ? { action: "exit-at-barline", limit: barline }
      : { action: "exit-at-end", limit: vamp.end };
  }

  private handleStep(delta: number): void {
    if (!this.subplayer) {
      return;
    }

    let pos = this.position.get();

    if (!this.currentVamp.get() && this.vamps.length > 0) {
      const v = this.vampAt(pos);
      if (v) {
        this.currentVamp.set(v);
      }
    }

    const { action, limit } = this.vampAction(pos);
    const { p1, deltaConsumed } = this.subplayer.step(pos, delta, limit);
    pos = p1;

    if (pos >= this.duration.get()) {
      this.position.set(this.duration.get());
      this.pause();
      if (this.currentSegue.get()?.enabled) {
        this.emitters.segue.fire(undefined);
      }

      return;
    }

    if (action && this.currentVamp.get() && limit !== undefined && p1 >= limit) {
      const vamp = this.currentVamp.get()!;
      const remaining = delta - deltaConsumed;
      let jumpOffset = 0;
      let nextLimit: Tick | undefined;

      if (action === "exit-at-barline") {
        jumpOffset = vamp.end - p1;
        this.currentVamp.set(undefined);
      } else if (action === "exit-at-end") {
        this.currentVamp.set(undefined);
      } else {
        jumpOffset = -(vamp.end - vamp.start);
        this.currentVamp.set({ ...vamp, currentIteration: vamp.currentIteration + 1 });
        nextLimit = vamp.end;
      }

      if (jumpOffset !== 0) {
        pos += jumpOffset;
        this.subplayer.onPositionJump(jumpOffset, pos);
      }

      if (remaining > 0) {
        const { p1: p1b } = this.subplayer.step(pos, remaining, nextLimit);
        pos = p1b;
      }
    }

    this.position.set(Math.max(0, Math.min(this.duration.get(), pos)));
  }

  private syncStateAt(pos: Tick): void {
    const opts = { direction: "backward" as const, inclusive: true, extend: true };
    const measureEvent = this.systemEvents.measure.search({ tick: pos } as MeasureEvent, opts);
    const tempoEvent = this.systemEvents.tempo.search({ tick: pos } as TempoEvent, opts);
    const timeSigEvent = this.systemEvents.timeSignature.search({ tick: pos } as TimeSignatureEvent, opts);
    if (measureEvent) {
      this.currentMeasure.set(measureEvent.measure);
    }

    if (tempoEvent) {
      this.currentTempo.set(tempoEvent.bpm);
    }

    if (timeSigEvent) {
      this.currentTimeSignature.set(timeSigEvent.signature);
    }

    // seek must precede onTempoRestored so lastKnownPosition is anchored first
    this.subplayer?.seek(pos);
    if (tempoEvent) {
      this.subplayer?.onTempoRestored(tempoEvent.bpm);
    }
  }

  private resolveEventTicks(song: Song): void {
    this.vamps = [];
    this.currentVamp.set(undefined);
    this.currentSegue.set(undefined);

    for (const e of song.events.markers.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
    }

    for (const e of song.events.vamps.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
      if (e.$startTick !== undefined && e.$endTick !== undefined) {
        this.vamps.push({ start: e.$startTick, end: e.$endTick, iterations: e.iterations });
      } else {
        console.error("Could not resolve location of Vamp:", e);
      }
    }

    this.currentSegue.set(song.events.segue ? { enabled: true } : undefined);
  }
}
