import type { NoteEvent } from "../midi/events";
import { BeatEvent, MidiEventList, TempoEvent, TimeSignatureEvent } from "../midi/events";
import type { Tick, TimeSignature } from "../midi/types";
import type { Occurrence } from "../models/recording";
import type Song from "../models/song";
import { Emitter, type Emitters, Property } from "../utils/events";
import { SetIntervalUpdater, type UpdateCallback, type Updater } from "../utils/updater";
import AudioBackend from "./audio/backend";
import type { AudioChunk } from "./audio/chunkDetector";
import AudioClock from "./audioClock";
import { PlayerBackend } from "./backend";
import MidiBackend from "./midi/backend";
import Route, { type RouteJump, type RouteState } from "./route";
import {
  buildBeatEvents,
  findLocationAt,
  getLocationTick,
  getPositionTick,
  isSamePlayerLocation,
  type ResolvedTimeline,
  type TimelinePosition,
} from "./timeline";
import {
  type PlayerLocation,
  type PlayerMode,
  type PlayerSectionState,
  type PlayerSegueState,
  type PlayerStatus,
  type SystemEvents,
  type TrackEvents,
  type VampOut,
  type VampVocals,
} from "./types";

const STEP_DURATION = 1 / 50;
const DEFAULT_TEMPO = 120;
const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 2];
const MAX_JUMPS_PER_STEP = 4;
const MAX_ROUNDS_PER_STEP = 16;
// Passes that follow each other without a jump only change the state. A step covers a few of them at most.
const MAX_TRANSITIONS_PER_PLAN = 8;

export type { PlayerLocation, PlayerMode, PlayerSectionState, PlayerSegueState, PlayerStatus, TimelinePosition, VampOut, VampVocals };
export type PlayerEvents = { system: SystemEvents; track: TrackEvents[] };

/** The state changes up to the next real jump, and where the backend must stop stepping. */
type StepPlan = { transitions: RouteJump[]; jump?: RouteJump; limit?: Tick };

function createSystemEvents(): SystemEvents {
  return {
    beat: new MidiEventList<BeatEvent>(),
    tempo: new MidiEventList<TempoEvent>(),
    timeSignature: new MidiEventList<TimeSignatureEvent>(),
  };
}

function isSameSectionState(a: PlayerSectionState | undefined, b: PlayerSectionState | undefined): boolean {
  return a?.section === b?.section && a?.kind === b?.kind && a?.pass === b?.pass && a?.passes === b?.passes
    && a?.recordedPasses === b?.recordedPasses && a?.released === b?.released;
}

export default class PlayerEngine {
  private readonly status = new Property<PlayerStatus>("idle");
  private readonly mode = new Property<PlayerMode>("none");

  private readonly playing = new Property(false);
  private readonly duration = new Property<Tick>(0);
  private readonly timeline = new Property<ResolvedTimeline>([]);
  private readonly finalLocation = new Property<PlayerLocation | undefined>(undefined);
  private readonly playbackSpeed = new Property(1.0);
  private readonly playbackTransposition = new Property(0);

  private readonly position = new Property<Tick>(0);
  private readonly currentLocation = new Property<PlayerLocation | undefined>(undefined);
  private readonly currentTempo = new Property(DEFAULT_TEMPO);
  private readonly currentTimeSignature = new Property<TimeSignature>(DEFAULT_TIME_SIGNATURE);
  private readonly currentSection = new Property<PlayerSectionState | undefined>(undefined);
  private readonly currentSegue = new Property<PlayerSegueState | undefined>(undefined);

  readonly onStatusChange = this.status.onChange;
  readonly onModeChange = this.mode.onChange;

  readonly onPlayingChange = this.playing.onChange;
  readonly onDurationChange = this.duration.onChange;
  readonly onTimelineChange = this.timeline.onChange;
  readonly onFinalLocationChange = this.finalLocation.onChange;
  readonly onPlaybackSpeedChange = this.playbackSpeed.onChange;
  readonly onPlaybackTranspositionChange = this.playbackTransposition.onChange;

  readonly onPositionChange = this.position.onChange;
  readonly onCurrentLocationChange = this.currentLocation.onChange;
  readonly onCurrentTempoChange = this.currentTempo.onChange;
  readonly onCurrentTimeSignatureChange = this.currentTimeSignature.onChange;
  readonly onCurrentSectionChange = this.currentSection.onChange;
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
  private vampsEnabled = true;
  private route = new Route([], [], { vampsEnabled: true });
  private routeState: RouteState | undefined = undefined;

