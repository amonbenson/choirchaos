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
  private _audioDriver: AudioDriver | undefined = undefined;
  private _audioBuffers: AudioBuffer[] = [];
  private _warpMap = new WarpMap();
  private _currentSong: Song | undefined = undefined;
  private _lastMeasure: MeasureReference | undefined = undefined;

  constructor(
    context: AudioContext,
    masterInput: AudioNode,
    systemEvents: SystemEvents,
    callbacks: BackendCallbacks,
  ) {
    super(context, masterInput, systemEvents, callbacks);
  }

  get ppqn(): number {
    return 480;
  }

  get audioBuffers(): AudioBuffer[] {
    return this._audioBuffers;
  }

  // ── PlayerBackend interface ───────────────────────────────────────────────

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
        return this._context.decodeAudioData(res.data);
      }),
    );

    signal.throwIfAborted();

    this._audioBuffers = song.tracks.map((track) => {
      const bufferIndex = song.audioFiles.findIndex(file => file === track.audioFile);
      const buffer = rawBuffers[bufferIndex];
      if (!buffer) {
        throw new Error(`Audio file '${track.audioFile}' for track '${track.title}' not found in song '${song.title}'`);
      }

      return buffer;
    });

    this._currentSong = song;
    this._buildWarpEvents(song);

    this._audioDriver?.dispose();
    this._audioDriver = await AudioDriver.create(
      this._context,
      this._audioBuffers,
      {
        tracks: song.tracks.map(t => ({
          highPassFilter: t.classification === "Vocal",
          compressor: t.classification === "Vocal",
        })),
        onAmplitudes: amplitudes => this._callbacks.onAmplitudes(amplitudes),
      },
    );

    signal.throwIfAborted();
    this._audioDriver.connect(this._masterInput);

    const audioDuration = Math.min(...this._audioBuffers.map(b => b.duration)) * 1000;
    const measures = song.measures.items();
    const finalMeasure = [...measures].reverse().find(m => (m.$beatTicks[0] ?? Infinity) <= audioDuration) ?? measures[0]!;

    return {
      duration: audioDuration,
      finalMeasure: finalMeasure.reference(0),
    };
  }

  play(_currentPosition: Tick): void {
    this._audioDriver?.play();
  }

  pause(_currentPosition: Tick): void {
    this._audioDriver?.pause();
  }

  seek(position: Tick): void {
    this._audioDriver?.seek(position / 1000);
  }

  step(currentPosition: Tick, delta: number, _limit?: Tick): StepResult {
    const p1 = (this._audioDriver?.position ?? 0) * 1000;

    // Sync per-track gain, tempo and pitch on every step
    const tracks = this._currentSong?.tracks ?? [];
    for (let i = 0; i < tracks.length; i++) {
      this._audioDriver?.setGain(i, tracks[i]!.mixer.effectiveGain);
    }

    this._audioDriver?.setTempo(this._playbackSpeed);
    this._audioDriver?.setPitch(this._playbackTransposition);

    // Backward-search for current measure and fire the callback if it changed
    if (this._systemEvents.measure.items().length > 0) {
      const k = { tick: p1 } as MeasureEvent;
      const measureEvent = this._systemEvents.measure.search(k, {
        direction: "backward",
        inclusive: true,
        extend: true,
      });
      if (measureEvent && (
        measureEvent.measure[0] !== this._lastMeasure?.[0]
        || measureEvent.measure[1] !== this._lastMeasure?.[1]
      )) {
        this._lastMeasure = measureEvent.measure;
        this._callbacks.onMeasureChanged(measureEvent.measure);
      }
    }

    return { p0: currentPosition, p1, barlineCrossed: false, deltaConsumed: delta };
  }

  // Called when a vamp causes a position jump. Seek the audio driver to the
  // new absolute position so it stays in sync. This is the hook that enables
  // future audio-mode vamp support.
  onPositionJump(_offset: Tick, newPosition: Tick): void {
    this._audioDriver?.seek(newPosition / 1000);
  }

  onTempoRestored(_bpm: number): void {
    // Audio mode does not use MIDI tempo for clock purposes.
  }

  override onPlaybackSpeedChanged(speed: number): void {
    this._playbackSpeed = speed;
    this._audioDriver?.setTempo(speed);
  }

  override onPlaybackTranspositionChanged(semitones: number): void {
    this._playbackTransposition = semitones;
    this._audioDriver?.setPitch(semitones);
  }

  // Rebuild warp-derived timing without re-fetching audio. Safe to call while ready.
  override syncWarp(song: Song): void {
    this._currentSong = song;
    this._buildWarpEvents(song);
  }

  dispose(): void {
    this._audioDriver?.dispose();
    this._audioDriver = undefined;
    this._audioBuffers = [];
    this._currentSong = undefined;
    this._lastMeasure = undefined;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _buildWarpEvents(song: Song): void {
    this._warpMap.setMarkers([...song.warpMarkers]);

    // Reset and repopulate the shared system event lists
    this._systemEvents.measure = new MidiEventList();
    this._systemEvents.tempo = new MidiEventList();
    this._systemEvents.timeSignature = new MidiEventList();

    const measures = song.measures.items();
    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i]!;
      const startMs = this._warpMap.measureToTime(i) * 1000;
      const endMs = this._warpMap.measureToTime(i + 1) * 1000;
      const beatDurationMs = (endMs - startMs) / measure.beats;

      measure.$beatTicks = Array.from({ length: measure.beats }, (_, b) => startMs + b * beatDurationMs);
      measure.$tickLength = endMs - startMs;

      this._systemEvents.measure.insert(new MeasureEvent(startMs, measure.reference(0)));
    }

    // Single default tempo event: 125 BPM → 1 tick/ms
    this._systemEvents.tempo.insert(new TempoEvent(0, 125));
    this._systemEvents.timeSignature.insert(new TimeSignatureEvent(0, [4, 2]));

    this._lastMeasure = undefined;
  }
}
