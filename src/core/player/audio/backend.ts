import axios from "axios";

import { MeasureEvent, MidiEventList, TempoEvent, TimeSignatureEvent } from "../../midi/events";
import type { Tick } from "../../midi/types";
import WarpMap from "../../midi/warp";
import type { MeasureReference } from "../../models/measure";
import type Song from "../../models/song";
import { resolveUrl } from "../../utils/file";
import { type BackendCallbacks, type LoadResult, PlayerBackend, type StepResult } from "../backend";
import type { SystemEvents } from "../types";
import { type AudioChunk, detectChunks } from "./chunkDetector";
import ChunkedAudioPlayer from "./chunkedPlayer";

export default class AudioBackend extends PlayerBackend {
  private audioDriver: ChunkedAudioPlayer | undefined = undefined;
  private trackChunks: AudioChunk[][] = [];
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

  getTrackChunks(): AudioChunk[][] {
    return this.trackChunks;
  }

  syncWarp(): void {
    this.buildWarpEvents();
  }

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
    if (song.audioFiles.length === 0) {
      throw new Error(`No audio files in song '${song.title}'`);
    }

    const fileChunks: AudioChunk[][] = [];
    const fileDurations: number[] = [];

    for (const file of song.audioFiles) {
      const res = await axios.get(resolveUrl(file, "songs", song.id), {
        validateStatus: status => status === 200,
        responseType: "arraybuffer",
        signal,
      });
      signal.throwIfAborted();
      const decoded = await this.context.decodeAudioData(res.data);
      fileDurations.push(decoded.duration);
      fileChunks.push(detectChunks(decoded, this.context));
    }

    signal.throwIfAborted();

    this.trackChunks = song.tracks.map((track) => {
      const fileIndex = song.audioFiles.findIndex(file => file === track.audioFile);
      const chunks = fileChunks[fileIndex];
      if (!chunks) {
        throw new Error(
          `Audio file '${track.audioFile}' for track '${track.title}' not found in song '${song.title}'`,
        );
      }

      return chunks;
    });

    this.currentSong = song;
    this.buildWarpEvents();

    this.audioDriver?.dispose();
    this.audioDriver = await ChunkedAudioPlayer.create(
      this.context,
      this.trackChunks,
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

    const audioDuration = Math.min(...fileDurations) * 1000;
    const measures = song.measures.items();
    const finalMeasure
      = [...measures].reverse().find(m => (m.$beatTicks[0] ?? Infinity) <= audioDuration)
        ?? measures[0]!;

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

  step(currentPosition: Tick, deltaTime: number, limit?: Tick, muteVocals?: boolean): StepResult {
    const driverPosition = (this.audioDriver?.getPosition() ?? 0) * 1000;
    const p1 = limit !== undefined ? Math.min(driverPosition, limit) : driverPosition;

    const tracks = this.currentSong?.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      const gain = muteVocals && track.classification === "Vocal" ? 0 : track.mixer.effectiveGain;
      this.audioDriver?.setGain(i, gain);
    }

    this.audioDriver?.setTempo(this.playbackSpeed);
    this.audioDriver?.setPitch(this.playbackTransposition);

    if (this.systemEvents.measure.items().length > 0 && (limit === undefined || driverPosition < limit)) {
      const measureEvent = this.systemEvents.measure.search(
        { tick: driverPosition } as MeasureEvent,
        { direction: "backward", inclusive: true, extend: true },
      );
      if (
        measureEvent
        && (measureEvent.measure[0] !== this.lastMeasure?.[0]
          || measureEvent.measure[1] !== this.lastMeasure?.[1])
      ) {
        this.lastMeasure = measureEvent.measure;
        this.callbacks.onMeasureChanged(measureEvent.measure);
      }
    }

    return { p0: currentPosition, p1, deltaTimeConsumed: deltaTime };
  }

  onPositionJump(_offset: Tick, newPosition: Tick): void {
    this.audioDriver?.scheduleSeek(newPosition / 1000, 0);
  }

  onTempoRestored(_bpm: number): void {}

  override onPlaybackSpeedChanged(speed: number): void {
    super.onPlaybackSpeedChanged(speed);
    this.audioDriver?.setTempo(speed);
  }

  override onPlaybackTranspositionChanged(semitones: number): void {
    super.onPlaybackTranspositionChanged(semitones);
    this.audioDriver?.setPitch(semitones);
  }

  dispose(): void {
    this.audioDriver?.dispose();
    this.audioDriver = undefined;
    this.trackChunks = [];
    this.currentSong = undefined;
    this.lastMeasure = undefined;
  }

  private buildWarpEvents(): void {
    const measures = this.currentSong!.measures.items();

    this.warpMap.setMarkers(
      this.currentSong!.warpMarkers
        .map(m => ({ measure: measures.findIndex(m2 => m2.value === m.measure), time: m.time }))
        .filter(m => m.measure !== -1),
    );

    this.systemEvents.measure = new MidiEventList();
    this.systemEvents.tempo = new MidiEventList();
    this.systemEvents.timeSignature = new MidiEventList();

    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i]!;
      const startMs = this.warpMap.measureToTime(i) * 1000;
      const endMs = this.warpMap.measureToTime(i + 1) * 1000;
      const beatDurationMs = (endMs - startMs) / measure.beats;

      measure.$beatTicks = Array.from({ length: measure.beats }, (_, b) => startMs + b * beatDurationMs);
      measure.$tickLength = endMs - startMs;

      for (let b = 0; b < measure.beats; b++) {
        this.systemEvents.measure.insert(new MeasureEvent(measure.$beatTicks[b]!, measure.reference(b)));
      }
    }

    this.systemEvents.tempo.insert(new TempoEvent(0, 125));
    this.systemEvents.timeSignature.insert(new TimeSignatureEvent(0, [4, 2]));

    this.lastMeasure = undefined;
  }
}
