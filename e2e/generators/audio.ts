import { createMp3Encoder } from "wasm-media-encoders";

import { durationSeconds, eventStartTick, TICKS_PER_UNIT, tickToSeconds, type Timeline } from "./score/timeline";
import type { TrackClassification } from "./score/types";

export const DEFAULT_SAMPLE_RATE = 44100;

const PEAK_LIMIT = 0.9;
const NOTE_GAIN = 0.25;
const ATTACK_SECONDS = 0.02;
const RELEASE_SECONDS = 0.06;
const PIANO_DECAY_SECONDS = 0.6;

/** Planar PCM, one Float32Array per channel. */
export type PcmAudio = {
  sampleRate: number;
  channels: Float32Array[];
};

export type RenderOptions = {
  sampleRate?: number;
  /** Silence before the first bar. Shifts every bar by this amount, which warp markers must reflect. */
  leadingSilenceSeconds?: number;
  trailingSilenceSeconds?: number;
};

function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

function envelope(time: number, noteSeconds: number, classification: TrackClassification): number {
  const attack = Math.min(1, time / ATTACK_SECONDS);
  const release = time > noteSeconds ? Math.max(0, 1 - (time - noteSeconds) / RELEASE_SECONDS) : 1;
  const decay = classification === "Vocal" ? 1 : Math.exp(-time / PIANO_DECAY_SECONDS);
  return attack * release * decay;
}

function oscillator(phase: number, classification: TrackClassification): number {
  if (classification === "Vocal") {
    return Math.sin(phase) + 0.15 * Math.sin(2 * phase);
  }

  return Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
}

function normalize(samples: Float32Array): void {
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak <= PEAK_LIMIT) {
    return;
  }

  const gain = PEAK_LIMIT / peak;
  for (let i = 0; i < samples.length; i++) {
    samples[i]! *= gain;
  }
}

function emptyStem(timeline: Timeline, sampleRate: number, leading: number, trailing: number): Float32Array {
  return new Float32Array(Math.ceil((leading + durationSeconds(timeline) + trailing) * sampleRate));
}

/**
 * Renders one part as a mono stem with simple additive synthesis. Vocal parts use a sustained
 * tone, accompaniment a decaying one, so stems are audibly and spectrally distinct.
 */
export function renderPartStem(timeline: Timeline, partId: string, options: RenderOptions = {}): PcmAudio {
  const { sampleRate = DEFAULT_SAMPLE_RATE, leadingSilenceSeconds = 0, trailingSilenceSeconds = 0.5 } = options;
  const part = timeline.spec.parts.find(p => p.id === partId);
  if (!part) {
    throw new Error(`Score '${timeline.spec.id}' has no part '${partId}'.`);
  }

  const samples = emptyStem(timeline, sampleRate, leadingSilenceSeconds, trailingSilenceSeconds);

  for (const event of timeline.events.filter(e => e.partId === partId && e.pitches.length > 0)) {
    const startTick = eventStartTick(timeline, event);
    const startSeconds = leadingSilenceSeconds + tickToSeconds(timeline, startTick);
    const noteSeconds = tickToSeconds(timeline, startTick + event.durationUnits * TICKS_PER_UNIT) + leadingSilenceSeconds - startSeconds;
    const firstSample = Math.round(startSeconds * sampleRate);
    const sampleCount = Math.min(Math.round((noteSeconds + RELEASE_SECONDS) * sampleRate), samples.length - firstSample);
    const amplitude = (NOTE_GAIN * event.velocity) / 127;

    for (const pitch of event.pitches) {
      const angularStep = (2 * Math.PI * midiToFrequency(pitch)) / sampleRate;
      for (let i = 0; i < sampleCount; i++) {
        const time = i / sampleRate;
        samples[firstSample + i]! += amplitude * envelope(time, noteSeconds, part.classification) * oscillator(angularStep * i, part.classification);
      }
    }
  }

  normalize(samples);
  return { sampleRate, channels: [samples] };
}

export type Mp3Options = {
  /** LAME VBR quality, 0 (best) to 9 (smallest). */
  vbrQuality?: number;
};

export async function encodeMp3(audio: PcmAudio, { vbrQuality = 4 }: Mp3Options = {}): Promise<Uint8Array<ArrayBuffer>> {
  const channelCount = audio.channels.length;
  if (channelCount !== 1 && channelCount !== 2) {
    throw new Error(`MP3 supports one or two channels, got ${channelCount}.`);
  }

  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate: audio.sampleRate, channels: channelCount, vbrQuality });

  // The encoder reuses its output buffer between calls, so each chunk has to be copied.
  const body = encoder.encode(audio.channels).slice();
  const tail = encoder.finalize().slice();

  const result = new Uint8Array(body.length + tail.length);
  result.set(body, 0);
  result.set(tail, body.length);
  return result;
}

/** 16-bit PCM WAV. The backend converts it to MP3 on upload. */
export function encodeWav(audio: PcmAudio): Uint8Array<ArrayBuffer> {
  const channelCount = audio.channels.length;
  const frameCount = audio.channels[0]!.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (const channel of audio.channels) {
      const clamped = Math.max(-1, Math.min(1, channel[frame]!));
      view.setInt16(offset, Math.round(clamped * 0x7fff), true);
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(buffer);
}
