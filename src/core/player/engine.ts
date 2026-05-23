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

// Legacy aliases kept for backward compatibility with existing imports.
export type MidiPlayerStatus = PlayerStatus;
export type MidiPlayerVampState = PlayerVampState;
export type MidiPlayerSegueState = PlayerSegueState;
export type MidiSystemEvents = SystemEvents;
export type MidiTrackEvents = TrackEvents;
export type MidiPlayerEvents = { system: SystemEvents; track: TrackEvents[] };

export default class PlayerEngine extends EventEmitter {
  private _status: PlayerStatus = "idle";
  private _mode: PlayerMode = "none";
  private _playing = false;

  private _position: Tick = 0;
  private _duration: Tick = 0;

  private _currentSong?: Song;
  private _currentMeasure: MeasureReference = ["1", 0];
  private _currentTempo = 120;
  private _currentTimeSignature: TimeSignature = [4, 2];
  private _finalMeasure: MeasureReference = ["1", 0];

  private _systemEvents: SystemEvents = {
    measure: new MidiEventList<MeasureEvent>(),
    tempo: new MidiEventList<TempoEvent>(),
    timeSignature: new MidiEventList<TimeSignatureEvent>(),
  };

  private _vamps: PlayerVamp[] = [];
  private _currentVamp?: PlayerVampState;
  private _currentSegue?: PlayerSegueState;

  private _playbackSpeed = 1.0;
  private _playbackTransposition = 0;

  // 'playback' uses a larger hardware buffer (~100ms vs ~11ms for 'interactive'),
  // giving the OS enough headroom to absorb Bluetooth A2DP jitter without underruns.
  private _audioContext: AudioContext;
  private _masterInput?: AudioNode;
  private _chainOutput?: GainNode;

  private _subplayer?: PlayerBackend;
  private _loadAbortController?: AbortController;

  private _updater: Updater;
  private _timeSinceLastPositionUpdate = 0;

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

  // ── Public getters ────────────────────────────────────────────────────────

  get status(): PlayerStatus {
    return this._status;
  }

  get playing(): boolean {
    return this._playing;
  }

  get position(): Tick {
    return this._position;
  }

  get duration(): Tick {
    return this._duration;
  }

  get currentMeasure(): MeasureReference {
    return this._currentMeasure;
  }

  get currentTempo(): number {
    return this._currentTempo;
  }

  get currentTimeSignature(): TimeSignature {
    return this._currentTimeSignature;
  }

  get finalMeasure(): MeasureReference {
    return this._finalMeasure;
  }

  get currentVamp(): PlayerVampState | undefined {
    return this._currentVamp;
  }

