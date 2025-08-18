import axios from "axios";
import EventEmitter from "events";
import { parseArrayBuffer as parseMidiBuffer } from "midi-json-parser";
import { MeasureEvent, MidiEvent, MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "./midiEvents";
import type { Tick, TimeSignature } from "./midiTypes";
import type { MeasureReference } from "./measure";
import type { MTIMidiJson } from "../scripts/jsonTypes/mti";
import type Song from "./song";
import { resolveUrl } from "../utils/file";
import type { BinarySearchOptions } from "../utils/binarySearch";
import type Measure from "./measure";

const STEP_DURATION = 1 / 50;

declare global {
    interface Window { WebAudioFontPlayer: any; }
}


export type MidiPlayerStatus = "idle" | "loading" | "ready";

export type MidiPlayerVamp = {
  start: Tick,
  end: Tick,
  iterations: number
};

export type MidiPlayerVampState = MidiPlayerVamp & {
  currentIteration: number;
  manualExit: boolean;
}

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
}

export default class MidiPlayer extends EventEmitter {
  private _status: MidiPlayerStatus = "idle";
  private _playing = false;

  private _ppqn = 480;
  private _tickDuration = 0;

  private _position: Tick = 0;
  private _duration: Tick = 0;

  private _currentSong: Song | null = null;
  private _currentMeasure: MeasureReference = ["1", 0];
  private _currentTempo: number = 120;
  private _currentTimeSignature: TimeSignature = [4, 4];
  private _finalMeasure: MeasureReference = ["1", 0];

  private _midi_events: MidiPlayerEvents = {
    system: {
      measure: new MidiEventList(),
      tempo: new MidiEventList(),
      timeSignature: new MidiEventList(),
    },
    track: [],
  };

  private _vamps: MidiPlayerVamp[] = [];
  private _currentVamp?: MidiPlayerVampState;

  private _audioContext = new AudioContext();
  private _player: any = null;
  private _instruments: { [key: number]: any } = {};
  private _masterInput: AudioNode | null = null;

  private _stepHandle: NodeJS.Timeout | null = null;
  private _lastStepTime = 0;

  get status() {
    return this._status;
  }

  _updateStatus(value: MidiPlayerStatus) {
    this._status = value;
    this.emit("statusChanged", this._status);
  }

  get playing() {
    return this._playing;
  }

  _updatePlaying(value: boolean) {
    this._playing = value;
    this.emit("playingChanged", this._playing);
  }

  get position() {
    return this._position;
  }

  _updatePosition(value: Tick) {
    // TODO: slow down emit rate while playing
    this._position = Math.max(0, Math.min(this._duration, value));
    this.emit("positionChanged", this._position);
  }

  get duration() {
    return this._duration;
  }

  _updateDuration(value: Tick) {
    this._duration = value;
    this.emit("durationChanged", this._duration);
  }

  get currentMeasure() {
    return this._currentMeasure;
  }

  _updateCurrentMeasure(value: MeasureReference) {
    this._currentMeasure = value;
    this.emit("currentMeasureChanged", this._currentMeasure);
  }

  get currentTempo() {
    return this._currentTempo;
  }

  _updateCurrentTempo(value: number) {
    this._currentTempo = value;
    this.emit("currentTempoChanged", this._currentTempo);
  }

  get currentTimeSignature() {
    return this._currentTimeSignature;
  }

  _updateCurrentTimeSignature(value: TimeSignature) {
    this._currentTimeSignature = value;
    this.emit("currentTimeSignatureChanged", this._currentTimeSignature);
  }

  get finalMeasure() {
    return this._finalMeasure;
  }

  _updateFinalMeasure(value: MeasureReference) {
    this._finalMeasure = value;
    this.emit("finalMeasureChanged", this._finalMeasure);
  }

  get currentVamp() {
    return this._currentVamp;
  }

  _updateCurrentVamp(value: MidiPlayerVampState | undefined) {
    this._currentVamp = value;
    this.emit("currentVampChanged", this._currentVamp);
  }

  get midi_events() {
    return this._midi_events;
  }

  get ppqn() {
    return this._ppqn;
  }

