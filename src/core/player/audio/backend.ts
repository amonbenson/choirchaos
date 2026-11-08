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
import { parseAudioIndex, SeekIndex } from "./audioIndex";
import BlockStore, { type SecondsRange, type TrackSource } from "./blockStore";
import { sharedCompressedCache } from "./compressedCache";
import AudioDriver from "./driver";
import { OPUS_SAMPLE_RATE } from "./oggOpus";
import { WorkerOpusDecoding } from "./opusDecoding";
import { type RecordingWaveform, WAVEFORM_SAMPLES_PER_PIXEL } from "./waveformData";

const MILLISECONDS_PER_SECOND = 1000;
/** Recording kept loaded ahead of the playhead and after every jump target. */
const PLAY_AHEAD_SECONDS = 10;
const TARGET_AHEAD_SECONDS = 5;
/** Playback waits for this much loaded recording before it resumes. */
const RESUME_AHEAD_SECONDS = 2;
/** Playback stops this close to a missing block rather than run into silence. */
const STARVE_MARGIN_SECONDS = 0.05;

let lastWaveform: { key: string; waveform: Promise<RecordingWaveform> } | undefined;

export default class AudioBackend extends PlayerBackend {
  private audioDriver: AudioDriver | undefined = undefined;
  private blockStore: BlockStore | undefined = undefined;
  private readonly decoding = new WorkerOpusDecoding();
  private readonly cache = sharedCompressedCache;
  private trackSources: TrackSource[] = [];
  private warpMap = new WarpMap();
  private currentSong: Song | undefined = undefined;
  private currentBpm: number | undefined = undefined;
  private playing = false;
  private buffering = false;
  private targets: number[] = [];

