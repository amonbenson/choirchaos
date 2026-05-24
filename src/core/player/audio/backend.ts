import axios from "axios";

import { MeasureEvent, MidiEventList, TempoEvent, TimeSignatureEvent } from "../../midi/events";
import type { Tick } from "../../midi/types";
import WarpMap from "../../midi/warp";
import type { MeasureReference } from "../../models/measure";
import type Song from "../../models/song";
import { resolveUrl } from "../../utils/file";
import { type BackendCallbacks, type LoadResult, PlayerBackend, type StepResult } from "../backend";
import type { SystemEvents } from "../types";
import AudioDriver from "./driver";

export default class AudioBackend extends PlayerBackend {
  private audioDriver: AudioDriver | undefined = undefined;
  private buffers: AudioBuffer[] = [];
  private warpMap = new WarpMap();
  private currentSong: Song | undefined = undefined;
  private lastMeasure: MeasureReference | undefined = undefined;

  constructor(
    context: AudioContext,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, masterInput, systemEvents, callbacks);
  }

  getAudioBuffers(): AudioBuffer[] {
    return this.buffers;
  }

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
    if (song.audioFiles.length === 0) {
      throw new Error(`No audio files in song '${song.title}'`);
    }

    const rawBuffers = await Promise.all(
      song.audioFiles.map(async (file) => {
        const res = await axios.get(resolveUrl(file, "songs", song.id), {
          validateStatus: status => status === 200,
          responseType: "arraybuffer",
          signal,
        });
        return this.context.decodeAudioData(res.data);
      }),
    );

    signal.throwIfAborted();

    this.buffers = song.tracks.map((track) => {
      const bufferIndex = song.audioFiles.findIndex(file => file === track.audioFile);
      const buffer = rawBuffers[bufferIndex];
      if (!buffer) {
        throw new Error(`Audio file '${track.audioFile}' for track '${track.title}' not found in song '${song.title}'`);
      }

      return buffer;
    });

    this.currentSong = song;
    this.buildWarpEvents(song);

    this.audioDriver?.dispose();
    this.audioDriver = await AudioDriver.create(
      this.context,
      this.buffers,
      {
        tracks: song.tracks.map(t => ({
          highPassFilter: t.classification === "Vocal",
          compressor: t.classification === "Vocal",
        })),
        onAmplitudes: amplitudes => this.callbacks.onAmplitudes(amplitudes),
      },
    );

    signal.throwIfAborted();
    this.audioDriver.connect(this.masterInput);

    const audioDuration = Math.min(...this.buffers.map(b => b.duration)) * 1000;
    const measures = song.measures.items();
    const finalMeasure = [...measures].reverse().find(m => (m.$beatTicks[0] ?? Infinity) <= audioDuration) ?? measures[0]!;

    return {
      duration: audioDuration,
      finalMeasure: finalMeasure.reference(0),
    };
  }

  play(_currentPosition: Tick): void {
    this.audioDriver?.play();
  }

  pause(_currentPosition: Tick): void {
    this.audioDriver?.pause();
  }

  seek(position: Tick): void {
    this.audioDriver?.seek(position / 1000);
  }

  step(currentPosition: Tick, deltaTime: number, _limit?: Tick): StepResult {
    const p1 = (this.audioDriver?.getPosition() ?? 0) * 1000;

    const tracks = this.currentSong?.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      this.audioDriver?.setGain(i, tracks[i]!.mixer.effectiveGain);
    }

    this.audioDriver?.setTempo(this.playbackSpeed);
    this.audioDriver?.setPitch(this.playbackTransposition);

    if (this.systemEvents.measure.items().length > 0) {
      const k = { tick: p1 } as MeasureEvent;
      const measureEvent = this.systemEvents.measure.search(k, {
        direction: "backward",
        inclusive: true,
        extend: true,
      });
      if (measureEvent && (
        measureEvent.measure[0] !== this.lastMeasure?.[0]
        || measureEvent.measure[1] !== this.lastMeasure?.[1]
      )) {
        this.lastMeasure = measureEvent.measure;
        this.callbacks.onMeasureChanged(measureEvent.measure);
      }
    }

    return { p0: currentPosition, p1, deltaTimeConsumed: deltaTime };
  }

  onPositionJump(_offset: Tick, newPosition: Tick): void {
    this.audioDriver?.seek(newPosition / 1000);
  }

  onTempoRestored(_bpm: number): void {}

  override onPlaybackSpeedChanged(speed: number): void {
    this.playbackSpeed = speed;
    this.audioDriver?.setTempo(speed);
  }

  override onPlaybackTranspositionChanged(semitones: number): void {
    this.playbackTransposition = semitones;
    this.audioDriver?.setPitch(semitones);
  }

  override syncWarp(song: Song): void {
    this.currentSong = song;
    this.buildWarpEvents(song);
  }

  dispose(): void {
    this.audioDriver?.dispose();
    this.audioDriver = undefined;
    this.buffers = [];
    this.currentSong = undefined;
    this.lastMeasure = undefined;
  }

  private buildWarpEvents(song: Song): void {
    this.warpMap.setMarkers([...song.warpMarkers]);

    this.systemEvents.measure = new MidiEventList();
    this.systemEvents.tempo = new MidiEventList();
    this.systemEvents.timeSignature = new MidiEventList();

    const measures = song.measures.items();
    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i]!;
      const startMs = this.warpMap.measureToTime(i) * 1000;
      const endMs = this.warpMap.measureToTime(i + 1) * 1000;
      const beatDurationMs = (endMs - startMs) / measure.beats;

      measure.$beatTicks = Array.from({ length: measure.beats }, (_, b) => startMs + b * beatDurationMs);
      measure.$tickLength = endMs - startMs;

      this.systemEvents.measure.insert(new MeasureEvent(startMs, measure.reference(0)));
    }

    // Single default tempo event: 125 BPM → 1 tick/ms
    this.systemEvents.tempo.insert(new TempoEvent(0, 125));
    this.systemEvents.timeSignature.insert(new TimeSignatureEvent(0, [4, 2]));

    this.lastMeasure = undefined;
  }
}
