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
  type VampOut,
  type VampPhase,
  type VampVocals,
} from "./types";

const STEP_DURATION = 1 / 50;
const DEFAULT_MEASURE: MeasureReference = ["1", 0];
const DEFAULT_TEMPO = 120;
const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 2];

export type { PlayerMode, PlayerSegueState, PlayerStatus, PlayerVampState, VampOut, VampPhase, VampVocals };
export type PlayerEvents = { system: SystemEvents; track: TrackEvents[] };

type VampAction = "repeat" | "exitAtEnd" | "exitEarly";

export default class PlayerEngine {
  private readonly status = new Property<PlayerStatus>("idle");
  private readonly mode = new Property<PlayerMode>("none");

  private readonly playing = new Property(false);
  private readonly duration = new Property<Tick>(0);
  private readonly finalMeasure = new Property<MeasureReference>(DEFAULT_MEASURE);
  private readonly playbackSpeed = new Property(1.0);
  private readonly playbackTransposition = new Property(0);

  private readonly position = new Property<Tick>(0);
  private readonly currentMeasure = new Property<MeasureReference>(DEFAULT_MEASURE);
  private readonly currentTempo = new Property(DEFAULT_TEMPO);
  private readonly currentTimeSignature = new Property<TimeSignature>(DEFAULT_TIME_SIGNATURE);
  private readonly currentVamp = new Property<PlayerVampState | undefined>(undefined);
  private readonly currentSegue = new Property<PlayerSegueState | undefined>(undefined);

  readonly onStatusChange = this.status.onChange;
  readonly onModeChange = this.mode.onChange;

  readonly onPlayingChange = this.playing.onChange;
  readonly onDurationChange = this.duration.onChange;
  readonly onFinalMeasureChange = this.finalMeasure.onChange;
  readonly onPlaybackSpeedChange = this.playbackSpeed.onChange;
  readonly onPlaybackTranspositionChange = this.playbackTransposition.onChange;

  readonly onPositionChange = this.position.onChange;
  readonly onCurrentMeasureChange = this.currentMeasure.onChange;
  readonly onCurrentTempoChange = this.currentTempo.onChange;
  readonly onCurrentTimeSignatureChange = this.currentTimeSignature.onChange;
  readonly onCurrentVampChange = this.currentVamp.onChange;
  readonly onCurrentSegueChange = this.currentSegue.onChange;

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

  private currentSong?: Song;
  private vamps: PlayerVamp[] = [];
  private vampsEnabled = true;

  private updater: Updater;
  private audioContext: AudioContext;
  private masterInput?: AudioNode;
  private chainOutput?: GainNode;
  private backend?: PlayerBackend;
  private loadAbortController?: AbortController;

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

