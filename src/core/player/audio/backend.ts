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

  syncWarp(): void {
    this.buildWarpEvents();
  }

  async load(song: Song, signal: AbortSignal): Promise<LoadResult> {
    if (song.audioFiles.length === 0) {
      throw new Error(`No audio files in song '${song.title}'`);
    }

    // Load and decode all audio files in parallel
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

    // Match buffers to tracks by audio file reference
    this.buffers = song.tracks.map((track) => {
      const bufferIndex = song.audioFiles.findIndex(file => file === track.audioFile);
      const buffer = rawBuffers[bufferIndex];
      if (!buffer) {
        throw new Error(`Audio file '${track.audioFile}' for track '${track.title}' not found in song '${song.title}'`);
      }

      return buffer;
    });

    // Generate warp map
    this.currentSong = song;
    this.buildWarpEvents();

    // Dispose existing driver (if any) and create a new one with the loaded buffers
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

    // Initialize duration and final measure based on the longest buffer and the warp map
    const audioDuration = Math.min(...this.buffers.map(b => b.duration)) * 1000;
    const measures = song.measures.items();
    const finalMeasure = [...measures].reverse().find(m => (m.$beatTicks[0] ?? Infinity) <= audioDuration) ?? measures[0]!;

    return {
      duration: audioDuration,
      finalMeasure: finalMeasure.reference(0),
    };
  }

  play(_currentPosition: Tick): void {
    // Notify the driver
    this.audioDriver?.play();
  }

  pause(_currentPosition: Tick): void {
    // Notify the driver
    this.audioDriver?.pause();
  }

  seek(position: Tick): void {
    // Notify the driver (one tick = one millisecond in audio mode)
    this.audioDriver?.seek(position / 1000);
  }

  step(currentPosition: Tick, deltaTime: number, limit?: Tick, muteVocals?: boolean): StepResult {
    const rawP1 = (this.audioDriver?.getPosition() ?? 0) * 1000;
    // Clamp to limit so overshoot doesn't shift the vamp jump target.
    const p1 = limit !== undefined ? Math.min(rawP1, limit) : rawP1;

    // Continuously update track gains and tempo/pitch (unchanged values will be ignored by the driver)
    const tracks = this.currentSong?.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      const gain = muteVocals && track.classification === "Vocal"
        ? 0
        : track.mixer.effectiveGain;
      this.audioDriver?.setGain(i, gain);
    }

    this.audioDriver?.setTempo(this.playbackSpeed);
    this.audioDriver?.setPitch(this.playbackTransposition);

    if (this.systemEvents.measure.items().length > 0 && !(limit !== undefined && rawP1 >= limit)) {
      const k = { tick: rawP1 } as MeasureEvent;
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
    // Use lookahead=0 so vamp jumps switch audio immediately (within SEEK_CROSSFADE only),
    // preventing old sources from playing past the vamp boundary.
    this.audioDriver?.scheduleSeek(newPosition / 1000, 0);
  }

  onTempoRestored(_bpm: number): void {}

  override onPlaybackSpeedChanged(speed: number): void {
    // Notify the driver
    super.onPlaybackSpeedChanged(speed);
    this.audioDriver?.setTempo(speed);
  }

  override onPlaybackTranspositionChanged(semitones: number): void {
    // Notify the driver
    super.onPlaybackTranspositionChanged(semitones);
    this.audioDriver?.setPitch(semitones);
  }

  dispose(): void {
    // Dispose the driver and release resources
    this.audioDriver?.dispose();
    this.audioDriver = undefined;
    this.buffers = [];
    this.currentSong = undefined;
    this.lastMeasure = undefined;
  }

  private buildWarpEvents(): void {
    // Build the warp map and generate measure change events based on it
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

    // Single default tempo event: 125 BPM -> 1 tick/ms
    this.systemEvents.tempo.insert(new TempoEvent(0, 125));
    this.systemEvents.timeSignature.insert(new TimeSignatureEvent(0, [4, 2]));

    this.lastMeasure = undefined;
  }
}
