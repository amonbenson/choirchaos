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
import type { SystemEvents, TrackEvents, VampPhase } from "../types";

const AUDIO_CLOCK_OFFSET = 0.1;

declare global {
  interface Window { WebAudioFontPlayer: any }
}

export default class MidiBackend extends PlayerBackend {
  private ppqn = 480;
  private tickDuration = 0;
  private currentBpm = 120;

  private audioClockReference: { seconds: number; ticks: number } = { seconds: 0, ticks: 0 };
  private audioClockTickPosition = 0;
  // Tracks the most recently committed position so resetAudioClockReference
  // always anchors to the correct tick value, even when called mid-step.
  private lastKnownPosition: Tick = 0;

  private player: any = undefined;
  private instruments: { [key: number]: any } = {};
  private noteEvents: TrackEvents[] = [];
  private currentSong: Song | undefined = undefined;

  constructor(
    context: AudioContext,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, masterInput, systemEvents, callbacks);
  }

  getPpqn(): number {
    return this.ppqn;
  }

  getNoteEvents(): TrackEvents[] {
    return this.noteEvents;
  }

  private resetAudioClockReference(): void {
    // Anchor the audio clock to the last known position so that the next step calculates time from there.
    this.audioClockReference = {
      seconds: this.context.currentTime,
      ticks: this.lastKnownPosition,
    };
  }

  private updateTickDuration(): void {
    // Recalculate tick duration based on current tempo and playback speed.
    const ticksPerSecond = this.currentBpm / 60 * this.ppqn * this.playbackSpeed;
    this.tickDuration = 1 / ticksPerSecond;
    this.resetAudioClockReference();
  }

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
    if (!song.midiFile) {
      throw new Error(`Midi file missing from song '${song.title}'`);
    }

    if (!song.jsonFile) {
      throw new Error(`Json file missing from song '${song.title}'`);
    }

    // Load midi and json in parallel
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

    this.systemEvents.measure = new MidiEventList();
    this.systemEvents.tempo = new MidiEventList();
    this.systemEvents.timeSignature = new MidiEventList();
    this.noteEvents = [];

    // Fill in all system events from the json data
    let prevMeasure: Measure | undefined = undefined;
    const midiJson: MTIMidiJson = jsonRes.data;

    for (const event of midiJson.score.events) {
      const { type, tickcount, value } = event;

      switch (type) {
        case "BEAT": {
          this.systemEvents.measure.insert(new MeasureEvent(tickcount, [value.meas, value.beat - 1]));

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
          this.systemEvents.tempo.insert(new TempoEvent(tickcount, value.bpm));
          break;

        case "TIMESIG":
          this.systemEvents.timeSignature.insert(new TimeSignatureEvent(tickcount, [value.numerator, value.denominator]));
          break;

        default:
          console.warn(`Unknown midi event type '${type}'`);
          break;
      }
    }

    // Use assign to preserve reactivity
    Object.assign(song.$midiSystemEvents, this.systemEvents);

    // Parse the midi buffer and fill in note events for each track
    const midiData = await parseMidiBuffer(midiRes.data);
    signal.throwIfAborted();

    for (const [t, track] of song.tracks.entries()) {
      const noteOnIndices = new Int32Array(128).fill(-1);
      let tick = 0;
      this.noteEvents.push({ note: new MidiEventList<NoteEvent>() });

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
            this.noteEvents[t]!.note.insert(new NoteEvent(
              noteOnEvent.$tick,
              tick - noteOnEvent.$tick,
              noteOnEvent.noteOn.noteNumber,
              noteOnEvent.noteOn.velocity,
              t,
            ));
            noteOnIndices[midiEvent.noteOff.noteNumber] = -1;

            // Mark the measure as active for this track so the UI can highlight it.
            const measure = song.findMeasureByTick(noteOnEvent.$tick);
            if (measure) {
              measure.$activeTrackIndices.add(t);
            } else {
              console.warn(`Could not find measure for tick ${noteOnEvent.$tick}.`);
            }
          }
        }
      }

      // Use assign to preserve reactivity
      Object.assign(track.$midiTrackEvents, this.noteEvents[t]);
    }

    this.ppqn = midiJson.score.ppqn;
    this.currentSong = song;

    // Find the last measure with a valid layout and use it to calculate the final measure and duration, since MIDI files might omit measures after the end of the song.
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

    // If there is a valid last measure with beat ticks, calculate duration and final measure from it. Otherwise, fall back to using the last measure event in the MIDI data, or default to 1 tick and measure 1 if there are no events.
    if (lastWrittenMeasure && lastWrittenMeasure.$beatTicks.length > 0 && lastWrittenMeasure.$tickLength !== undefined) {
      duration = lastWrittenMeasure.$beatTicks[0]! + lastWrittenMeasure.$tickLength;
      finalMeasure = lastWrittenMeasure.reference(lastWrittenMeasure.$beatTicks.length - 1);
    } else {
      const lastMeasureEvent = this.systemEvents.measure.last();
      duration = lastMeasureEvent?.tick ?? 1;
      finalMeasure = lastMeasureEvent?.measure ?? ["1", 0];
    }

    // Initialize the WebAudioFont player and load the instruments for each track.
    this.player = new window.WebAudioFontPlayer();
    for (const track of song.tracks) {
      const nn = this.player.loader.findInstrument(track.program === 9 ? 116 : 0);
      const info = this.player.loader.instrumentInfo(nn);
      this.instruments[track.program === 9 ? 116 : 0] = info.variable;
      this.player.loader.startLoad(this.context, info.url, info.variable);
    }

    await new Promise(resolve => this.player.loader.waitLoad(resolve));

    return { duration, finalMeasure };
  }

  play(currentPosition: Tick): void {
    // Note: The actual playback happens in step()
    this.lastKnownPosition = currentPosition;
    this.resetAudioClockReference();
  }

  pause(currentPosition: Tick): void {
    this.lastKnownPosition = currentPosition;
    this.resetAudioClockReference();
  }

  seek(position: Tick): void {
    this.lastKnownPosition = position;
    this.resetAudioClockReference();
  }

  step(currentPosition: Tick, deltaTime: number, limit?: Tick, _vampPhase?: VampPhase): StepResult {
    const p0 = currentPosition;
    let p1 = p0 + deltaTime / this.tickDuration;

    // Prevent overshooting the limit tick if given
    if (limit !== undefined && p1 > limit) {
      p1 = limit;
    }

    const deltaTimeConsumed = (p1 - p0) * this.tickDuration;

    // Set before event processing so that any resetAudioClockReference call
    // triggered by a TempoEvent or TimeSignatureEvent uses the correct tick.
    this.lastKnownPosition = p1;

    // Calculate the tick position based on the audio clock, to ensure that timing remains accurate even if step() is called with irregular intervals.
    const timeSinceReference = this.context.currentTime - this.audioClockReference.seconds;
    const ticksSinceReference = timeSinceReference / this.tickDuration;
    this.audioClockTickPosition = this.audioClockReference.ticks + ticksSinceReference;

    // Handle all events between p0 and p1, in chronological order
    const k0 = { tick: p0 };
    const k1 = { tick: p1 };

    this.systemEvents.measure
      .searchRange(k0 as MeasureEvent, k1 as MeasureEvent)
      .forEach(e => this.handleMeasureEvent(e));
    this.systemEvents.tempo
      .searchRange(k0 as TempoEvent, k1 as TempoEvent)
      .forEach(e => this.handleTempoEvent(e));
    this.systemEvents.timeSignature
      .searchRange(k0 as TimeSignatureEvent, k1 as TimeSignatureEvent)
      .forEach(e => this.handleTimeSignatureEvent(e));

    this.noteEvents.forEach((trackEvents) => {
      trackEvents.note
        .searchRange(k0 as NoteEvent, k1 as NoteEvent)
        .forEach(e => this.handleNoteEvent(e));
    });

    return { p0, p1, deltaTimeConsumed };
  }

  private handleMeasureEvent(event: MeasureEvent): void {
    // Notify the engine
    this.callbacks.onMeasureChanged(event.measure);
  }

  private handleTempoEvent(event: TempoEvent): void {
    // Update the tick duration and notify the engine
    if (this.currentBpm !== event.bpm) {
      this.currentBpm = event.bpm;
      this.updateTickDuration();
      this.callbacks.onTempoChanged(event.bpm);
    }
  }

  private handleTimeSignatureEvent(event: TimeSignatureEvent): void {
    // Resync and notify the engine
    this.resetAudioClockReference();
    this.callbacks.onTimeSignatureChanged(event.signature);
  }

  private handleNoteEvent(event: NoteEvent): void {
    // Notify the engine
    this.callbacks.onNote(event);

    if (!this.player || !this.currentSong) {
      return;
    }

    const track = this.currentSong.tracks[event.trackIndex];
    if (!track) {
      console.warn(`NoteEvent references track index ${event.trackIndex} which does not exist.`);
      return;
    }

    // Schedule a note if the track is audible
    if (track.mixer.effectiveGain > 0) {
      const start = (event.tick - this.audioClockTickPosition) * this.tickDuration + AUDIO_CLOCK_OFFSET;
      const duration = Math.min(event.duration * this.tickDuration, 5);
      const instrument = this.instruments[track.program === 9 ? 116 : 0];
      const pitch = event.pitch + (track.program === 9 ? 0 : this.playbackTransposition);
      const volume = event.velocity / 127.0 * track.mixer.effectiveGain;

      if (start < 0) {
        console.warn(`Clock offset too small! Event scheduled ${-start}s in the past.`);
      }

      this.player.queueWaveTable(
        this.context,
        this.masterInput,
        window[instrument],
        this.context.currentTime + start,
        pitch,
        duration,
        volume,
        [],
      );
    }
  }

  onPositionJump(offset: Tick, _newPosition: Tick): void {
    // Adjust tick reference only. Keeps already-scheduled notes valid and
    // avoids the audio click that a full reference reset would cause.
    this.audioClockReference.ticks += offset;
  }

  onTempoRestored(bpm: number): void {
    // When the engine changes tempo without calling step() (e.g. during a seek), we still need to resync the audio clock
    this.currentBpm = bpm;
    this.updateTickDuration();
  }

  override onPlaybackSpeedChanged(speed: number): void {
    // Also resync if the playback speed changes
    super.onPlaybackSpeedChanged(speed);
    this.updateTickDuration();
  }

  dispose(): void {
    this.player = undefined;
    this.noteEvents = [];
    this.currentSong = undefined;
  }
}
