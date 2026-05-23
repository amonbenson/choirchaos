import { EventEmitter } from "events";

import { MeasureEvent, MidiEventList, TempoEvent, TimeSignatureEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type { MeasureReference } from "../models/measure";
import type Song from "../models/song";
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
const POSITION_UPDATE_DURATION = 1 / 50;

export type { PlayerMode, PlayerSegueState, PlayerStatus, PlayerVampState };
export type MidiPlayerStatus = PlayerStatus;
export type MidiPlayerVampState = PlayerVampState;
export type MidiPlayerSegueState = PlayerSegueState;
export type MidiSystemEvents = SystemEvents;
export type MidiTrackEvents = TrackEvents;
export type MidiPlayerEvents = { system: SystemEvents; track: TrackEvents[] };

type VampAction = "repeat" | "exit-at-end" | "exit-at-barline";

export default class PlayerEngine extends EventEmitter {
  private _status: PlayerStatus = "idle";
  private _mode: PlayerMode = "none";
  private _playing = false;
  private _position: Tick = 0;
  private _duration: Tick = 0;
  private _currentMeasure: MeasureReference = ["1", 0];
  private _currentTempo = 120;
  private _currentTimeSignature: TimeSignature = [4, 2];
  private _finalMeasure: MeasureReference = ["1", 0];
  private _currentVamp?: PlayerVampState;
  private _currentSegue?: PlayerSegueState;

  private _currentSong?: Song;
  private _vamps: PlayerVamp[] = [];
  private _playbackSpeed = 1.0;
  private _playbackTransposition = 0;

  private _audioContext: AudioContext;
  private _masterInput?: AudioNode;
  private _chainOutput?: GainNode;
  private _subplayer?: PlayerBackend;
  private _loadAbortController?: AbortController;
  private _updater: Updater;
  private _timeSinceLastPositionUpdate = 0;

  private _systemEvents: SystemEvents = {
    measure: new MidiEventList<MeasureEvent>(),
    tempo: new MidiEventList<TempoEvent>(),
    timeSignature: new MidiEventList<TimeSignatureEvent>(),
  };

  constructor(audioContext?: AudioContext, updaterFactory?: (callback: UpdateCallback) => Updater) {
    super();
    this._audioContext = audioContext ?? new AudioContext({ latencyHint: "playback" });
    this._updater = updaterFactory
      ? updaterFactory(delta => this._handleStep(delta))
      : new SetIntervalUpdater(delta => this._handleStep(delta), {
          interval: STEP_DURATION,
          maximumLag: 5.0,
          timeProvider: () => this._audioContext?.currentTime ?? 0,
        });
    this._setupAudioContextMonitoring();
  }

  get status(): PlayerStatus {
    return this._status;
  }

  private set status(v: PlayerStatus) {
    this._status = v;
    this.emit("statusChanged", v);
  }

  get playing(): boolean {
    return this._playing;
  }

  private set playing(v: boolean) {
    this._playing = v;
    this.emit("playingChanged", v);
  }

  get position(): Tick {
    return this._position;
  }

  private set position(v: Tick) {
    this._position = Math.max(0, Math.min(this._duration, v));
    this.emit("positionChanged", this._position);
  }

  get duration(): Tick {
    return this._duration;
  }

  private set duration(v: Tick) {
    this._duration = v;
    this.emit("durationChanged", v);
  }

  get currentMeasure(): MeasureReference {
    return this._currentMeasure;
  }

  private set currentMeasure(v: MeasureReference) {
    this._currentMeasure = v;
    this.emit("currentMeasureChanged", v);
  }

  get currentTempo(): number {
    return this._currentTempo;
  }

  private set currentTempo(v: number) {
    this._currentTempo = v;
    this.emit("currentTempoChanged", v);
  }

  get currentTimeSignature(): TimeSignature {
    return this._currentTimeSignature;
  }

  private set currentTimeSignature(v: TimeSignature) {
    this._currentTimeSignature = v;
    this.emit("currentTimeSignatureChanged", v);
  }

  get finalMeasure(): MeasureReference {
    return this._finalMeasure;
  }

  private set finalMeasure(v: MeasureReference) {
    this._finalMeasure = v;
    this.emit("finalMeasureChanged", v);
  }

  get currentVamp(): PlayerVampState | undefined {
    return this._currentVamp;
  }

  private set currentVamp(v: PlayerVampState | undefined) {
    this._currentVamp = v;
    this.emit("currentVampChanged", v);
  }

  get currentSegue(): PlayerSegueState | undefined {
    return this._currentSegue;
  }

  private set currentSegue(v: PlayerSegueState | undefined) {
    this._currentSegue = v;
    this.emit("currentSegueChanged", v);
  }

  get mode(): PlayerMode {
    return this._mode;
  }

  get ppqn(): number {
    return this._subplayer?.ppqn ?? 480;
  }

  get currentSong(): Song | undefined {
    return this._currentSong;
  }

  get audioBuffers(): AudioBuffer[] {
    return this._subplayer?.audioBuffers ?? [];
  }

  get playbackSpeed(): number {
    return this._playbackSpeed;
  }

  set playbackSpeed(value: number) {
    this._playbackSpeed = Math.max(0.1, Math.min(3.0, value));
    this._subplayer?.onPlaybackSpeedChanged(this._playbackSpeed);
    this.emit("playbackSpeedChanged", this._playbackSpeed);
  }

  get playbackTransposition(): number {
    return this._playbackTransposition;
  }

  set playbackTransposition(value: number) {
    this._playbackTransposition = Math.floor(Math.max(-12, Math.min(12, value)));
    this._subplayer?.onPlaybackTranspositionChanged(this._playbackTransposition);
    this.emit("playbackTranspositionChanged", this._playbackTransposition);
  }

  get midi_events(): MidiPlayerEvents {
    const track = this._subplayer instanceof MidiBackend ? this._subplayer.noteEvents : [];
    return { system: this._systemEvents, track };
  }

  resumeAudioContext(): void {
    if (this._audioContext.state !== "running") {
      this._audioContext.resume().catch(() => {});
    }
  }

  private _setupMasterChain(): void {
    const ctx = this._audioContext;
    this._chainOutput?.disconnect();

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

    this._masterInput = input;
    this._chainOutput = output;
  }

  private _setupAudioContextMonitoring(): void {
    this._audioContext.addEventListener("statechange", () => {
      if (this._playing && this._audioContext.state !== "running") {
        this._audioContext.resume().catch(() => {});
      }
    });

    let [lastCt, lastWall] = [0, 0];
    setInterval(() => {
      const [ct, wall] = [this._audioContext.currentTime, performance.now()];
      const elapsed = (wall - lastWall) / 1000;
      if (this._playing && this._audioContext.state === "running" && elapsed > 0.5 && ct - lastCt < elapsed * 0.5) {
        this.emit("audioContextZombie");
      }

      [lastCt, lastWall] = [ct, wall];
    }, 500);
  }

  play(): void {
    if (this.status !== "ready" || this.playing) {
      return;
    }

    this.resumeAudioContext();
    this.emit("positionChanged", this._position);
    this.playing = true;
    this._subplayer?.play(this._position);
    this._updater.start();
  }

  pause(): void {
    if (this.status !== "ready" || !this.playing) {
      return;
    }

    this._subplayer?.pause(this._position);
    this._updater.stop();
    this.emit("positionChanged", this._position);
    this.playing = false;
  }

  stop(): void {
    this.pause();
    this.seek(0);
    if (this.currentVamp) {
      this.currentVamp = { ...this.currentVamp, currentIteration: 0 };
    }
  }

  seek(position: Tick): void {
    if (this.status !== "ready") {
      return;
    }

    const wasPlaying = this.playing;
    this.pause();
    this.position = position;
    this._syncStateAt(this._position);
    const newVamp = this._vampAt(this._position);
    if (newVamp?.start !== this.currentVamp?.start) {
      this.currentVamp = newVamp;
    }

    if (wasPlaying) {
      this.play();
    }
  }

  exitVamp(): void {
    if (this.currentVamp) {
      this.currentVamp = { ...this.currentVamp, manualExit: true };
    }
  }

  resetVamp(): void {
    if (this.currentVamp) {
      this.currentVamp = { ...this.currentVamp, manualExit: false, currentIteration: 0 };
    }
  }

  toggleVamp(): void {
    if (this.currentVamp?.manualExit) {
      this.resetVamp();
    } else {
      this.exitVamp();
    }
  }

  setSegueEnabled(enabled: boolean): void {
    if (this.currentSegue) {
      this.currentSegue = { ...this.currentSegue, enabled };
    }
  }

  toggleSegue(): void {
    this.setSegueEnabled(!this.currentSegue?.enabled);
  }

  async load(song: Song): Promise<void> {
    this._loadAbortController?.abort();
    const controller = new AbortController();
    this._loadAbortController = controller;
    const { signal } = controller;

    if (this.status !== "idle") {
      this.unload();
    }

    if (song.measures.items().length === 0 || song.playerMode === "none") {
      return;
    }

    this.status = "loading";
    this._mode = song.playerMode;
    this._currentSong = song;
    this.resumeAudioContext();
    this._setupMasterChain();

    this._systemEvents = {
      measure: new MidiEventList<MeasureEvent>(),
      tempo: new MidiEventList<TempoEvent>(),
      timeSignature: new MidiEventList<TimeSignatureEvent>(),
    };

    const callbacks = {
      onMeasureChanged: (m: MeasureReference) => {
        this.currentMeasure = m;
      },
      onTempoChanged: (bpm: number) => {
        this.currentTempo = bpm;
      },
      onTimeSignatureChanged: (sig: TimeSignature) => {
        this.currentTimeSignature = sig;
      },
      onNote: (e: import("../midi/events").NoteEvent) => this.emit("note", e),
      onAmplitudes: (a: number[]) => this.emit("trackAmplitudesChanged", a),
    };

    this._subplayer = this._mode === "midi"
      ? new MidiBackend(this._audioContext, this._masterInput!, this._systemEvents, callbacks)
      : new AudioBackend(this._audioContext, this._masterInput!, this._systemEvents, callbacks);

    this._subplayer.onPlaybackSpeedChanged(this._playbackSpeed);
    this._subplayer.onPlaybackTranspositionChanged(this._playbackTransposition);

    let loadResult: { duration: Tick; finalMeasure: MeasureReference };
    try {
      loadResult = await this._subplayer.load(song, signal);
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

    this.duration = loadResult.duration;
    this.finalMeasure = loadResult.finalMeasure;
    this._resolveEventTicks(song);
    this.status = "ready";
    this.seek(0);
  }

  unload(): void {
    if (this.status === "idle") {
      return;
    }

    this.pause();
    this._subplayer?.dispose();
    this._subplayer = undefined;
    this._mode = "none";
    this._currentSong = undefined;
    this.position = 0;
    this.duration = 0;
    this.status = "idle";
  }

  syncWarp(song: Song): void {
    if (this.status !== "ready" || this._mode !== "audio") {
      return;
    }

    this._subplayer?.syncWarp(song);
  }

  private _vampAt(tick: Tick): PlayerVampState | undefined {
    const v = this._vamps.find(v => tick >= v.start && tick < v.end);
    return v ? { ...v, currentIteration: 0, manualExit: false } : undefined;
  }

  private _barlineBetween(after: Tick, before: Tick): Tick | undefined {
    return this._systemEvents.measure.items()
      .find(e => e.tick > after && e.tick < before && e.measure[1] === 0)?.tick;
  }

  private _vampAction(p0: Tick): { action: VampAction | null; limit?: Tick } {
    if (!this.currentVamp) {
      return { action: null };
    }

    const shouldExit = this.currentVamp.manualExit
      || (this.currentVamp.iterations > 0 && this.currentVamp.currentIteration >= this.currentVamp.iterations);
    if (!shouldExit) {
      return { action: "repeat", limit: this.currentVamp.end };
    }

    const barline = this._barlineBetween(p0, this.currentVamp.end);
    return barline !== undefined
      ? { action: "exit-at-barline", limit: barline }
      : { action: "exit-at-end", limit: this.currentVamp.end };
  }

  private _handleStep(delta: number): void {
    if (!this._subplayer) {
      return;
    }

    const p0 = this._position;

    // Must precede action computation so the limit is applied on the entry step.
    if (!this.currentVamp && this._vamps.length > 0) {
      const v = this._vampAt(p0);
      if (v) {
        this.currentVamp = v;
      }
    }

    const { action, limit } = this._vampAction(p0);
    const { p1, deltaConsumed } = this._subplayer.step(p0, delta, limit);
    this._position = p1;

    if (this._position >= this._duration) {
      this.position = this._duration;
      this.pause();
      if (this.currentSegue?.enabled) {
        this.emit("segue");
      }

      return;
    }

    if (action && this.currentVamp && limit !== undefined && p1 >= limit) {
      const vamp = this.currentVamp;
      const remaining = delta - deltaConsumed;
      let jumpOffset = 0;
      let nextLimit: Tick | undefined;

      if (action === "exit-at-barline") {
        jumpOffset = vamp.end - p1;
        this.currentVamp = undefined;
      } else if (action === "exit-at-end") {
        this.currentVamp = undefined;
      } else {
        jumpOffset = -(vamp.end - vamp.start);
        this.currentVamp = { ...vamp, currentIteration: vamp.currentIteration + 1 };
        nextLimit = vamp.end;
      }

      if (jumpOffset !== 0) {
        this._position += jumpOffset;
        this._subplayer.onPositionJump(jumpOffset, this._position);
      }

      if (remaining > 0) {
        const { p1: p1b } = this._subplayer.step(this._position, remaining, nextLimit);
        this._position = p1b;
      }
    }

    this._timeSinceLastPositionUpdate += delta;
    if (this._timeSinceLastPositionUpdate >= POSITION_UPDATE_DURATION) {
      this._timeSinceLastPositionUpdate = 0;
      this.emit("positionChanged", this._position);
    }
  }

  private _syncStateAt(pos: Tick): void {
    const opts = { direction: "backward" as const, inclusive: true, extend: true };
    const measureEvent = this._systemEvents.measure.search({ tick: pos } as MeasureEvent, opts);
    const tempoEvent = this._systemEvents.tempo.search({ tick: pos } as TempoEvent, opts);
    const timeSigEvent = this._systemEvents.timeSignature.search({ tick: pos } as TimeSignatureEvent, opts);
    if (measureEvent) {
      this.currentMeasure = measureEvent.measure;
    }

    if (tempoEvent) {
      this.currentTempo = tempoEvent.bpm;
    }

    if (timeSigEvent) {
      this.currentTimeSignature = timeSigEvent.signature;
    }

    // seek must precede onTempoRestored so _lastKnownPosition is anchored first
    this._subplayer?.seek(pos);
    if (tempoEvent) {
      this._subplayer?.onTempoRestored(tempoEvent.bpm);
    }
  }

  private _resolveEventTicks(song: Song): void {
    this._vamps = [];
    this.currentVamp = undefined;
    this.currentSegue = undefined;

    for (const e of song.events.markers.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
    }

    for (const e of song.events.vamps.items()) {
      e.$startTick = song.findMeasure(e.start[0])?.$beatTicks[0];
      e.$endTick = song.findMeasure(e.end[0])?.$beatTicks[0];
      if (e.$startTick !== undefined && e.$endTick !== undefined) {
        this._vamps.push({ start: e.$startTick, end: e.$endTick, iterations: e.iterations });
      } else {
        console.error("Could not resolve location of Vamp:", e);
      }
    }

    this.currentSegue = song.events.segue ? { enabled: true } : undefined;
  }
}