  get currentSong() {
    return this._currentSong;
  }

  _updateTickDuration() {
    const ticksPerSecond = this._currentTempo / 60 * this._ppqn;
    this._tickDuration = 1 / ticksPerSecond;
  }

  _checkEnterVamp(tick: Tick) {
    // check if any vamp should be entered
    let newCurrentVamp = undefined;
    for (const vamp of this._vamps) {
      if (tick >= vamp.start && tick < vamp.end) {
        newCurrentVamp = {
          ...vamp,
          currentIteration: 0,
          manualExit: false,
        };
      }
    }

    // update current vamp
    if (newCurrentVamp?.start !== this._currentVamp?.start) {
      this._updateCurrentVamp(newCurrentVamp);
    }
  }

  _handleEvent(event: MidiEvent) {
    if (event instanceof NoteEvent) {
      const track = this._currentSong!.tracks[event.trackIndex];

      // skip if the track is muted
      if (track.mixer.mute || track.mixer.gain <= 0) {
        return;
      }

      // play the note
      const start = (this._position - event.tick) * this._tickDuration;
      const duration = Math.min(event.duration * this._tickDuration - start, 5);
      const instrument = this._instruments[track.program === 9 ? 116 : 0];
      const pitch = event.pitch;
      const volume = event.velocity / 127.0 * track.mixer.gain;
      this._player.queueWaveTable(this._audioContext, this._masterInput, window[instrument], start, pitch, duration, volume, []);
    } else if (event instanceof TempoEvent) {
      this._updateCurrentTempo(event.bpm);
      this._updateTickDuration();
    } else if (event instanceof TimeSignatureEvent) {
      this._updateCurrentTimeSignature(event.signature);
      this._updateTickDuration();
    } else if (event instanceof MeasureEvent) {
      this._updateCurrentMeasure(event.measure);
    } else {
      console.warn(`Unknown event '${event}'`);
    }
  }

  _handleStep(deltaTime: number) {
    // stop when the end is reached
    if (this._position >= this._duration) {
      this.pause();
      this.emit("endOfSong");
      return;
    }

    // update tick position
    let p0 = this._position;
    this._position += deltaTime / this._tickDuration;
    let p1 = this._position;

    // update the current vamp
    this._checkEnterVamp(p0);

    // repeat or exit vamp if we pass its end point
    if (this._currentVamp && p1 > this._currentVamp.end) {
      const maxIterationsReached = this._currentVamp.iterations > 0 && this._currentVamp.currentIteration >= this._currentVamp.iterations;
      if (this._currentVamp.manualExit || maxIterationsReached) {
        // exit
        this._updateCurrentVamp(undefined);
      } else {
        // repeat
        const vampLength = this._currentVamp.end - this._currentVamp.start;
        this._position -= vampLength;
        p0 -= vampLength;
        p1 -= vampLength;

        this._updateCurrentVamp({
          ...this._currentVamp,
          currentIteration: this._currentVamp.currentIteration + 1,
        });
      }
    }

    // handle all events within the current region
    const k0 = { tick: p0 };
    const k1 = { tick: p1 };
    this._midi_events.system.measure.searchRange(k0 as MeasureEvent, k1 as MeasureEvent).forEach(event => this._handleEvent(event));
    this._midi_events.system.tempo.searchRange(k0 as TempoEvent, k1 as TempoEvent).forEach(event => this._handleEvent(event));
    this._midi_events.system.timeSignature.searchRange(k0 as TimeSignatureEvent, k1 as TimeSignatureEvent).forEach(event => this._handleEvent(event));
    this._midi_events.track.forEach(track => track.note
      .searchRange(k0 as NoteEvent, k1 as NoteEvent).forEach(event => this._handleEvent(event)));
  }

  resume() {
    // try to resume the audio context
    if (this._audioContext.state !== "running") {
      this._audioContext.resume();
    }
  }