  get currentSegue(): PlayerSegueState | undefined {
    return this._currentSegue;
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

  // Expose the current system and track events for external consumers (e.g. the
  // player store which passes them to the PDF score viewer).
  get midi_events(): MidiPlayerEvents {
    const track = this._subplayer instanceof MidiBackend
      ? this._subplayer.noteEvents
      : [];
    return { system: this._systemEvents, track };
  }

  // ── Private state updaters ────────────────────────────────────────────────

  private _updateStatus(value: PlayerStatus): void {
    this._status = value;
    this.emit("statusChanged", this._status);
  }

  private _updatePlaying(value: boolean): void {
    this._playing = value;
    this.emit("playingChanged", this._playing);
  }

  private _updatePosition(value: Tick): void {
    this._position = Math.max(0, Math.min(this._duration, value));
    this.emit("positionChanged", this._position);
  }

  private _updateDuration(value: Tick): void {
    this._duration = value;
    this.emit("durationChanged", this._duration);
  }

  private _updateCurrentMeasure(value: MeasureReference): void {
    this._currentMeasure = value;
    this.emit("currentMeasureChanged", this._currentMeasure);
  }

  private _updateCurrentTempo(value: number): void {
    this._currentTempo = value;
    this.emit("currentTempoChanged", this._currentTempo);
  }

  private _updateCurrentTimeSignature(value: TimeSignature): void {
    this._currentTimeSignature = value;
    this.emit("currentTimeSignatureChanged", this._currentTimeSignature);
  }

  private _updateFinalMeasure(value: MeasureReference): void {
    this._finalMeasure = value;
    this.emit("finalMeasureChanged", this._finalMeasure);
  }

  private _updateCurrentVamp(value: PlayerVampState | undefined): void {
    this._currentVamp = value;
    this.emit("currentVampChanged", this._currentVamp);
  }

  private _updateCurrentSegue(value: PlayerSegueState | undefined): void {
    this._currentSegue = value;
    this.emit("currentSegueChanged", this._currentSegue);
  }

  // ── Audio context infrastructure ──────────────────────────────────────────

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

    // Zombie detection: iOS Safari with Bluetooth can report state="running"
    // while producing no audio and currentTime stops advancing.
    let lastTime = 0;
    let lastAt = 0;
    setInterval(() => {
      if (!this._playing || this._audioContext.state !== "running") {
        lastTime = this._audioContext.currentTime;
        lastAt = performance.now();
        return;
      }

      const elapsed = (performance.now() - lastAt) / 1000;
      const advanced = this._audioContext.currentTime - lastTime;

      if (elapsed > 0.5 && advanced < elapsed * 0.5) {
        this.emit("audioContextZombie");
      }

      lastTime = this._audioContext.currentTime;
      lastAt = performance.now();
    }, 500);
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  play(): void {
    if (this._status !== "ready" || this._playing) {
      return;
    }

    this.resumeAudioContext();
    this.emit("positionChanged", this._position);
    this._updatePlaying(true);
    this._subplayer?.play(this._position);
    this._updater.start();
  }

  pause(): void {
    if (this._status !== "ready" || !this._playing) {
      return;
    }

    this._subplayer?.pause(this._position);
    this._updater.stop();
    this.emit("positionChanged", this._position);
    this._updatePlaying(false);
  }

  stop(): void {
    this.pause();
    this.seek(0);

    // Reset vamp iterations if the playhead is inside a vamp at position 0
    if (this._currentVamp) {
      this._updateCurrentVamp({ ...this._currentVamp, currentIteration: 0 });
    }
  }

  seek(position: Tick): void {
    if (this._status !== "ready") {
      return;
    }

    const wasPlaying = this._playing;
    this.pause();

    this._updatePosition(position);

    // Restore state from the event lists so tempo, time-sig and measure are
    // immediately correct at the new position.
    const searchOpts = { direction: "backward" as const, inclusive: true, extend: true };
    const measureEvent = this._systemEvents.measure.search({ tick: this._position } as MeasureEvent, searchOpts);
    const tempoEvent = this._systemEvents.tempo.search({ tick: this._position } as TempoEvent, searchOpts);
    const timeSigEvent = this._systemEvents.timeSignature.search({ tick: this._position } as TimeSignatureEvent, searchOpts);

    if (measureEvent) {
      this._updateCurrentMeasure(measureEvent.measure);
    }

    if (tempoEvent) {
      this._updateCurrentTempo(tempoEvent.bpm);
    }

    if (timeSigEvent) {
      this._updateCurrentTimeSignature(timeSigEvent.signature);
    }

    // Seek the audio backend first so _lastKnownPosition is correct before
    // onTempoRestored resets the audio clock reference.
    this._subplayer?.seek(this._position);

    // Notify subplayer of restored tempo so it can update its tick duration.
    if (tempoEvent) {
      this._subplayer?.onTempoRestored(tempoEvent.bpm);
    }

    // Update vamp state for the new position
    const newVamp = this._getVampAt(this._position);
    if (newVamp?.start !== this._currentVamp?.start) {
      this._updateCurrentVamp(newVamp);
    }

    if (wasPlaying) {
      this.play();
    }
  }

  // ── Vamp controls ─────────────────────────────────────────────────────────

  exitVamp(): void {
    if (this._currentVamp) {
      this._updateCurrentVamp({ ...this._currentVamp, manualExit: true });
    }
  }

  resetVamp(): void {
    if (this._currentVamp) {
      this._updateCurrentVamp({ ...this._currentVamp, manualExit: false, currentIteration: 0 });
    }
  }

  toggleVamp(): void {
    if (this._currentVamp) {
      if (this._currentVamp.manualExit) {
        this.resetVamp();
      } else {
        this.exitVamp();
      }
    }
  }

  // ── Segue controls ────────────────────────────────────────────────────────

  setSegueEnabled(enabled: boolean): void {
    if (this._currentSegue) {
      this._updateCurrentSegue({ ...this._currentSegue, enabled });
    }
  }

  toggleSegue(): void {
    this.setSegueEnabled(!this._currentSegue?.enabled);
  }

  // ── Load / unload ─────────────────────────────────────────────────────────

  async load(song: Song): Promise<void> {
    this._loadAbortController?.abort();
    const controller = new AbortController();
    this._loadAbortController = controller;
    const { signal } = controller;

    if (this._status !== "idle") {
      this.unload();
    }

    if (song.measures.items().length === 0 || song.playerMode === "none") {
      return;
    }

    this._updateStatus("loading");
    this._mode = song.playerMode;
    this._currentSong = song;
    this.resumeAudioContext();
    this._setupMasterChain();

    // Fresh system events object; subplayer populates it during load
    this._systemEvents = {
      measure: new MidiEventList<MeasureEvent>(),
      tempo: new MidiEventList<TempoEvent>(),
      timeSignature: new MidiEventList<TimeSignatureEvent>(),
    };

    const callbacks = {
      onMeasureChanged: (m: MeasureReference) => this._updateCurrentMeasure(m),
      onTempoChanged: (bpm: number) => this._updateCurrentTempo(bpm),
      onTimeSignatureChanged: (sig: TimeSignature) => this._updateCurrentTimeSignature(sig),
      onNote: (e: import("../midi/events").NoteEvent) => this.emit("note", e),
      onAmplitudes: (a: number[]) => this.emit("trackAmplitudesChanged", a),
    };

    if (this._mode === "midi") {
      this._subplayer = new MidiBackend(this._audioContext, this._masterInput!, this._systemEvents, callbacks);
    } else {
      this._subplayer = new AudioBackend(this._audioContext, this._masterInput!, this._systemEvents, callbacks);
    }

    // Sync current speed and transposition into the fresh subplayer
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

    this._updateDuration(loadResult.duration);
    this._updateFinalMeasure(loadResult.finalMeasure);

    // Resolve song-level events (vamps, markers) now that $beatTicks are populated
    this._vamps = [];
    this._updateCurrentVamp(undefined);
    this._updateCurrentSegue(undefined);

    for (const markerEvent of song.events.markers.items()) {
      markerEvent.$startTick = song.findMeasure(markerEvent.start[0])?.$beatTicks[0];
      markerEvent.$endTick = song.findMeasure(markerEvent.end[0])?.$beatTicks[0];
    }

    for (const vampEvent of song.events.vamps.items()) {
      vampEvent.$startTick = song.findMeasure(vampEvent.start[0])?.$beatTicks[0];
      vampEvent.$endTick = song.findMeasure(vampEvent.end[0])?.$beatTicks[0];

      if (vampEvent.$startTick !== undefined && vampEvent.$endTick !== undefined) {
        this._vamps.push({
          start: vampEvent.$startTick,
          end: vampEvent.$endTick,
          iterations: vampEvent.iterations,
        });
      } else {
        console.error("Could not resolve location of Vamp:", vampEvent);
      }
    }

    this._updateCurrentSegue(song.events.segue ? { enabled: true } : undefined);

    this._updateStatus("ready");
    this.seek(0);
  }

  unload(): void {
    if (this._status === "idle") {
      return;
    }

    this.pause();

    this._subplayer?.dispose();
    this._subplayer = undefined;
    this._mode = "none";
    this._currentSong = undefined;

    this._updatePosition(0);
    this._updateDuration(0);
    this._updateStatus("idle");
  }

  // Rebuild warp-derived timing without re-fetching audio (audio mode only).
  syncWarp(song: Song): void {
    if (this._status !== "ready" || this._mode !== "audio") {
      return;
    }

    this._subplayer?.syncWarp(song);
  }

  // ── Core step handler ─────────────────────────────────────────────────────

  private _getVampAt(tick: Tick): PlayerVampState | undefined {
    for (const vamp of this._vamps) {
      if (tick >= vamp.start && tick < vamp.end) {
        return { ...vamp, currentIteration: 0, manualExit: false };
      }
    }

    return undefined;
  }

  // Returns the tick of the first measure barline strictly after `afterTick` and
  // strictly before `beforeTick`, or undefined if none exists. Used to find the
  // early-exit split point for multi-bar vamps.
  private _nextVampBarline(afterTick: Tick, beforeTick: Tick): Tick | undefined {
    for (const event of this._systemEvents.measure.items()) {
      if (event.tick <= afterTick) {
        continue;
      }

      if (event.tick >= beforeTick) {
        break;
      }

      if (event.measure[1] === 0) {
        return event.tick;
      }
    }

    return undefined;
  }

  private _handleStep(delta: number): void {
    if (!this._subplayer) {
      return;
    }

    const p0 = this._position;

    // ── Pre-compute the vamp action ───────────────────────────────────────────
    // All three actions are determined before step() is called so the backend
    // never schedules notes past the split point.
    //
    //  repeat        – cap at vamp.end, jump back to vamp.start
    //  exit-at-end   – cap at vamp.end, clear vamp and continue
    //  exit-at-barline – cap at next internal barline, jump forward to vamp.end
    //
    type VampAction = "repeat" | "exit-at-end" | "exit-at-barline";
    let stepLimit: Tick | undefined;
    let vampAction: VampAction | null = null;

    if (this._currentVamp) {
      const shouldExit = this._currentVamp.manualExit
        || (this._currentVamp.iterations > 0
          && this._currentVamp.currentIteration >= this._currentVamp.iterations);

      if (shouldExit) {
        const barline = this._nextVampBarline(p0, this._currentVamp.end);
        if (barline !== undefined) {
          stepLimit = barline;
          vampAction = "exit-at-barline";
        } else {
          stepLimit = this._currentVamp.end;
          vampAction = "exit-at-end";
        }
      } else {
        stepLimit = this._currentVamp.end;
        vampAction = "repeat";
      }
    }

    const { p1, deltaConsumed } = this._subplayer.step(p0, delta, stepLimit);
    this._position = p1;

    // End-of-song: check the new position (fires in the same step as the overshoot)
    if (this._position >= this._duration) {
      this._updatePosition(this._duration);
      this.pause();
      if (this._currentSegue?.enabled) {
        this.emit("segue");
      }

      return;
    }

    // Vamp entry detection (only when not already in a vamp, using position before step)
    if (!this._currentVamp && this._vamps.length > 0) {
      const v = this._getVampAt(p0);
      if (v) {
        this._updateCurrentVamp(v);
      }
    }

    // ── Execute vamp action ───────────────────────────────────────────────────
    if (vampAction !== null && this._currentVamp) {
      const reachedLimit = stepLimit !== undefined && p1 >= stepLimit;

      if (reachedLimit) {
        const vamp = this._currentVamp;
        const deltaRemaining = delta - deltaConsumed;

        if (vampAction === "exit-at-barline") {
          // Jump forward from the barline to the vamp end, then play the
          // remaining delta from there so no wall-clock time is lost.
          this._updateCurrentVamp(undefined);
          const jumpOffset = vamp.end - p1;
          this._position = vamp.end;
          this._subplayer.onPositionJump(jumpOffset, this._position);
          if (deltaRemaining > 0) {
            const { p1: p1b } = this._subplayer.step(this._position, deltaRemaining);
            this._position = p1b;
          }
        } else if (vampAction === "exit-at-end") {
          // Clear the vamp and play the remaining delta past the vamp end.
          this._updateCurrentVamp(undefined);
          if (deltaRemaining > 0) {
            const { p1: p1b } = this._subplayer.step(this._position, deltaRemaining);
            this._position = p1b;
          }
        } else {
          // Repeat: jump back to vamp start and play the remaining delta from there.
          const jumpOffset = -(vamp.end - vamp.start);
          this._position += jumpOffset;
          this._subplayer.onPositionJump(jumpOffset, this._position);
          this._updateCurrentVamp({
            ...vamp,
            currentIteration: vamp.currentIteration + 1,
          });
          if (deltaRemaining > 0) {
            // Cap at vamp.end again for safety (very short vamps).
            const { p1: p1b } = this._subplayer.step(
              this._position,
              deltaRemaining,
              this._currentVamp?.end,
            );
            this._position = p1b;
          }
        }
      }
    }

    // Emit position at a throttled rate to avoid flooding reactivity
    this._timeSinceLastPositionUpdate += delta;
    if (this._timeSinceLastPositionUpdate >= POSITION_UPDATE_DURATION) {
      this._timeSinceLastPositionUpdate = 0;
      this.emit("positionChanged", this._position);
    }
  }
}