  private updater: Updater;
  private audioContext: AudioContext;
  private clock: AudioClock;
  private masterInput?: AudioNode;
  private chainOutput?: GainNode;
  private backend?: PlayerBackend;
  private loadAbortController?: AbortController;

  private systemEvents: SystemEvents = createSystemEvents();

  constructor(audioContext?: AudioContext, updaterFactory?: (callback: UpdateCallback) => Updater) {
    this.audioContext = audioContext ?? new AudioContext({ latencyHint: "playback" });
    this.clock = new AudioClock(this.audioContext);
    this.updater = updaterFactory
      ? updaterFactory(delta => this.handleStep(delta))
      : new SetIntervalUpdater(delta => this.handleStep(delta), {
          interval: STEP_DURATION,
          maximumLag: 5.0,
          timeProvider: () => this.clock.now(),
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

  /** The recording's measure order with the ticks of every position. Empty until a song is loaded. */
  getTimeline(): ResolvedTimeline {
    return this.timeline.get();
  }

  getCurrentLocation(): PlayerLocation | undefined {
    return this.currentLocation.get();
  }

  getFinalLocation(): PlayerLocation | undefined {
    return this.finalLocation.get();
  }

  getCurrentTempo(): number {
    return this.currentTempo.get();
  }

  getCurrentTimeSignature(): TimeSignature {
    return this.currentTimeSignature.get();
  }

  getCurrentSection(): PlayerSectionState | undefined {
    return this.currentSection.get();
  }

  getCurrentSegue(): PlayerSegueState | undefined {
    return this.currentSegue.get();
  }

  getCurrentSong(): Song | undefined {
    return this.currentSong;
  }

  /** The tick of a beat at a measure occurrence, or undefined when the recording does not play it. */
  getLocationTick(location: Occurrence & { beat: number }): Tick | undefined {
    return getLocationTick(this.timeline.get(), location);
  }

  /** The tick of a beat at a timeline position, or undefined when there is no such position. */
  getPositionTick(position: number, beat = 0): Tick | undefined {
    return getPositionTick(this.timeline.get(), position, beat);
  }

  getTrackChunks(): AudioChunk[][] {
    return this.backend instanceof AudioBackend ? this.backend.getTrackChunks() : [];
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
  }

  seek(position: Tick): void {
    if (this.status.get() !== "ready") {
      return;
    }

    // Pause the player while seeking, then resume if it was playing before
    const wasPlaying = this.playing.get();
    this.pause();

    this.position.set(Math.max(0, Math.min(this.duration.get(), position)));
    this.syncStateAt(this.position.get());

    // A seek is a fresh visit, so the section state follows from the position alone.
    this.routeState = this.route.stateAt(this.position.get());
    this.syncSection();

    if (wasPlaying) {
      this.play();
    }
  }

  /** Makes the current vamp pass the last one. */
  releaseVamp(): void {
    const state = this.routeState;
    if (!state || state.released || this.currentSection.get()?.kind !== "vamp") {
      return;
    }

    this.routeState = { ...state, released: true };
    this.syncSection();
  }

  /** Takes back a release and counts the vamp's passes from the current recorded pass again. */
  resetVamp(): void {
    if (this.currentSection.get()?.kind !== "vamp") {
      return;
    }

    this.routeState = this.route.stateAt(this.position.get());
    this.syncSection();
  }

  toggleVamp(): void {
    if (this.currentSection.get()?.released) {
      this.resetVamp();
    } else {
      this.releaseVamp();
    }
  }

  /** Disabled vamps play as recorded. */
  setVampsEnabled(enabled: boolean): void {
    if (this.vampsEnabled === enabled) {
      return;
    }

    this.vampsEnabled = enabled;
    this.rebuildRoute();
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

  async load(song: Song, startPosition: Tick = 0): Promise<void> {
    // Unloading also aborts any in-progress load operation
    this.unload();
    const controller = new AbortController();
    this.loadAbortController = controller;
    const { signal } = controller;

    // If the song has nothing to play or no player mode, stop here
    if (song.getTimeline().length === 0 || song.playerMode === "none") {
      return;
    }

    // Enter loading state and initialize the master chain
    this.status.set("loading");
    this.mode.set(song.playerMode);
    this.currentSong = song;
    this.resumeAudioContext();
    this.setupMasterChain();

    this.systemEvents = createSystemEvents();

    const callbacks = {
      onTempoChanged: (bpm: number) => this.currentTempo.set(bpm),
      onTimeSignatureChanged: (sig: TimeSignature) => this.currentTimeSignature.set(sig),
      onNote: (e: NoteEvent) => this.emitters.note.fire(e),
      onAmplitudes: (a: number[]) => this.emitters.trackAmplitudesChange.fire(a),
    };

    // Setup the backend (either midi or audio mode)
    this.backend = this.mode.get() === "midi"
      ? new MidiBackend(this.audioContext, this.clock, this.masterInput!, this.systemEvents, callbacks)
      : new AudioBackend(this.audioContext, this.clock, this.masterInput!, this.systemEvents, callbacks);

    // Set the current playback speed and transposition immediately
    this.backend.onPlaybackSpeedChanged(this.playbackSpeed.get());
    this.backend.onPlaybackTranspositionChanged(this.playbackTransposition.get());

    // Try to load the song. If it fails, cleanup the state by unloading and re-throw the error
    let loadResult: { duration: Tick; timeline: TimelinePosition[] };
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

    this.duration.set(loadResult.duration);
    this.applyTimeline(loadResult.timeline);

    this.route = this.createRoute();
    this.status.set("ready");

    // Setup segue only once at the start of the song
    this.currentSegue.set(song.hasSegue() ? { enabled: true } : undefined);

    // This will set the position and perform an initial sync for the current section, location, tempo, etc.
    this.seek(startPosition);
  }

  unload(): void {
    this.loadAbortController?.abort();
    this.loadAbortController = undefined;

    if (this.status.get() === "idle") {
      return;
    }

    // Stop playback, dispose the backend, and reset all state
    this.pause();
    this.backend?.dispose();
    this.backend = undefined;

    this.mode.set("none");
    this.currentSong = undefined;
    this.route = new Route([], [], { vampsEnabled: this.vampsEnabled });
    this.routeState = undefined;
    this.duration.set(0);
    this.timeline.set([]);
    this.finalLocation.set(undefined);

    this.position.set(0);
    this.currentLocation.set(undefined);
    this.currentTempo.set(DEFAULT_TEMPO);
    this.currentTimeSignature.set(DEFAULT_TIME_SIGNATURE);
    this.currentSection.set(undefined);
    this.currentSegue.set(undefined);

    this.status.set("idle");
  }

  /**
   * Re-resolves the timeline after warp marker edits and the sections after section edits. It keeps the
   * position, the segue and the pass count of the section being played, and does not seek the backend.
   */
  syncWarp(): void {
    if (this.status.get() !== "ready" || !this.currentSong) {
      return;
    }

    if (this.backend instanceof AudioBackend) {
      this.applyTimeline(this.backend.syncWarp());
    }

    this.rebuildRoute();
    this.syncDisplayAt(this.position.get());
  }

  private createRoute(): Route {
    return new Route(this.timeline.get(), this.currentSong?.getSections() ?? [], { vampsEnabled: this.vampsEnabled });
  }

  private rebuildRoute(): void {
    const previous = this.routeState;
    this.route = this.createRoute();

    const fresh = this.route.stateAt(this.position.get());
    const isSameSection = previous && fresh && previous.section === fresh.section
      && this.route.getSectionState(fresh)?.kind === this.currentSection.get()?.kind;
    this.routeState = isSameSection ? { ...fresh, pass: previous.pass, released: previous.released } : fresh;
    this.syncSection();
  }

  private applyTimeline(timeline: TimelinePosition[]): void {
    this.systemEvents.beat = buildBeatEvents(timeline);
    this.timeline.set(timeline);

    const lastTick = Math.max(0, this.duration.get() - 1);
    const final = findLocationAt(timeline, lastTick);
    if (!isSamePlayerLocation(final, this.finalLocation.get())) {
      this.finalLocation.set(final);
    }
  }

  /**
   * Collects the state changes up to the next real jump. The backend stops at the jump, and also where
   * muting vocals changes, so notes on a pass boundary get the new pass's vocals.
   */
  /** The next jump that moves the position, passing the state changes before it. */
  private findNextJump(position: Tick): RouteJump | undefined {
    let state = this.routeState;
    let tick = position;
    for (let i = 0; i < MAX_TRANSITIONS_PER_PLAN; i++) {
      const next = this.route.nextJump(state, tick);
      if (!next || next.to !== next.at) {
        return next;
      }

      state = next.next;
      tick = next.at;
    }

    return undefined;
  }

  private planStep(position: Tick): StepPlan {
    const transitions: RouteJump[] = [];
    let state = this.routeState;
    let tick = position;
    const muted = this.route.muteVocals(state, tick);

    for (let i = 0; i < MAX_TRANSITIONS_PER_PLAN; i++) {
      const next = this.route.nextJump(state, tick);
      const muteChange = this.route.findMuteChange(state, tick);
      if (muteChange !== undefined && (!next || muteChange < next.at)) {
        return { transitions, limit: muteChange };
      }

      if (!next) {
        return { transitions };
      }

      if (next.to !== next.at) {
        return { transitions, jump: next, limit: next.at };
      }

      transitions.push(next);
      if (this.route.muteVocals(next.next, next.at) !== muted) {
        return { transitions, limit: next.at };
      }

      state = next.next;
      tick = next.at;
    }

    return { transitions, limit: tick };
  }

  private applyTransitions(transitions: RouteJump[], position: Tick): void {
    for (const transition of transitions) {
      if (transition.at > position) {
        return;
      }

      this.routeState = transition.next;
    }
  }

  private jump(jump: RouteJump): Tick {
    this.routeState = jump.next;
    this.backend!.onPositionJump(jump.to - jump.at, jump.to);
    this.restoreTempoAt(jump.to);
    return jump.to;
  }

  /** Ends playback when the song is over. Returns whether it did. */
  private finishIfEnded(position: Tick): boolean {
    if (position < this.duration.get()) {
      return false;
    }

    this.position.set(this.duration.get());
    this.syncLocation(this.duration.get());
    this.pause();
    if (this.currentSegue.get()?.enabled) {
      this.emitters.segue.fire(undefined);
    }

    return true;
  }

  private handleStep(deltaTime: number): void {
    if (!this.backend) {
      return;
    }

    let pos = this.position.get();
    let remaining = deltaTime;
    let jumps = 0;

    // Each round steps the backend up to the next jump or stop. MIDI consumes the time exactly, so it
    // continues after a stop, while audio always reports the whole step as consumed.
    for (let round = 0; round < MAX_ROUNDS_PER_STEP; round++) {
      const plan = this.planStep(pos);
      const jumpsNow = plan.jump !== undefined && plan.jump.at <= pos;

      if (!jumpsNow) {
        if (round > 0 && remaining <= 0) {
          break;
        }

        const muteVocals = this.route.muteVocals(this.routeState, pos);
        const { p1, deltaTimeConsumed } = this.backend.step(pos, remaining, plan.limit, muteVocals);
        remaining -= deltaTimeConsumed;
        pos = p1;
      }

      this.applyTransitions(plan.transitions, pos);
      if (this.finishIfEnded(pos)) {
        return;
      }

      if (plan.jump && pos >= plan.jump.at && jumps < MAX_JUMPS_PER_STEP) {
        pos = this.jump(plan.jump);
        jumps++;
        if (this.finishIfEnded(pos)) {
          return;
        }

        continue;
      }

      const reachedStop = !plan.jump && plan.limit !== undefined && pos >= plan.limit;
      if (!reachedStop) {
        break;
      }
    }

    this.position.set(Math.max(0, Math.min(this.duration.get(), pos)));
    this.syncLocation(pos);
    this.syncSection();
    this.backend.prepareJump(this.findNextJump(pos));
  }

  private syncLocation(pos: Tick): void {
    const location = findLocationAt(this.timeline.get(), pos);
    if (!isSamePlayerLocation(location, this.currentLocation.get())) {
      this.currentLocation.set(location);
    }
  }

  private syncSection(): void {
    const section = this.route.getSectionState(this.routeState) ?? this.route.getCutStateAt(this.position.get());
    if (!isSameSectionState(section, this.currentSection.get())) {
      this.currentSection.set(section);
    }
  }

  private syncDisplayAt(pos: Tick): TempoEvent | undefined {
    const opts = { direction: "backward" as const, inclusive: true, extend: true };
    const tempoEvent = this.systemEvents.tempo.search({ tick: pos } as TempoEvent, opts);
    const timeSigEvent = this.systemEvents.timeSignature.search({ tick: pos } as TimeSignatureEvent, opts);
    this.syncLocation(pos);

    if (tempoEvent) {
      this.currentTempo.set(tempoEvent.bpm);
    }

    if (timeSigEvent) {
      this.currentTimeSignature.set(timeSigEvent.signature);
    }

    return tempoEvent;
  }

  /** A jump can cross tempo changes, so the backend's clock follows the tempo at the target. */
  private restoreTempoAt(pos: Tick): void {
    const previousTempo = this.currentTempo.get();
    const tempoEvent = this.syncDisplayAt(pos);
    if (tempoEvent && tempoEvent.bpm !== previousTempo) {
      this.backend?.onTempoRestored(tempoEvent.bpm);
    }
  }

  private syncStateAt(pos: Tick): void {
    const tempoEvent = this.syncDisplayAt(pos);
    // seek must precede onTempoRestored so lastKnownPosition is anchored first
    this.backend?.seek(pos);
    if (tempoEvent) {
      this.backend?.onTempoRestored(tempoEvent.bpm);
    }
  }
}