  play() {
    if (this._status !== "ready" || this._playing) {
      return;
    }
    this.resume();

    // reset delta time calculation
    this._lastStepTime = this._audioContext.currentTime;

    const stepWrapper = () => {

      // calculate delta time
      const t = this._audioContext.currentTime;
      const deltaTime = t - this._lastStepTime;
      this._lastStepTime = t;

      // invoke step handler
      this._handleStep(deltaTime);
    };

    this._updatePlaying(true);
    this._stepHandle = setInterval(stepWrapper, STEP_DURATION);
    stepWrapper();
  }

  pause() {
    if (this._status !== "ready" || !this._playing) {
      return;
    }

    clearInterval(this._stepHandle!);
    this._updatePlaying(false);
  }

  stop() {
    this.pause();
    this.seek(0);
  }

  seek(position: Tick) {
    if (this._status !== "ready") {
      return;
    }
    const wasPlaying = this._playing;
    this.pause();

    // set the new position
    this._updatePosition(position);

    // invoke event handler to update the measure and transport settings
    const k = { tick: this._position };
    const options: BinarySearchOptions<MidiEvent, MidiEvent> = {
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
    this._checkEnterVamp(this._position);

    // continue playing if activated
    if (wasPlaying) {
      this.play();
    }
  }

  exitVamp() {
    if (this._currentVamp) {
      this._updateCurrentVamp({
        ...this._currentVamp,
        manualExit: true,
      });
    }
  }

  async load(song: Song) {
    if (this._status !== "idle") {
      this.unload();
    }

    this._updateStatus("loading");

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

    this._midi_events = {
      system: {
        measure: new MidiEventList(),
        tempo: new MidiEventList(),
        timeSignature: new MidiEventList(),
      },
      track: [],
    };

    // TODO: calling BinarySortedList.insert is very inefficient here.
    // Generate a normal array and pass it to the constructor to sort it in one go instead.

    // parse the system events
    const midiJson: MTIMidiJson = jsonRes.data;
    for (const event of midiJson.score.events) {
      const { type, tickcount, value } = event;

      switch (type) {
        case "BEAT":
          this._midi_events.system.measure.insert(new MeasureEvent(tickcount, [value.meas, value.beat - 1]));

          // store tick reference in original song measure data
          const songMeasure = song.measures.search({  value: value.meas } as Measure);
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
          const noteOnIndex = noteOnIndices[midiEvent.noteOff.noteNumber];
          if (noteOnIndex === -1) {
            console.warn("Midi data contains note off without a note on.");
          } else {
            const noteOnEvent = midiEvents[noteOnIndex] as any;

            // store the note event
            this._midi_events.track[t].note.insert(new NoteEvent(
              noteOnEvent.$tick,
              tick - noteOnEvent.$tick,
              noteOnEvent.noteOn.noteNumber,
              noteOnEvent.noteOn.velocity,
              t,
            ));

            // clear the note on index
            noteOnIndices[midiEvent.noteOff.noteNumber] = -1;
          }
        }
      }

      // store track events in original track data
      Object.assign(track.$midiTrackEvents, this._midi_events.track[t]);
    }

    // handle song measure events
    this._vamps = [];
    this._currentVamp = undefined;

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

    // store additional song-specific settings
    this._currentSong = song;
    this._ppqn = midiJson.score.ppqn;

    const finalMeasureEvent = this._midi_events.system.measure.last();
    if (finalMeasureEvent) {
      this._updateDuration(finalMeasureEvent.tick ?? 0);
      this._updateFinalMeasure(finalMeasureEvent.measure);
    }

    // resumt the audio context and create a player
    this.resume();
    this._player = new window.WebAudioFontPlayer();

    // setup effects chain
    const equalizer = this._player.createChannel(this._audioContext);
    const reverberator = this._player.createReverberator(this._audioContext);

    this._masterInput = equalizer.input;
    equalizer.output.connect(reverberator.input);
    reverberator.output.connect(this._audioContext.destination);

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

    // update status and seek to position 0. This will also intialize the current measure and tick duration
    this._updateStatus("ready");
    this.seek(0);
  }

  unload() {
    if (this._status !== "ready") {
      return;
    }

    this.pause();

    this._player = null;
    this._updatePosition(0);
    this._updateDuration(0);
    this._updateStatus("idle");
  }
}