  constructor(
    context: AudioContext,
    clock: AudioClock,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, clock, masterInput, systemEvents, callbacks);
  }

  /** Re-times the timeline after warp marker edits. */
  syncWarp(): TimelinePosition[] {
    return this.buildTimeline();
  }

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
    const indexFile = song.getAudioIndexFile();
    if (song.audioFiles.length === 0 || !indexFile) {
      throw new Error(`No streamable audio files in song '${song.title}'`);
    }

    const res = await axios.get(resolveUrl(indexFile, "songs", song.id), { signal });
    const index = parseAudioIndex(res.data);
    signal.throwIfAborted();

    // Like the recordings' common length, whether or not tracks use them yet.
    const samples = Math.min(...song.audioFiles.map((file) => {
      const entry = typeof file === "string" ? index[file] : undefined;
      if (!entry) {
        throw new Error(`Audio file '${file}' has no seek index in song '${song.title}'`);
      }

      return new SeekIndex(entry).getSampleCount();
    }));

    this.trackSources = song.tracks.map((track) => {
      const entry = typeof track.audioFile === "string" ? index[track.audioFile] : undefined;
      if (!entry) {
        throw new Error(`Audio file '${track.audioFile}' for track '${track.title}' not found in song '${song.title}'`);
      }

      return { url: resolveUrl(track.audioFile, "songs", song.id), index: new SeekIndex(entry) };
    });

    const store = new BlockStore(this.context, this.trackSources, this.decoding, this.cache);
    store.onBlockLoaded(() => this.onBlockLoaded());
    store.onBlockFailed(error => console.error("Could not load audio", error));
    this.blockStore = store;

    this.currentSong = song;
    const timeline = this.buildTimeline();

    this.audioDriver?.dispose();
    this.audioDriver = await AudioDriver.create(this.context, this.clock, store, {
      tracks: song.tracks.map(t => ({
        highPassFilter: t.classification === "Vocal",
        compressor: t.classification === "Vocal",
      })),
      onAmplitudes: (amplitudes: number[]) => this.callbacks.onAmplitudes(amplitudes),
    });

    signal.throwIfAborted();
    this.audioDriver.connect(this.masterInput);

    return { duration: (samples / OPUS_SAMPLE_RATE) * MILLISECONDS_PER_SECOND, timeline };
  }

  /**
   * The mixdown of all tracks for the editor's timeline. It downloads and decodes every recording in
   * full, so only the editor asks for it, and the last one is kept.
   */
  loadWaveform(): Promise<RecordingWaveform> | undefined {
    const sources = this.trackSources;
    const store = this.blockStore;
    if (!store || sources.length === 0) {
      return undefined;
    }

    const key = sources.map(source => source.url).join("\n");
    if (lastWaveform?.key !== key) {
      const waveform = this.buildWaveform(sources, store.getSampleCount());
      lastWaveform = { key, waveform };
      waveform.catch(() => {
        if (lastWaveform?.waveform === waveform) {
          lastWaveform = undefined;
        }
      });
    }

    return lastWaveform.waveform;
  }

  play(_currentPosition: Tick): void {
    this.playing = true;
    this.audioDriver?.play();
    this.audioDriver?.update();
  }

  pause(_currentPosition: Tick): void {
    this.playing = false;
    this.setBuffering(false);
    this.audioDriver?.pause();
  }

  seek(position: Tick): void {
    this.audioDriver?.seek(position / MILLISECONDS_PER_SECOND);
    this.updateWanted();
  }

  step(currentPosition: Tick, deltaTime: number, limit?: Tick, muteVocals?: boolean): StepResult {
    this.updateWanted();
    this.audioDriver?.update();
    this.followLoading();

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

  override prefetch(targets: Tick[]): void {
    this.targets = targets.map(target => target / MILLISECONDS_PER_SECOND);
    this.updateWanted();
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
    this.setBuffering(false);
    this.audioDriver?.dispose();
    this.audioDriver = undefined;
    this.blockStore?.dispose();
    this.blockStore = undefined;
    this.decoding.dispose();
    this.trackSources = [];
    this.currentSong = undefined;
  }

  /** Loads what plays next from the playhead and from every jump target the engine announced. */
  private updateWanted(): void {
    const position = this.audioDriver?.getPosition() ?? 0;
    const ranges: SecondsRange[] = [
      { from: position, to: position + PLAY_AHEAD_SECONDS },
      ...this.targets.map(target => ({ from: target, to: target + TARGET_AHEAD_SECONDS })),
    ];
    this.blockStore?.want(ranges);
  }

  /** Waits where the recording is not loaded yet, and resumes once enough of it is. */
  private followLoading(): void {
    const driver = this.audioDriver;
    const store = this.blockStore;
    if (!driver || !store || !this.playing) {
      return;
    }

    if (this.buffering) {
      const position = driver.getPosition();
      if (store.isLoaded({ from: position, to: position + RESUME_AHEAD_SECONDS })) {
        this.setBuffering(false);
        driver.play();
        driver.update();
      }

      return;
    }

    const missing = driver.getMissingPosition();
    if (missing !== undefined && driver.getPosition() >= missing - STARVE_MARGIN_SECONDS) {
      driver.pause(missing);
      this.setBuffering(true);
    }
  }

  private onBlockLoaded(): void {
    if (this.playing && !this.buffering) {
      this.audioDriver?.update();
    }
  }

  private setBuffering(buffering: boolean): void {
    if (this.buffering !== buffering) {
      this.buffering = buffering;
      this.callbacks.onBufferingChanged(buffering);
    }
  }

  private async buildWaveform(sources: TrackSource[], length: number): Promise<RecordingWaveform> {
    const tracks = await Promise.all(sources.map(async ({ url, index }) => {
      const bytes = await this.cache.fetchAll(url);
      return { pages: bytes.subarray(index.getByteRange(0, 0, 0).start), preSkip: index.getPreSkip() };
    }));
    // Its own worker, so a reload of the song, which disposes the backend, does not cut it short.
    const decoding = new WorkerOpusDecoding();
    try {
      const data = await decoding.buildWaveform({ tracks, length, samplesPerPixel: WAVEFORM_SAMPLES_PER_PIXEL });
      return { data, sampleRate: OPUS_SAMPLE_RATE, samplesPerPixel: WAVEFORM_SAMPLES_PER_PIXEL, length };
    } finally {
      decoding.dispose();
    }
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