  getMode(): PlayerMode {
    return this.mode.get();
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

  getCurrentSong(): Song | undefined {
    return this.currentSong;
  }

  getAudioBuffers(): AudioBuffer[] {
    return this.backend instanceof AudioBackend ? this.backend.getAudioBuffers() : [];
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeed.get();
  }

  getPlaybackTransposition(): number {
    return this.playbackTransposition.get();
  }

  getMidiEvents(): PlayerEvents {
    const track = this.backend instanceof MidiBackend ? this.backend.getNoteEvents() : [];
    return { system: this.systemEvents, track };
  }

  resumeAudioContext(): void {
    if (this.audioContext.state !== "running") {
      this.audioContext.resume().catch(() => {});
    }
  }

  setPlaybackSpeed(value: number): void {
    this.playbackSpeed.set(Math.max(0.1, Math.min(3.0, value)));
    this.backend?.onPlaybackSpeedChanged(this.playbackSpeed.get());
  }

  setPlaybackTransposition(value: number): void {
    this.playbackTransposition.set(Math.floor(Math.max(-12, Math.min(12, value))));
    this.backend?.onPlaybackTranspositionChanged(this.playbackTransposition.get());
  }

  private setupMasterChain(): void {
    const ctx = this.audioContext;
    this.chainOutput?.disconnect();

    // Setup master chain with a compressor and 3-band EQ
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

    input.connect(compressor).connect(low).connect(mid).connect(high).connect(output).connect(ctx.destination);

    this.masterInput = input;
    this.chainOutput = output;
  }

  private setupAudioContextMonitoring(): void {
    // Try to resume the AudioContext if it gets suspended while playing (e.g. due to browser autoplay policies or system sleep)
    // Important: the returned Promise needs to be handled, otherwise resume might not do anything in some browsers.
    this.audioContext.addEventListener("statechange", () => {
      if (this.playing.get() && this.audioContext.state !== "running") {
        this.audioContext.resume().catch(() => {});
      }
    });

    // On Safari and some mobile browsers, the AudioContext can get into a "zombie" state where it is still reported as running but time doesn't advance and no sound is produced.
    // Detect this by checking if currentTime is advancing, and if not, emit an event so the UI can respond.
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
    this.backend?.play(this.position.get());
    this.updater.start();
  }

  pause(): void {
    if (this.status.get() !== "ready" || !this.playing.get()) {
      return;
    }

    this.backend?.pause(this.position.get());
    this.updater.stop();
    this.playing.set(false);
  }

  stop(): void {
    this.pause();
    this.seek(0);

    // Reset iteration count so a vamp at position 0 restarts from the beginning.
    const vamp = this.currentVamp.get();
    if (vamp) {
      this.currentVamp.set({ ...vamp, currentIteration: 0 });
    }
  }

  seek(position: Tick): void {
    if (this.status.get() !== "ready") {
      return;
    }

    // Pause the player while seeking, then resume if it was playing before
    const wasPlaying = this.playing.get();
    this.pause();

    // Update the position first, so that syncStateAt and vampAt operate based on the new position
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

  setVampsEnabled(enabled: boolean): void {
    this.vampsEnabled = enabled;

    // Exit any ongoing vamp immediately
    if (!enabled) {
      const vamp = this.currentVamp.get();
      if (vamp && !vamp.manualExit) {
        this.currentVamp.set({ ...vamp, manualExit: true });
      }
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
    // Abort any in-progress load operation before starting a new one
    this.loadAbortController?.abort();
    const controller = new AbortController();
    this.loadAbortController = controller;
    const { signal } = controller;

    // Unload any previously loaded song to clean up the state
    if (this.status.get() !== "idle") {
      this.unload();
    }

    // If the song has no measures or no player mode, stop here
    if (song.measures.items().length === 0 || song.playerMode === "none") {
      return;
    }

    // Enter loading state and initialize the master chain
    this.status.set("loading");
    this.mode.set(song.playerMode);
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

    // Setup the backend (either midi or audio mode)
    this.backend = this.mode.get() === "midi"
      ? new MidiBackend(this.audioContext, this.masterInput!, this.systemEvents, callbacks)
      : new AudioBackend(this.audioContext, this.masterInput!, this.systemEvents, callbacks);

    // Set the current playback speed and transposition immediately
    this.backend.onPlaybackSpeedChanged(this.playbackSpeed.get());
    this.backend.onPlaybackTranspositionChanged(this.playbackTransposition.get());

    // Try to load the song. If it fails, cleanup the state by unloading and re-throw the error
    let loadResult: { duration: Tick; finalMeasure: MeasureReference };
    try {
      loadResult = await this.backend.load(song, signal);
    } catch (err) {
      if (signal.aborted) {
        return;
      }

      this.unload();
      throw err;
    }

    // Stop here if loading was aborted by another load operation that was started in the meantime
    if (signal.aborted) {
      return;
    }

    // Initialize the rest of the state based on the loaded song and enter ready state
    this.duration.set(loadResult.duration);
    this.finalMeasure.set(loadResult.finalMeasure);
    this.resolveEventTicks(song);
    this.status.set("ready");

    // Setup segue only once at the start of the song
    this.currentSegue.set(song.events.segue ? { enabled: true } : undefined);

    // This will set the position and perform an initial sync for the current vamp, measure, tempo, etc.
    this.seek(0);
  }

  unload(): void {
    if (this.status.get() === "idle") {
      return;
    }

    // Stop playback, dispose the backend, and reset all state
    this.pause();
    this.backend?.dispose();
    this.backend = undefined;

    this.mode.set("none");
    this.currentSong = undefined;
    this.vamps = [];
    this.duration.set(0);
    this.finalMeasure.set(DEFAULT_MEASURE);

    this.position.set(0);
    this.currentMeasure.set(DEFAULT_MEASURE);
    this.currentTempo.set(DEFAULT_TEMPO);
    this.currentTimeSignature.set(DEFAULT_TIME_SIGNATURE);
    this.currentVamp.set(undefined);
    this.currentSegue.set(undefined);

    this.status.set("idle");
  }

  syncWarp(): void {
    if (!(this.backend instanceof AudioBackend) || !this.currentSong) {
      return;
    }

    this.backend.syncWarp();

    const song = this.currentSong;

    for (const e of song.events.markers.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
    }

    // currentSegue is intentionally left untouched — it is independent of the warp map.
    this.vamps = [];
    this.currentVamp.set(undefined);
    for (const e of song.events.vamps.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
      if (e.$startTick !== undefined && e.$endTick !== undefined) {
        this.vamps.push({ start: e.$startTick, end: e.$endTick, iterations: e.iterations, out: e.out ?? "onEnd", vocals: e.vocals ?? "all" });
      } else {
        console.error("Could not resolve location of Vamp:", e);
      }
    }

    const measures = song.measures.items();
    const audioDuration = this.duration.get();
    const finalMeasure = [...measures].reverse().find(m => (m.$beatTicks[0] ?? Infinity) <= audioDuration) ?? measures[0]!;
    this.finalMeasure.set(finalMeasure.reference(0));

    this.syncDisplayAt(this.position.get());
  }

  private vampPhaseAt(vamp: PlayerVampState, pos: Tick): VampPhase {
    const midpoint = vamp.start + (vamp.end - vamp.start) / 2;
    const isLastIteration = vamp.iterations > 0 && vamp.currentIteration >= vamp.iterations;
    if (vamp.manualExit || (isLastIteration && pos >= midpoint)) {
      return "exiting";
    }

    if (vamp.currentIteration === 0 && pos < midpoint) {
      return "entering";
    }

    return "repeating";
  }

  private vampAt(tick: Tick): PlayerVampState | undefined {
    // If vamps are disabled, treat all measures as regular measures
    if (!this.vampsEnabled) {
      return undefined;
    }

    // As a typical song has comparatively few vamps, a simple linear search is sufficient here.
    const v = this.vamps.find(v => tick >= v.start && tick < v.end);
    return v ? { ...v, currentIteration: 0, manualExit: false } : undefined;
  }

  private barlineBetween(after: Tick, before: Tick): Tick | undefined {
    return this.systemEvents.measure.items()
      .find(e => e.tick > after && e.tick < before && e.measure[1] === 0)?.tick;
  }

  private beatlineBetween(after: Tick, before: Tick): Tick | undefined {
    return this.systemEvents.measure.items()
      .find(e => e.tick > after && e.tick < before)?.tick;
  }

  private vampAction(p0: Tick): { action: VampAction | undefined; limit?: Tick } {
    const vamp = this.currentVamp.get();
    if (!vamp) {
      return { action: undefined };
    }

    const shouldExit = vamp.manualExit || (vamp.iterations > 0 && vamp.currentIteration >= vamp.iterations);
    if (!shouldExit) {
      return { action: "repeat", limit: vamp.end };
    }

    if (vamp.out === "anyBeat") {
      const beatline = this.beatlineBetween(p0, vamp.end);
      if (beatline !== undefined) {
        return { action: "exitEarly", limit: beatline };
      }
    } else if (vamp.out === "anyBar") {
      const barline = this.barlineBetween(p0, vamp.end);
      if (barline !== undefined) {
        return { action: "exitEarly", limit: barline };
      }
    }

    return { action: "exitAtEnd", limit: vamp.end };
  }

  private currentVampPhase(pos: Tick): VampPhase | undefined {
    const vamp = this.currentVamp.get();
    return vamp ? this.vampPhaseAt(vamp, pos) : undefined;
  }

  private vocalsAreMuted(pos: Tick): boolean {
    const phase = this.currentVampPhase(pos);
    if (!phase) {
      return false;
    }

    const vocals: VampVocals = this.currentVamp.get()?.vocals ?? "all";
    switch (vocals) {
      case "all": return false;
      case "first": return phase !== "entering";
      case "last": return phase !== "exiting";
      case "split": return phase === "repeating";
    }
  }

  private applyVampAction(p1: Tick, action: VampAction, remainingTime: number): Tick {
    const vamp = this.currentVamp.get()!;
    let jumpOffset = 0;
    let nextLimit: Tick | undefined;

    if (action === "exitEarly") {
      jumpOffset = vamp.end - p1;
      this.currentVamp.set(undefined);
    } else if (action === "exitAtEnd") {
      this.currentVamp.set(undefined);
    } else {
      jumpOffset = -(vamp.end - vamp.start);
      this.currentVamp.set({ ...vamp, currentIteration: vamp.currentIteration + 1 });
      nextLimit = vamp.end;
    }

    let pos = p1;
    if (jumpOffset !== 0) {
      pos += jumpOffset;
      this.backend!.onPositionJump(jumpOffset, pos);
    }

    if (remainingTime > 0) {
      const { p1: p1b } = this.backend!.step(pos, remainingTime, nextLimit, this.vocalsAreMuted(pos));
      pos = p1b;
    }

    return pos;
  }

  private handleStep(deltaTime: number): void {
    if (!this.backend) {
      return;
    }

    let pos = this.position.get();

    // Enter a vamp if the current position crosses into one for the first time
    if (!this.currentVamp.get()) {
      const v = this.vampAt(pos);
      if (v) {
        this.currentVamp.set(v);
      }
    }

    // Advance position via the backend, capped at the vamp boundary (if any) so jump targets are exact
    const { action, limit } = this.vampAction(pos);
    const { p1, deltaTimeConsumed } = this.backend.step(pos, deltaTime, limit, this.vocalsAreMuted(pos));
    pos = p1;

    // Clamp to the song duration and stop when the end is reached
    if (pos >= this.duration.get()) {
      this.position.set(this.duration.get());
      this.pause();
      if (this.currentSegue.get()?.enabled) {
        this.emitters.segue.fire(undefined);
      }

      return;
    }

    // Apply the vamp action (repeat jump or early exit) if the boundary was reached
    if (action && this.currentVamp.get() && limit !== undefined && p1 >= limit) {
      pos = this.applyVampAction(pos, action, deltaTime - deltaTimeConsumed);
    }

    const finalPos = Math.max(0, Math.min(this.duration.get(), pos));

    this.position.set(finalPos);
  }

  private syncDisplayAt(pos: Tick): TempoEvent | undefined {
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

    return tempoEvent;
  }

  private syncStateAt(pos: Tick): void {
    const tempoEvent = this.syncDisplayAt(pos);
    // seek must precede onTempoRestored so lastKnownPosition is anchored first
    this.backend?.seek(pos);
    if (tempoEvent) {
      this.backend?.onTempoRestored(tempoEvent.bpm);
    }
  }

  private resolveEventTicks(song: Song): void {
    this.vamps = [];
    this.currentVamp.set(undefined);
    this.currentSegue.set(undefined);

    // Resolve the tick positions of all measure-based events by looking up the associated measure's beat ticks.
    for (const e of song.events.markers.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
    }

    for (const e of song.events.vamps.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
      if (e.$startTick !== undefined && e.$endTick !== undefined) {
        this.vamps.push({ start: e.$startTick, end: e.$endTick, iterations: e.iterations, out: e.out ?? "onEnd", vocals: e.vocals ?? "all" });
      } else {
        console.error("Could not resolve location of Vamp:", e);
      }
    }
  }
}
