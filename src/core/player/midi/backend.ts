import axios from "axios";
import { parseArrayBuffer as parseMidiBuffer } from "midi-json-parser";

import { MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "../../midi/events";
import type { MTIMidiJson } from "../../midi/mtiJson";
import type { Tick } from "../../midi/types";
import type Song from "../../models/song";
import { resolveUrl } from "../../utils/file";
import type AudioClock from "../audioClock";
import { type BackendCallbacks, type LoadResult, PlayerBackend, type StepResult } from "../backend";
import { findPositionAt, resolveMidiTimeline, type TimelinePosition } from "../timeline";
import type { SystemEvents, TrackEvents } from "../types";

const AUDIO_CLOCK_OFFSET = 0.1;

declare global {
  interface Window { WebAudioFontPlayer: any }
}

export default class MidiBackend extends PlayerBackend {
  private ppqn = 480;
  private tickDuration = 0;
  private currentBpm = 120;

  private audioClockReference: { seconds: number; ticks: number } = { seconds: 0, ticks: 0 };
  // The audio clock time of the current step and the tick playing then. Notes are queued relative to both.
  private audioClockTime = 0;
  private audioClockTickPosition = 0;
  // Tracks the most recently committed position so resetAudioClockReference
  // always anchors to the correct tick value, even when called mid-step.
  private lastKnownPosition: Tick = 0;

  private player: any = undefined;
  private instruments: { [key: number]: any } = {};
  private noteEvents: TrackEvents[] = [];
  private activeTrackIndices: Set<number>[] = [];
  // Notes just before a step limit. They sound only if the engine continues without a jump there.
  private heldNotes: NoteEvent[] = [];
  private heldLimit: Tick = 0;
  private currentSong: Song | undefined = undefined;

  constructor(
    context: AudioContext,
    clock: AudioClock,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, clock, masterInput, systemEvents, callbacks);
  }

  getPpqn(): number {
    return this.ppqn;
  }

  getNoteEvents(): TrackEvents[] {
    return this.noteEvents;
  }

  /** The indices of the tracks that start a note in each timeline position. */
  getActiveTrackIndices(): readonly ReadonlySet<number>[] {
    return this.activeTrackIndices;
  }

  private resetAudioClockReference(): void {
    // Anchor the audio clock to the last known position so that the next step calculates time from there
    this.audioClockReference = { seconds: this.clock.now(), ticks: this.lastKnownPosition };
  }

  private updateTickDuration(): void {
    this.tickDuration = 1 / (this.currentBpm / 60 * this.ppqn * this.playbackSpeed);
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

    const midiJson: MTIMidiJson = jsonRes.data;
    const timeline = resolveMidiTimeline(song.getTimeline(), midiJson);

    this.systemEvents.tempo = new MidiEventList();
    this.systemEvents.timeSignature = new MidiEventList();
    this.noteEvents = [];
    this.activeTrackIndices = timeline.map(() => new Set<number>());

    for (const event of midiJson.score.events) {
      if (event.type === "TEMPO") {
        this.systemEvents.tempo.insert(new TempoEvent(event.tickcount, event.value.bpm));
      } else if (event.type === "TIMESIG") {
        this.systemEvents.timeSignature.insert(new TimeSignatureEvent(event.tickcount, [event.value.numerator, event.value.denominator]));
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

            this.markTrackActive(timeline, noteOnEvent.$tick, t);
          }
        }
      }

      // Use assign to preserve reactivity
      Object.assign(track.$midiTrackEvents, this.noteEvents[t]);
    }

    this.ppqn = midiJson.score.ppqn;
    this.currentSong = song;

    // Initialize the WebAudioFont player and load the instruments for each track.
    this.player = new window.WebAudioFontPlayer();
    for (const track of song.tracks) {
      const nn = this.player.loader.findInstrument(track.program === 9 ? 116 : 0);
      const info = this.player.loader.instrumentInfo(nn);
      this.instruments[track.program === 9 ? 116 : 0] = info.variable;
      this.player.loader.startLoad(this.context, info.url, info.variable);
    }

    await new Promise(resolve => this.player.loader.waitLoad(resolve));

    return { duration: timeline.at(-1)!.endTick, timeline };
  }

  private markTrackActive(timeline: readonly TimelinePosition[], tick: Tick, trackIndex: number): void {
    const position = findPositionAt(timeline, tick);
    if (position) {
      this.activeTrackIndices[position.position]!.add(trackIndex);
    }
  }

  play(currentPosition: Tick): void {
    // Note: The actual playback happens in step()
    this.heldNotes = [];
    this.lastKnownPosition = currentPosition;
    this.resetAudioClockReference();
  }

  pause(currentPosition: Tick): void {
    this.heldNotes = [];
    this.lastKnownPosition = currentPosition;
    this.resetAudioClockReference();
  }

  seek(position: Tick): void {
    this.heldNotes = [];
    this.lastKnownPosition = position;
    this.resetAudioClockReference();
  }

  step(currentPosition: Tick, deltaTime: number, limit?: Tick, muteVocals = false): StepResult {
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

    // Derive the audio-clock tick position from real elapsed time so scheduling
    // stays accurate even when step() is called at irregular intervals.
    this.audioClockTime = this.clock.now();
    const timeSinceReference = this.audioClockTime - this.audioClockReference.seconds;
    this.audioClockTickPosition = this.audioClockReference.ticks + timeSinceReference / this.tickDuration;
    this.releaseHeldNotes(currentPosition, limit);

    // Dispatch all events within the consumed tick range in chronological order
    const k0 = { tick: p0 };
    const k1 = { tick: p1 };

    this.systemEvents.tempo
      .searchRange(k0 as TempoEvent, k1 as TempoEvent)
      .forEach(e => this.handleTempoEvent(e));
    this.systemEvents.timeSignature
      .searchRange(k0 as TimeSignatureEvent, k1 as TimeSignatureEvent)
      .forEach(e => this.handleTimeSignatureEvent(e));

    this.noteEvents.forEach((trackEvents) => {
      trackEvents.note
        .searchRange(k0 as NoteEvent, k1 as NoteEvent)
        .forEach(e => this.handleNoteEvent(e, limit, muteVocals));
    });

    return { p0, p1, deltaTimeConsumed };
  }

  private handleTempoEvent(event: TempoEvent): void {
    if (this.currentBpm !== event.bpm) {
      this.currentBpm = event.bpm;
      this.updateTickDuration();
      this.callbacks.onTempoChanged(event.bpm);
    }
  }

  private handleTimeSignatureEvent(event: TimeSignatureEvent): void {
    this.resetAudioClockReference();
    this.callbacks.onTimeSignatureChanged(event.signature);
  }

  private handleNoteEvent(event: NoteEvent, limit: Tick | undefined, muteVocals: boolean): void {
    // Notify the engine (always, for visual feedback)
    this.callbacks.onNote(event);

    if (!this.player || !this.currentSong) {
      return;
    }

    const track = this.currentSong.tracks[event.trackIndex];
    if (!track) {
      console.warn(`NoteEvent references track index ${event.trackIndex} which does not exist.`);
      return;
    }

    const muted = muteVocals && track.classification === "Vocal";
    if (track.mixer.effectiveGain <= 0 || muted) {
      return;
    }

    // Notes within AUDIO_CLOCK_OFFSET of the limit are scheduled 100ms in the
    // future. If the engine jumps at the limit, they would bleed into the
    // material after the jump, so they wait for the next step.
    if (limit !== undefined && event.tick > limit - AUDIO_CLOCK_OFFSET / this.tickDuration) {
      this.heldNotes.push(event);
      this.heldLimit = limit;
      return;
    }

    this.queueNote(event);
  }

  private releaseHeldNotes(position: Tick, limit: Tick | undefined): void {
    const isBeforeSameLimit = position < this.heldLimit && limit === this.heldLimit;
    if (!isBeforeSameLimit) {
      this.heldNotes.splice(0).forEach(e => this.queueNote(e));
    }
  }

  private queueNote(event: NoteEvent): void {
    const track = this.currentSong!.tracks[event.trackIndex]!;
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
      this.audioClockTime + start,
      pitch,
      duration,
      volume,
      [],
    );
  }

  onPositionJump(offset: Tick, newPosition: Tick): void {
    // Adjust tick reference only. Keeps already-scheduled notes valid and
    // avoids the audio click that a full reference reset would cause.
    this.audioClockReference.ticks += offset;
    this.lastKnownPosition = newPosition;
    this.heldNotes = [];
  }

  onTempoRestored(bpm: number): void {
    // When the engine changes tempo without calling step() (e.g. during a seek), we still need to resync the audio clock
    this.currentBpm = bpm;
    this.updateTickDuration();
  }

  override onPlaybackSpeedChanged(speed: number): void {
    super.onPlaybackSpeedChanged(speed);
    this.updateTickDuration();
  }

  dispose(): void {
    this.player = undefined;
    this.noteEvents = [];
    this.activeTrackIndices = [];
    this.heldNotes = [];
    this.currentSong = undefined;
  }
}
