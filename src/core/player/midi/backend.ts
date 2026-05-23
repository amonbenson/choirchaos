import axios from "axios";
import { parseArrayBuffer as parseMidiBuffer } from "midi-json-parser";

import { MeasureEvent, MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "../../midi/events";
import type { Tick } from "../../midi/types";
import type Measure from "../../models/measure";
import type { MeasureReference } from "../../models/measure";
import type Song from "../../models/song";
import type { MTIMidiJson } from "../../scripts/jsonTypes/mti";
import { resolveUrl } from "../../utils/file";
import { type BackendCallbacks, type LoadResult, PlayerBackend, type StepResult } from "../backend";
import type { SystemEvents, TrackEvents } from "../types";

const AUDIO_CLOCK_OFFSET = 0.1;

declare global {
  interface Window { WebAudioFontPlayer: any }
}

export default class MidiBackend extends PlayerBackend {
  private _ppqn = 480;
  private _tickDuration = 0;
  private _currentBpm = 120;

  private _audioClockReference: { seconds: number; ticks: number } = { seconds: 0, ticks: 0 };
  private _audioClockTickPosition = 0;
  // Tracks the most recently committed position so _resetAudioClockReference
  // always anchors to the correct tick value, even when called mid-step.
  private _lastKnownPosition: Tick = 0;
  private _barlineCrossedDuringLastStep = false;

  private _player: any = undefined;
  private _instruments: { [key: number]: any } = {};
  private _noteEvents: TrackEvents[] = [];
  private _currentSong: Song | undefined = undefined;

  constructor(
    context: AudioContext,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, masterInput, systemEvents, callbacks);
  }

  get ppqn(): number {
    return this._ppqn;
  }

  get audioBuffers(): AudioBuffer[] {
    return [];
  }

  get noteEvents(): TrackEvents[] {
    return this._noteEvents;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _resetAudioClockReference(): void {
    this._audioClockReference = {
      seconds: this._context.currentTime,
      ticks: this._lastKnownPosition,
    };
  }

  private _updateTickDuration(): void {
    const ticksPerSecond = this._currentBpm / 60 * this._ppqn * this._playbackSpeed;
    this._tickDuration = 1 / ticksPerSecond;
    this._resetAudioClockReference();
  }

  // ── PlayerBackend interface ───────────────────────────────────────────────

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
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
        signal,
      }),
      axios.get(resolveUrl(song.jsonFile, "songs", song.id), {
        validateStatus: status => status === 200,
        responseType: "json",
        signal,
      }),
    ]);

    signal.throwIfAborted();

    // Reset and repopulate the shared system event lists
    this._systemEvents.measure = new MidiEventList();
    this._systemEvents.tempo = new MidiEventList();
    this._systemEvents.timeSignature = new MidiEventList();
    this._noteEvents = [];

    let prevMeasure: Measure | undefined = undefined;
    const midiJson: MTIMidiJson = jsonRes.data;

    for (const event of midiJson.score.events) {
      const { type, tickcount, value } = event;

      switch (type) {
        case "BEAT": {
          this._systemEvents.measure.insert(new MeasureEvent(tickcount, [value.meas, value.beat - 1]));

          const songMeasure = song.measures.search({ value: value.meas } as Measure);
          if (songMeasure?.value === value.meas) {
            if (songMeasure.$beatTicks.length === 0) {
              while (songMeasure.$beatTicks.length < songMeasure.beats) {
                songMeasure.$beatTicks.push(tickcount);
              }
            } else {
              songMeasure.$beatTicks[value.beat - 1] = tickcount;
            }

            if (songMeasure !== prevMeasure) {
              if (songMeasure.$beatTicks[0] !== undefined && prevMeasure?.$beatTicks[0] !== undefined) {
                prevMeasure.$tickLength = songMeasure.$beatTicks[0] - prevMeasure.$beatTicks[0];
              }

              prevMeasure = songMeasure;
            }
          } else {
            console.warn(`Midi measure ${value.meas} does not exist in the song data.`);
          }

          break;
        }

        case "TEMPO":
          this._systemEvents.tempo.insert(new TempoEvent(tickcount, value.bpm));
          break;

        case "TIMESIG":
          this._systemEvents.timeSignature.insert(new TimeSignatureEvent(tickcount, [value.numerator, value.denominator]));
          break;

        default:
          console.warn(`Unknown midi event type '${type}'`);
          break;
      }
    }

    // Mirror system events onto the song model for external readers (router markRaw etc.)
    Object.assign(song.$midiSystemEvents, this._systemEvents);

    const midiData = await parseMidiBuffer(midiRes.data);
    signal.throwIfAborted();

    for (const [t, track] of song.tracks.entries()) {
      const noteOnIndices = new Int32Array(128).fill(-1);
      let tick = 0;
      this._noteEvents.push({ note: new MidiEventList<NoteEvent>() });

      const trackName = track.title.replace(/^-/, "");
      const midiEvents = midiData.tracks.find(events =>
        events.some(e => (e as any).trackName === trackName),
      );
      if (!midiEvents) {
        throw new Error(`Midi file does not contain a track named '${track.title}' (Song: #${song.number} ${song.title}).`);
      }

      for (let i = 0; i < midiEvents.length; i++) {
        const midiEvent = midiEvents[i] as any;
        tick += midiEvent.delta;

        if (midiEvent.noteOn) {
          noteOnIndices[midiEvent.noteOn.noteNumber] = i;
          midiEvent.$tick = tick;
        }

        if (midiEvent.noteOff) {
          const noteOnIndex = noteOnIndices[midiEvent.noteOff.noteNumber]!;
          if (noteOnIndex === -1) {
            console.warn("Midi data contains note off without a note on.");
          } else {
            const noteOnEvent = midiEvents[noteOnIndex] as any;
            this._noteEvents[t]!.note.insert(new NoteEvent(
              noteOnEvent.$tick,
              tick - noteOnEvent.$tick,
              noteOnEvent.noteOn.noteNumber,
              noteOnEvent.noteOn.velocity,
              t,
            ));
            noteOnIndices[midiEvent.noteOff.noteNumber] = -1;

            const measure = song.findMeasureByTick(noteOnEvent.$tick);
            if (measure) {
              measure.$activeTrackIndices.add(t);
            } else {
              console.warn(`Could not find measure for tick ${noteOnEvent.$tick}.`);
            }
          }
        }
      }

      Object.assign(track.$midiTrackEvents, this._noteEvents[t]);
    }

    this._ppqn = midiJson.score.ppqn;
    this._currentSong = song;

    // Compute duration from the last visible (laid-out) measure
    let lastWrittenMeasure: Measure | undefined = undefined;
    let l = song.measures.items().length;
    while (l--) {
      const m = song.measures.items()[l]!;
      if (m.layout) {
        lastWrittenMeasure = m;
        break;
      }
    }

    let duration: Tick;
    let finalMeasure: MeasureReference;

    if (lastWrittenMeasure && lastWrittenMeasure.$beatTicks.length > 0 && lastWrittenMeasure.$tickLength !== undefined) {
      duration = lastWrittenMeasure.$beatTicks[0]! + lastWrittenMeasure.$tickLength;
      finalMeasure = lastWrittenMeasure.reference(lastWrittenMeasure.$beatTicks.length - 1);
    } else {
      const lastMeasureEvent = this._systemEvents.measure.last();
      duration = lastMeasureEvent?.tick ?? 1;
      finalMeasure = lastMeasureEvent?.measure ?? ["1", 0];
    }

    this._player = new window.WebAudioFontPlayer();
    for (const track of song.tracks) {
      const nn = this._player.loader.findInstrument(track.program === 9 ? 116 : 0);
      const info = this._player.loader.instrumentInfo(nn);
      this._instruments[track.program === 9 ? 116 : 0] = info.variable;
      this._player.loader.startLoad(this._context, info.url, info.variable);
    }

    await new Promise(resolve => this._player.loader.waitLoad(resolve));

    return { duration, finalMeasure };
  }

  play(currentPosition: Tick): void {
    this._lastKnownPosition = currentPosition;
    this._resetAudioClockReference();
  }

  pause(currentPosition: Tick): void {
    this._lastKnownPosition = currentPosition;
    this._resetAudioClockReference();
  }

  seek(position: Tick): void {
    this._lastKnownPosition = position;
    this._resetAudioClockReference();
  }

  step(currentPosition: Tick, delta: number, limit?: Tick): StepResult {
    const p0 = currentPosition;
    let p1 = p0 + delta / this._tickDuration;

    // Honour the limit: stop early so notes past the jump point are not scheduled.
    if (limit !== undefined && p1 > limit) {
      p1 = limit;
    }

    const deltaConsumed = (p1 - p0) * this._tickDuration;

    // Set before event processing so that any _resetAudioClockReference call
    // triggered by a TempoEvent or TimeSignatureEvent uses the correct tick.
    this._lastKnownPosition = p1;

    // Re-compute the audio-clock tick position from the reference for accurate
    // note scheduling with sub-step precision.
    const timeSinceReference = this._context.currentTime - this._audioClockReference.seconds;
    const ticksSinceReference = timeSinceReference / this._tickDuration;
    this._audioClockTickPosition = this._audioClockReference.ticks + ticksSinceReference;

    this._barlineCrossedDuringLastStep = false;

    const k0 = { tick: p0 };
    const k1 = { tick: p1 };

    this._systemEvents.measure
      .searchRange(k0 as MeasureEvent, k1 as MeasureEvent)
      .forEach(e => this._handleMeasureEvent(e));
    this._systemEvents.tempo
      .searchRange(k0 as TempoEvent, k1 as TempoEvent)
      .forEach(e => this._handleTempoEvent(e));
    this._systemEvents.timeSignature
      .searchRange(k0 as TimeSignatureEvent, k1 as TimeSignatureEvent)
      .forEach(e => this._handleTimeSignatureEvent(e));

    this._noteEvents.forEach((trackEvents) => {
      trackEvents.note
        .searchRange(k0 as NoteEvent, k1 as NoteEvent)
        .forEach(e => this._handleNoteEvent(e));
    });

    return { p0, p1, barlineCrossed: this._barlineCrossedDuringLastStep, deltaConsumed };
  }

  private _handleMeasureEvent(event: MeasureEvent): void {
    this._callbacks.onMeasureChanged(event.measure);
    if (event.measure[1] === 0) {
      this._barlineCrossedDuringLastStep = true;
    }
  }

  private _handleTempoEvent(event: TempoEvent): void {
    if (this._currentBpm !== event.bpm) {
      this._currentBpm = event.bpm;
      this._updateTickDuration();
      this._callbacks.onTempoChanged(event.bpm);
    }
  }

  private _handleTimeSignatureEvent(event: TimeSignatureEvent): void {
    // Time signature does not affect tick duration but the audio clock should
    // be re-anchored at structural transitions to minimise drift.
    this._resetAudioClockReference();
    this._callbacks.onTimeSignatureChanged(event.signature);
  }

  private _handleNoteEvent(event: NoteEvent): void {
    this._callbacks.onNote(event);

    if (!this._player || !this._currentSong) {
      return;
    }

    const track = this._currentSong.tracks[event.trackIndex];
    if (!track) {
      console.warn(`NoteEvent references track index ${event.trackIndex} which does not exist.`);
      return;
    }

    if (track.mixer.effectiveGain > 0) {
      const start = (event.tick - this._audioClockTickPosition) * this._tickDuration + AUDIO_CLOCK_OFFSET;
      const duration = Math.min(event.duration * this._tickDuration, 5);
      const instrument = this._instruments[track.program === 9 ? 116 : 0];
      const pitch = event.pitch + (track.program === 9 ? 0 : this._playbackTransposition);
      const volume = event.velocity / 127.0 * track.mixer.effectiveGain;

      if (start < 0) {
        console.warn(`Clock offset too small! Event scheduled ${-start}s in the past.`);
      }

      this._player.queueWaveTable(
        this._context,
        this._masterInput,
        window[instrument],
        this._context.currentTime + start,
        pitch,
        duration,
        volume,
        [],
      );
    }
  }

  onPositionJump(offset: Tick, _newPosition: Tick): void {
    // Adjust tick reference only — keeps already-scheduled notes valid and
    // avoids the audio click that a full reference reset would cause.
    this._audioClockReference.ticks += offset;
  }

  onTempoRestored(bpm: number): void {
    this._currentBpm = bpm;
    this._updateTickDuration();
  }

  override onPlaybackSpeedChanged(speed: number): void {
    this._playbackSpeed = speed;
    this._updateTickDuration();
  }

  dispose(): void {
    this._player = undefined;
    this._noteEvents = [];
    this._currentSong = undefined;
  }
}
