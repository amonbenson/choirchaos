import axios from "axios";

import { MidiEventList, type TempoEvent, TimeSignatureEvent } from "../../midi/events";
import type { Tick } from "../../midi/types";
import WarpMap from "../../midi/warp";
import type Song from "../../models/song";
import { resolveUrl } from "../../utils/file";
import type AudioClock from "../audioClock";
import { type BackendCallbacks, type LoadResult, PlayerBackend, type StepResult } from "../backend";
import { buildAudioTempoEvents, resolveAudioTimeline, type TimelinePosition } from "../timeline";
import type { SystemEvents } from "../types";
import { type AudioChunk, detectChunks } from "./chunkDetector";
import AudioDriver from "./driver";

const MAX_CONCURRENT_DECODE_BYTES = 750 * 1024 * 1024;
const DECODED_BYTES_PER_COMPRESSED_BYTE = 128; // Rough estimate for spares MP3s with VBR and stereo channels
const MILLISECONDS_PER_SECOND = 1000;

function medianRatio(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export default class AudioBackend extends PlayerBackend {
  private audioDriver: AudioDriver | undefined = undefined;
  private trackChunks: AudioChunk[][] = [];
  private warpMap = new WarpMap();
  private currentSong: Song | undefined = undefined;
  private currentBpm: number | undefined = undefined;

  constructor(
    context: AudioContext,
    clock: AudioClock,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, clock, masterInput, systemEvents, callbacks);
  }

  getTrackChunks(): AudioChunk[][] {
    return this.trackChunks;
  }

  /** Re-times the timeline after warp marker edits. */
  syncWarp(): TimelinePosition[] {
    return this.buildTimeline();
  }

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
    if (song.audioFiles.length === 0) {
      throw new Error(`No audio files in song '${song.title}'`);
    }

    // Load all MP3s in raw (compressed) form
    const compressedBuffers = await Promise.all(
      song.audioFiles.map(async (file) => {
        const res = await axios.get(resolveUrl(file, "songs", song.id), {
          validateStatus: status => status === 200,
          responseType: "arraybuffer",
          signal,
        });
        return res.data as ArrayBuffer;
      }),
    );

    signal.throwIfAborted();

    // Decode and split each audio file into non-silent chunks.
    // Files are decoded in parallel up to MAX_CONCURRENT_DECODE_BYTES to avoid out-of-memory crashes.
    let bytesInFlight = 0;
    const decodeWaiters: Array<() => void> = [];
    const completedRatios: number[] = [];

    const decodeResults = await Promise.all(
      compressedBuffers.map(async (compressed) => {
        const ratio = completedRatios.length > 0 ? medianRatio(completedRatios) : DECODED_BYTES_PER_COMPRESSED_BYTE;
        const estimate = compressed.byteLength * ratio;
        while (bytesInFlight > 0 && bytesInFlight + estimate > MAX_CONCURRENT_DECODE_BYTES) {
          await new Promise<void>(resolve => decodeWaiters.push(resolve));
          signal.throwIfAborted();
        }

        bytesInFlight += estimate;
        let actualBytes = 0;
        try {
          const decoded = await this.context.decodeAudioData(compressed);
          actualBytes = decoded.numberOfChannels * decoded.length * 4;
          return { duration: decoded.duration, chunks: detectChunks(decoded, this.context) };
        } finally {
          bytesInFlight -= estimate;
          if (actualBytes > 0) {
            completedRatios.push(actualBytes / compressed.byteLength);
          }

          decodeWaiters.splice(0).forEach(r => r());
        }
      }),
    );

    const fileChunks = decodeResults.map(r => r.chunks);
    const fileDurations = decodeResults.map(r => r.duration);

    signal.throwIfAborted();

    // Organize all chunks by track
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
    const timeline = this.buildTimeline();

    // Setup the underlying audio player
    this.audioDriver?.dispose();
    this.audioDriver = await AudioDriver.create(
      this.context,
      this.clock,
      this.trackChunks,
      {
        tracks: song.tracks.map(t => ({
          highPassFilter: t.classification === "Vocal",
          compressor: t.classification === "Vocal",
        })),
        onAmplitudes: (amplitudes: number[]) => this.callbacks.onAmplitudes(amplitudes),
      },
    );

    signal.throwIfAborted();
    this.audioDriver!.connect(this.masterInput);

    return { duration: Math.min(...fileDurations) * MILLISECONDS_PER_SECOND, timeline };
  }

  play(_currentPosition: Tick): void {
    this.audioDriver?.play();
  }

  pause(_currentPosition: Tick): void {
    this.audioDriver?.pause();
  }

  seek(position: Tick): void {
    this.audioDriver?.seek(position / MILLISECONDS_PER_SECOND);
  }

  step(currentPosition: Tick, deltaTime: number, limit?: Tick, muteVocals?: boolean): StepResult {
    const driverPosition = (this.audioDriver?.getPosition() ?? 0) * MILLISECONDS_PER_SECOND;
    const p1 = limit !== undefined ? Math.min(driverPosition, limit) : driverPosition;

    const tracks = this.currentSong?.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      const gain = muteVocals && track.classification === "Vocal" ? 0 : track.mixer.effectiveGain;
      this.audioDriver?.setGain(i, gain);
    }

    this.audioDriver?.setTempo(this.playbackSpeed);
    this.audioDriver?.setPitch(this.playbackTransposition);
    this.syncTempoAt(p1);

    return { p0: currentPosition, p1, deltaTimeConsumed: deltaTime };
  }

  onPositionJump(offset: Tick, newPosition: Tick): void {
    this.audioDriver?.jump((newPosition - offset) / MILLISECONDS_PER_SECOND, newPosition / MILLISECONDS_PER_SECOND);
  }

  override prepareJump(jump: { at: Tick; to: Tick } | undefined): void {
    if (jump) {
      this.audioDriver?.prepareJump(jump.at / MILLISECONDS_PER_SECOND, jump.to / MILLISECONDS_PER_SECOND);
    } else {
      this.audioDriver?.cancelJump();
    }
  }

  onTempoRestored(bpm: number): void {
    this.currentBpm = bpm;
  }

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
  }

  private buildTimeline(): TimelinePosition[] {
    const song = this.currentSong!;
    const timeline = resolveAudioTimeline(song.getTimeline(), song.getMeasures(), song.getSyncPoints(), this.warpMap);

    this.systemEvents.tempo = buildAudioTempoEvents(timeline, this.warpMap.getMarkers());
    this.systemEvents.timeSignature = new MidiEventList([new TimeSignatureEvent(0, [4, 2])]);

    return timeline;
  }

  private syncTempoAt(tick: Tick): void {
    const options = { direction: "backward" as const, inclusive: true, extend: true };
    const event = this.systemEvents.tempo.search({ tick } as TempoEvent, options);
    if (event && event.bpm !== this.currentBpm) {
      this.currentBpm = event.bpm;
      this.callbacks.onTempoChanged(event.bpm);
    }
  }
}
