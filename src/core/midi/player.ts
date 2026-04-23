import axios from "axios";
import { EventEmitter } from "events";
import { parseArrayBuffer as parseMidiBuffer } from "midi-json-parser";

import type { MeasureReference } from "../models/measure";
import type Measure from "../models/measure";
import type Song from "../models/song";
import type { MTIMidiJson } from "../scripts/jsonTypes/mti";
import { type BinarySearchOptions } from "../utils/binarySearch";
import { resolveUrl } from "../utils/file";
import { SetIntervalUpdater, type Updater } from "../utils/updater";
import AudioPlayer from "./audioPlayer";
import { MeasureEvent, MidiEvent, MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "./events";
import type { Tick, TimeSignature } from "./types";
import WarpMap from "./warp";

const STEP_DURATION = 1 / 50;
const POSITION_UPDATE_DURATION = 1 / 50;
const AUDIO_CLOCK_OFFSET = 0.1;

declare global {
  interface Window { WebAudioFontPlayer: any }
}

export type MidiPlayerStatus = "idle" | "loading" | "ready";

export type MidiPlayerVamp = {
  start: Tick;
  end: Tick;
  iterations: number;
};

export type MidiPlayerVampState = MidiPlayerVamp & {
  currentIteration: number;
  manualExit: boolean;
};

export type MidiPlayerSegueState = {
  enabled: boolean;
};

export type MidiSystemEvents = {
  measure: MidiEventList<MeasureEvent>;
  tempo: MidiEventList<TempoEvent>;
  timeSignature: MidiEventList<TimeSignatureEvent>;
};

export type MidiTrackEvents = {
  note: MidiEventList<NoteEvent>;
};

export type MidiPlayerEvents = {
  system: MidiSystemEvents;
  track: MidiTrackEvents[];
};

export type PlayerMode = "none" | "midi" | "audio";

export default class MidiPlayer extends EventEmitter {
  private _status: MidiPlayerStatus = "idle";
  private _mode: PlayerMode = "none";
  private _playing = false;

  private _ppqn = 480;
  private _tickDuration = 0;

  private _position: Tick = 0;
  private _duration: Tick = 0;

  private _currentSong?: Song;
  private _currentMeasure: MeasureReference = ["1", 0];
  private _currentTempo: number = 120;
  private _currentTimeSignature: TimeSignature = [4, 2];
  private _finalMeasure: MeasureReference = ["1", 0];

  private _midi_events: MidiPlayerEvents = {
    system: {
      measure: new MidiEventList(),
      tempo: new MidiEventList(),
      timeSignature: new MidiEventList(),
    },
    track: [],
  };

  private _warpMap = new WarpMap();

  private _vamps: MidiPlayerVamp[] = [];
  private _currentVamp?: MidiPlayerVampState;
  private _currentSegue?: MidiPlayerSegueState;

  private _audioContext = new AudioContext();
  private _masterInput: AudioNode | undefined = undefined;
  private _chainOutput: GainNode | undefined;

  private _player: any = undefined;
  private _instruments: { [key: number]: any } = {};

  private _audioPlayer: AudioPlayer | undefined;

  private _playbackSpeed: number = 1.0;
  private _playbackTransposition: number = 0;

  private _audioClockReference: {
    seconds: number;
    ticks: number;
  } = { seconds: 0, ticks: 0 };

  private _audioClockTickPosition: number = 0;
  private _audioBuffers: AudioBuffer[] = [];

  private _updater: Updater = new SetIntervalUpdater(delta => this._handleStep(delta), {
    interval: STEP_DURATION,
    maximumLag: 5.0,
    timeProvider: () => this._audioContext?.currentTime ?? 0,
  });

  private _timeSinceLastPositionUpdate = 0;
  private _barlineCrossedDuringLastStep = false;

  get status(): MidiPlayerStatus {
    return this._status;
  }

  private _updateStatus(value: MidiPlayerStatus): void {
    this._status = value;
    this.emit("statusChanged", this._status);
  }

  get playing(): boolean {
    return this._playing;
  }

  private _updatePlaying(value: boolean): void {
    this._playing = value;
    this.emit("playingChanged", this._playing);
  }

  get position(): Tick {
    return this._position;
  }

  private _updatePosition(value: Tick): void {
    // TODO: slow down emit rate while playing
    this._position = Math.max(0, Math.min(this._duration, value));
    this.emit("positionChanged", this._position);
  }

  get duration(): Tick {
    return this._duration;
  }

  private _updateDuration(value: Tick): void {
    this._duration = value;
    this.emit("durationChanged", this._duration);
  }

  get currentMeasure(): MeasureReference {
    return this._currentMeasure;
  }

  private _updateCurrentMeasure(value: MeasureReference): void {
    this._currentMeasure = value;
    this.emit("currentMeasureChanged", this._currentMeasure);
  }

  get currentTempo(): number {
    return this._currentTempo;
  }

  private _updateCurrentTempo(value: number): void {
    this._currentTempo = value;
    this.emit("currentTempoChanged", this._currentTempo);
  }

  get currentTimeSignature(): TimeSignature {
    return this._currentTimeSignature;
  }

  private _updateCurrentTimeSignature(value: TimeSignature): void {
    this._currentTimeSignature = value;
    this.emit("currentTimeSignatureChanged", this._currentTimeSignature);
  }

  get finalMeasure(): MeasureReference {
    return this._finalMeasure;
  }

  private _updateFinalMeasure(value: MeasureReference): void {
    this._finalMeasure = value;
    this.emit("finalMeasureChanged", this._finalMeasure);
  }

  get currentVamp(): MidiPlayerVampState | undefined {
    return this._currentVamp;
  }

  private _updateCurrentVamp(value: MidiPlayerVampState | undefined): void {
    this._currentVamp = value;
    this.emit("currentVampChanged", this._currentVamp);
  }

  get currentSegue(): MidiPlayerSegueState | undefined {
    return this._currentSegue;
  }

  private _updateCurrentSegue(value: MidiPlayerSegueState | undefined): void {
    this._currentSegue = value;
    this.emit("currentSegueChanged", this._currentSegue);
  }

  get midi_events(): MidiPlayerEvents {
    return this._midi_events;
  }

  get mode(): PlayerMode {
    return this._mode;
  }

  get ppqn(): number {
    return this._ppqn;
  }

  get currentSong(): Song | undefined {
    return this._currentSong;
  }

  get audioBuffers(): AudioBuffer[] {
    return this._audioBuffers;
  }

  get playbackSpeed(): number {
    return this._playbackSpeed;
  }

  set playbackSpeed(value: number) {
    this._playbackSpeed = Math.max(0.1, Math.min(3.0, value));
    this._updateTickDuration(); // will also reset the audio clock
    this.emit("playbackSpeedChanged", this._playbackSpeed);
  }

  get playbackTransposition(): number {
    return this._playbackTransposition;
  }

  set playbackTransposition(value: number) {
    this._playbackTransposition = Math.floor(Math.max(-12, Math.min(12, value)));
    this.emit("playbackTranspositionChanged", this._playbackTransposition);
  }

  private _resetAudioClockReference(): void {
    this._audioClockReference = {
      seconds: this._updater.now(),
      ticks: this._position,
    };
  }

  private _updateTickDuration(): void {
    const ticksPerSecond = this._currentTempo / 60 * this._ppqn * this._playbackSpeed;
    this._tickDuration = 1 / ticksPerSecond;

    this._resetAudioClockReference();
  }

  private _getVampAt(tick: Tick): MidiPlayerVampState | undefined {
    // search for a vamp at the provided tick position
    for (const vamp of this._vamps) {
      if (tick >= vamp.start && tick < vamp.end) {
        return {
          ...vamp,
          currentIteration: 0,
          manualExit: false,
        };
      }
    }

    return undefined;
  }

  private _handleEvent(event: MidiEvent): void {
    if (event instanceof NoteEvent) {
      const track = this._currentSong!.tracks[event.trackIndex];
      if (!track) {
        console.warn(`NoteEvent references track index ${event.trackIndex} which does not exist in the current song.`);
        return;
      }

      // only process if the track is not muted (event will still be fired)
      if (track.mixer.effectiveGain > 0) {
        // calculate note parameters
        const start = (event.tick - this._audioClockTickPosition) * this._tickDuration + AUDIO_CLOCK_OFFSET;
        const duration = Math.min(event.duration * this._tickDuration, 5);
        const instrument = this._instruments[track.program === 9 ? 116 : 0];
        const pitch = event.pitch + (track.program === 9 ? 0 : this._playbackTransposition);
        const volume = event.velocity / 127.0 * track.mixer.effectiveGain;

        // check if we've underrun the clock offset
        if (start < 0) {
          console.warn(`Clock offset to small! Event scheduled ${-start}s in the past. This will lead to audible timing glitches!`);
        }

        // queue the midi event
        this._player.queueWaveTable(
          this._audioContext,
          this._masterInput,
          window[instrument],
          this._updater.now() + start,
          pitch,
          duration,
          volume,
          [],
        );
      }

      // emit the note event
      this.emit("note", event);
    } else if (event instanceof TempoEvent) {
      if (this._currentTempo !== event.bpm) {
        this._updateCurrentTempo(event.bpm);
        this._updateTickDuration();
      }
    } else if (event instanceof TimeSignatureEvent) {
      if (this._currentTimeSignature !== event.signature) {
        this._updateCurrentTimeSignature(event.signature);
        this._updateTickDuration();
      }
    } else if (event instanceof MeasureEvent) {
      if (this._currentMeasure !== event.measure) {
        this._updateCurrentMeasure(event.measure);

        // Enable barline corssed flag on the first beat. This is used by "out-any-bar" vamps
        if (event.measure[1] == 0) {
          this._barlineCrossedDuringLastStep = true;
        }
      }
    } else {
      console.warn(`Unknown event '${event}'`);
    }
  }

  private _updateAudioMode(): void {
    if (!this._audioPlayer) {
      return;
    }

    // sync the current position to the audio player
    this._updatePosition(this._audioPlayer.position * 1000);

    // lookup current measure from the measure event list (same approach as seek)
    const k = { tick: this._position };
    const measureEvent = this._midi_events.system.measure.search(k as MeasureEvent, {
      direction: "backward",
      inclusive: true,
      extend: true,
    });
    if (measureEvent) {
      this._updateCurrentMeasure(measureEvent.measure);
    }

    // sync track gains (setGain is a no-op when value unchanged)
    const tracks = this._currentSong?.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      this._audioPlayer.setGain(i, tracks[i]!.mixer.effectiveGain);
    }
  }

  private _handleStep(deltaTime: number): void {
    // audio has its separate handler
    if (this._mode === "audio") {
      this._updateAudioMode();
      return;
    }

    // stop when the end is reached
    if (this._position >= this._duration) {
      this.pause();

      // emit segue
      if (this._currentSegue?.enabled) {
        this.emit("segue");
      }

      return;
    }

    // update tick position
    let p0 = this._position;
    this._position += deltaTime / this._tickDuration;
    let p1 = this._position;

    // enter a new vamp
    if (!this._currentVamp) {
      const newVamp = this._getVampAt(p0);
      if (newVamp) {
        this._updateCurrentVamp(newVamp);
      }
    }

    // repeat or exit vamp if we pass its OR the current measures end point
    // (So currently all vamps will be handled as out any bar)
    if (this._currentVamp) {
      const reachedEndOfVamp = p1 > this._currentVamp.end;
      const reachedBarlineWithinVamp = p0 > (this._currentVamp.start + 100) && p1 < this._currentVamp.end && this._barlineCrossedDuringLastStep;
      const reachedMaxIterations = this._currentVamp.iterations > 0 && this._currentVamp.currentIteration >= this._currentVamp.iterations;

      let offset = 0;

      if ((reachedEndOfVamp || reachedBarlineWithinVamp) && (this._currentVamp.manualExit || reachedMaxIterations)) {
        // exit vamp: offset playhead by the difference between current position and vamp length
        // if we are already at the end of the vamp, p1 might be a bit larger than the vamp's end position. In that case
        // we dont want to jump backwards, so we clamp the offset to allow only positive values.
        offset = Math.max(this._currentVamp.end - p1, 0);

        // remove vamp
        this._updateCurrentVamp(undefined);
      } else if (reachedEndOfVamp) {
        // repeat vamp: offset playhead by the negative total vamp length
        offset = -(this._currentVamp.end - this._currentVamp.start);

        // count iterations
        this._updateCurrentVamp({
          ...this._currentVamp,
          currentIteration: this._currentVamp.currentIteration + 1,
        });
      }

      // apply calculated offset to playhead if repeating or exiting the Vamp
      if (offset !== 0) {
        // repeat vamp: offset playhead by the negative total vamp length
        this._position += offset;
        p0 += offset;
        p1 += offset;

        // also adjust the clock reference. We don't need to reset it, because the timeSignature did not change (Resetting would cause audible glitches)
        this._audioClockReference.ticks += offset;
      }
    }

    // fire position update events in regular intervals (but not on every step)
    this._timeSinceLastPositionUpdate += deltaTime;
    if (this._timeSinceLastPositionUpdate >= POSITION_UPDATE_DURATION) {
      this._timeSinceLastPositionUpdate = 0;
      this.emit("positionChanged", this._position);
    }

    // calculate the tick position in audio clock space. This will give much more precise timing, but we need to manually
    // reset the reference point whenever the scaling factor between audio clock and tick position changes (the tick duration)
    const timeSinceReference = this._updater.now() - this._audioClockReference.seconds;
    const ticksSinceReference = timeSinceReference / this._tickDuration;
    this._audioClockTickPosition = this._audioClockReference.ticks + ticksSinceReference;

    // reset barline crossed flag - it will be re-enabled by the MeasureEvent handler
    this._barlineCrossedDuringLastStep = false;

    // handle all events within the current region
    const k0 = { tick: p0 };
    const k1 = { tick: p1 };
    this._midi_events.system.measure.searchRange(k0 as MeasureEvent, k1 as MeasureEvent).forEach(event => this._handleEvent(event));
    this._midi_events.system.tempo.searchRange(k0 as TempoEvent, k1 as TempoEvent).forEach(event => this._handleEvent(event));
    this._midi_events.system.timeSignature.searchRange(k0 as TimeSignatureEvent, k1 as TimeSignatureEvent).forEach(event => this._handleEvent(event));
    this._midi_events.track.forEach(track => track.note
      .searchRange(k0 as NoteEvent, k1 as NoteEvent).forEach(event => this._handleEvent(event)));
  }

  private _setupMasterChain(): void {
    const ctx = this._audioContext;

    // Disconnect the previous chain output from the destination (if reloading)
    this._chainOutput?.disconnect();

    // 1. Master input gain
    const input = ctx.createGain();

    // 2. Compressor (gentle glue: only catches the loudest peaks, preserves transients)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;

    // 3. Three-band EQ (low shelf / mid peak / high shelf, all flat by default)
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

    // Summing output: single node connected to destination so re-loads are clean
    const output = ctx.createGain();

    // Wiring: input -> compressor -> EQ -> output -> destination
    input.connect(compressor);
    compressor.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(output);
    output.connect(ctx.destination);

    this._masterInput = input;
    this._chainOutput = output;
  }

  resumeAudioContext(): void {
    // try to resume the audio context
    if (this._audioContext.state !== "running") {
      this._audioContext.resume().then(() => {});
    }
  }

  play(): void {
    if (this._status !== "ready" || this._playing) {
      return;
    }

    // try to resume the audio context
    this.resumeAudioContext();

    this.emit("positionChanged", this._position);
    this._updatePlaying(true);
    this._resetAudioClockReference();
    this._updater.start();

    if (this._audioPlayer) {
      this._audioPlayer.play();
    }
  }

  pause(): void {
    if (this._status !== "ready" || !this._playing) {
      return;
    }

    if (this._audioPlayer) {
      this._audioPlayer.pause();
    }

    this._updater.stop();
    this.emit("positionChanged", this._position);
    this._updatePlaying(false);
    this._resetAudioClockReference();
  }

  stop(): void {
    this.pause();
    this.seek(0);
    this._resetAudioClockReference();

    // Reset Vamp iterations, if there is a Vamp on the first bar
    if (this._currentVamp) {
      this._updateCurrentVamp({
        ...this._currentVamp,
        currentIteration: 0,
      });
    }
  }

  seek(position: Tick): void {
    if (this._status !== "ready") {
      return;
    }

    // Special handling for audio mode
    if (this._mode === "audio" && this._audioPlayer) {
      const wasPlaying = this._playing;
      this.pause();

      this._audioPlayer.seek(position / 1000);
      this._updatePosition(position);

      const k = { tick: this._position };
      const options: BinarySearchOptions<MidiEvent, MidiEvent> = {
        direction: "backward",
        inclusive: true,
        extend: true,
      };
      const events = [
        this._midi_events.system.measure.search(k as MeasureEvent, options)!,
        this._midi_events.system.tempo.search(k as TempoEvent, options)!,
        this._midi_events.system.timeSignature.search(k as TimeSignatureEvent, options)!,
      ];
      events.forEach(event => this._handleEvent(event));

      if (wasPlaying) {
        this.play();
      }

      return;
    }

    const wasPlaying = this._playing;
    this.pause();

    // set the new position
    this._updatePosition(position);

    // invoke event handler to update the measure and transport settings
    const k = { tick: this._position };
    const options: BinarySearchOptions<MidiEvent, MidiEvent> = {
      direction: "backward",
      inclusive: true,
      extend: true,
    };
    const events = [
      this._midi_events.system.measure.search(k as MeasureEvent, options)!,
      this._midi_events.system.tempo.search(k as TempoEvent, options)!,
      this._midi_events.system.timeSignature.search(k as TimeSignatureEvent, options)!,
    ];
    events.forEach(event => this._handleEvent(event));

    // update the current vamp
    const newVamp = this._getVampAt(this._position);
    if (newVamp?.start !== this._currentVamp?.start) {
      this._updateCurrentVamp(newVamp);
    }

    // reset clock reference
    this._resetAudioClockReference();

    // continue playing if activated
    if (wasPlaying) {
      this.play();
    }
  }

  exitVamp(): void {
    if (this._currentVamp) {
      this._updateCurrentVamp({
        ...this._currentVamp,
        manualExit: true,
      });
    }
  }

  resetVamp(): void {
    if (this._currentVamp) {
      this._updateCurrentVamp({
        ...this._currentVamp,
        manualExit: false,
        currentIteration: 0,
      });
    }
  }

  toggleVamp(): void {
    if (this._currentVamp) {
      if (this._currentVamp.manualExit) {
        // Re-enable the vamp if we are already exiting
        this.resetVamp();
      } else {
        // Start exiting the vamp
        this.exitVamp();
      }
    }
  }

  setSegueEnabled(enabled: boolean): void {
    if (this._currentSegue) {
      this._updateCurrentSegue({
        ...this._currentSegue,
        enabled,
      });
    }
  }

  toggleSegue(): void {
    this.setSegueEnabled(!this._currentSegue?.enabled);
  }

  async load(song: Song): Promise<void> {
    if (this._status !== "idle") {
      this.unload();
    }

    this._updateStatus("loading");

    // select mode
    this._mode = song.playerMode;

    // set the song, resume the audio context, and create the master chain
    this._currentSong = song;
    this.resumeAudioContext();
    this._setupMasterChain();

    switch (this._mode) {
      case "midi":
        await this.loadMidi(song);
        break;
      case "audio":
        await this.loadAudio(song);
        break;
      default:
        break;
    }

    // handle song measure events
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

      // store vamp definition
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

    // store segue info
    this._updateCurrentSegue(song.events.segue ? { enabled: true } : undefined);

    // update status and seek to position 0. This will also intialize the current measure and tick duration
    this._updateStatus("ready");
    this.seek(0);
  }

  private _resetMidiEvents(): void {
    this._midi_events = {
      system: {
        measure: new MidiEventList(),
        tempo: new MidiEventList(),
        timeSignature: new MidiEventList(),
      },
      track: [],
    };
  }

  async loadAudio(song: Song): Promise<void> {
    if (song.audioFiles.length === 0) {
      throw new Error(`No audio files in song '${song.title}'`);
    }

    // Create the warp map
    this._warpMap.setMarkers(song.warpMarkers ?? []);

    // Load all audio files in parallel
    const audioBuffers = await Promise.all(
      song.audioFiles.map(async (file) => {
        const res = await axios.get(resolveUrl(file, "songs", song.id), {
          validateStatus: status => status === 200,
          responseType: "arraybuffer",
        });
        return this._audioContext.decodeAudioData(res.data);
      }),
    );

    // Order audio buffers by tracks
    this._audioBuffers = song.tracks.map((track) => {
      const bufferIndex = song.audioFiles.findIndex(file => file === track.audioFile);
      const buffer = audioBuffers[bufferIndex];

      if (!buffer) {
        throw new Error(`Audio file '${track.audioFile}' for track '${track.title}' not found in song '${song.title}'`);
      }

      return buffer;
    });

    this._resetMidiEvents();

    // Populate $beatTicks for each measure (1 tick = 1 ms) and build measure events
    const measures = song.measures.items();
    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i]!;
      const startMs = this._warpMap.measureToTime(i) * 1000;
      const endMs = this._warpMap.measureToTime(i + 1) * 1000;
      const beatDurationMs = (endMs - startMs) / measure.beats;

      measure.$beatTicks = Array.from({ length: measure.beats }, (_, b) => startMs + b * beatDurationMs);
      measure.$tickLength = endMs - startMs;

      this._midi_events.system.measure.insert(new MeasureEvent(startMs, measure.reference(0)));
    }

    // Single default tempo event: 125 BPM → 125/60 × 480 ppqn = 1000 ticks/s = 1 tick/ms
    this._midi_events.system.tempo.insert(new TempoEvent(0, 125));
    // Single default time signature event
    this._midi_events.system.timeSignature.insert(new TimeSignatureEvent(0, [4, 2]));

    // Duration from shortest audio buffer (in ms)
    const audioDuration = Math.min(...this._audioBuffers.map(b => b.duration)) * 1000;
    this._updateDuration(audioDuration);

    // Final measure: last measure whose start tick falls within the audio duration
    const finalMeasure = [...measures].reverse().find(m => (m.$beatTicks[0] ?? Infinity) <= audioDuration) ?? measures[0]!;
    this._updateFinalMeasure(finalMeasure.reference(0));

    // Create the audio player
    this._audioPlayer = new AudioPlayer(this._audioContext, this._audioBuffers);
    this._audioPlayer.connect(this._masterInput!);
  }

  async loadMidi(song: Song): Promise<void> {
    // download the midi and metadata files
    if (!song.midiFile) {
      throw new Error(`Midi file missing from song '${song.title}'`);
    }

    if (!song.jsonFile) {
      throw new Error(`Json file missing from song '${song.title}'`);
    }

    const [midiRes, jsonRes] = await Promise.all([
      axios.get(resolveUrl(song.midiFile, "songs", song.id), {
        validateStatus: status => status === 200,
        responseType: "arraybuffer",
      }),
      axios.get(resolveUrl(song.jsonFile, "songs", song.id), {
        validateStatus: status => status === 200,
        responseType: "json",
      }),
    ]);

    this._resetMidiEvents();

    // TODO: calling BinarySortedList.insert is very inefficient here.
    // Generate a normal array and pass it to the constructor to sort it in one go instead.

    // parse the system events
    let prevMeasure: Measure | undefined = undefined;

    const midiJson: MTIMidiJson = jsonRes.data;
    for (const event of midiJson.score.events) {
      const { type, tickcount, value } = event;

      switch (type) {
        case "BEAT":
          this._midi_events.system.measure.insert(new MeasureEvent(tickcount, [value.meas, value.beat - 1]));

          // store tick reference in original song measure data
          const songMeasure = song.measures.search({ value: value.meas } as Measure);
          if (songMeasure?.value === value.meas) {
            // store the tick data
            if (songMeasure.$beatTicks.length === 0) {
              // "fill" the array without destroying its reference
              while (songMeasure.$beatTicks.length < songMeasure.beats) {
                songMeasure.$beatTicks.push(tickcount);
              }
            } else {
              // set the beat's tick value
              songMeasure.$beatTicks[value.beat - 1] = tickcount;
            }

            // store the previous measure's tick length
            if (songMeasure !== prevMeasure) {
              if (songMeasure.$beatTicks[0] !== undefined && prevMeasure?.$beatTicks[0] !== undefined) {
                prevMeasure.$tickLength = songMeasure.$beatTicks[0] - prevMeasure.$beatTicks[0];
              }

              prevMeasure = songMeasure;
            }
          } else {
            console.warn(`Midi measure ${value.meas} does not exist in the song data. This will lead to inconsistencies when seeking to that measure.`);
          }

          break;
        case "TEMPO":
          this._midi_events.system.tempo.insert(new TempoEvent(tickcount, value.bpm));
          break;
        case "TIMESIG":
          this._midi_events.system.timeSignature.insert(new TimeSignatureEvent(tickcount, [value.numerator, value.denominator]));
          break;
        default:
          console.warn(`Unknown midi event type '${type}'`);
          break;
      }
    }

    // store system events in original song data
    // Use assign because the object might already contain other metadata (e.g. from Vue's markRaw())
    Object.assign(song.$midiSystemEvents, this._midi_events.system);

    // parse the midi note events for each track
    const midiData = await parseMidiBuffer(midiRes.data);

    for (const [t, track] of song.tracks.entries()) {
      const noteOnIndices = new Int32Array(128).fill(-1);
      let tick = 0;
      this._midi_events.track.push({ note: new MidiEventList<NoteEvent>() });

      // get all events for this track from the midi file (track title may start with a "-" ... this is a bug in the original track naming)
      const trackName = track.title.replace(/^-/, "");
      const midiEvents = midiData.tracks.find(events => events.some(event => event.trackName === trackName));
      if (!midiEvents) {
        throw new Error(`Midi file does not contain a track named '${track.title}' (Song: #${song.number} ${song.title}).`);
      }

      // parse each event
      for (let i = 0; i < midiEvents.length; i++) {
        const midiEvent = midiEvents[i] as any;

        // calculate and store the new position
        tick += midiEvent.delta;

        // store note on position
        if (midiEvent.noteOn) {
          noteOnIndices[midiEvent.noteOn.noteNumber] = i;
          midiEvent.$tick = tick; // also store the absolute position inside the original event
        }

        // store a complete note event when we have received the note off
        if (midiEvent.noteOff) {
          // lookup the note on index that we've store previously to set the duration property
          const noteOnIndex = noteOnIndices[midiEvent.noteOff.noteNumber]!;
          if (noteOnIndex === -1) {
            console.warn("Midi data contains note off without a note on.");
          } else {
            const noteOnEvent = midiEvents[noteOnIndex] as any;

            // store the note event
            this._midi_events.track[t]!.note.insert(new NoteEvent(
              noteOnEvent.$tick,
              tick - noteOnEvent.$tick,
              noteOnEvent.noteOn.noteNumber,
              noteOnEvent.noteOn.velocity,
              t,
            ));

            // clear the note on index
            noteOnIndices[midiEvent.noteOff.noteNumber] = -1;

            // store active track indices for the corresponding measure
            const measure = song.findMeasureByTick(noteOnEvent.$tick);
            if (measure) {
              measure.$activeTrackIndices.add(t);
            } else {
              console.warn(`Could not find measure for tick ${noteOnEvent.$tick}. Measure highlighting might not work as expected.`);
            }
          }
        }
      }

      // store track events in original track data
      Object.assign(track.$midiTrackEvents, this._midi_events.track[t]);
    }

    // store additional song-specific settings
    this._ppqn = midiJson.score.ppqn;

    // find the last measure to compute the duration
    let lastWrittenMeasure: Measure | undefined = undefined;
    let l = song.measures.items().length;
    while (l--) {
      const measure = song.measures.items()[l]!;
      if (measure.layout) {
        lastWrittenMeasure = measure;
        break;
      }
    }

    if (lastWrittenMeasure && lastWrittenMeasure.$beatTicks.length > 0 && lastWrittenMeasure.$tickLength !== undefined) {
      this._updateDuration(lastWrittenMeasure.$beatTicks[0]! + lastWrittenMeasure.$tickLength!);
      this._updateFinalMeasure(lastWrittenMeasure.reference(lastWrittenMeasure.$beatTicks.length - 1));
    } else {
      // fallback: use the last measure event
      const finalMeasureEvent = this._midi_events.system.measure.last();
      this._updateDuration(finalMeasureEvent?.tick ?? 1);
      this._updateFinalMeasure(finalMeasureEvent?.measure ?? ["1", 0]);
    }

    // create a player
    this._player = new window.WebAudioFontPlayer();

    // load soundfonts
    // TODO: point the url to our own server
    for (const track of song.tracks) {
      const nn = this._player.loader.findInstrument(track.program === 9 ? 116 : 0);
      const info = this._player.loader.instrumentInfo(nn);
      this._instruments[track.program === 9 ? 116 : 0] = info.variable;
      this._player.loader.startLoad(this._audioContext, info.url, info.variable);
    }

    // wait until all soundfonts have loaded
    await new Promise(resolve => this._player.loader.waitLoad(resolve));
  }

  unload(): void {
    if (this._status !== "ready") {
      return;
    }

    this.pause();

    this._player = undefined;
    this._audioPlayer = undefined;
    this._mode = "none";

    this._updatePosition(0);
    this._updateDuration(0);
    this._updateStatus("idle");
  }
}
