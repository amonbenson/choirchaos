import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeRms } from "@/test/fixtures";

import AudioClock from "../audioClock";
import { type Block, BLOCK_OVERLAP_SECONDS, BLOCK_SECONDS, type BlockSource } from "./blockStore";
import AudioDriver from "./driver";
import { OPUS_SAMPLE_RATE } from "./oggOpus";

const SAMPLE_RATE = OPUS_SAMPLE_RATE;

/** Splits whole recordings into blocks like `BlockStore`; `missing` blocks stay unloaded. */
function makeBlockSource(ctx: BaseAudioContext, recordings: Float32Array[], missing: number[] = []): BlockSource {
  const blockSamples = BLOCK_SECONDS * SAMPLE_RATE;
  const overlap = BLOCK_OVERLAP_SECONDS * SAMPLE_RATE;
  const length = Math.min(...recordings.map(recording => recording.length));
  const count = Math.ceil(length / blockSamples);
  const blocks = recordings.map(recording => Array.from({ length: count }, (_, index): Block | undefined => {
    if (missing.includes(index)) {
      return undefined;
    }

    const samples = recording.slice(index * blockSamples, Math.min(length, (index + 1) * blockSamples + overlap));
    if (samples.every(sample => sample === 0)) {
      return null;
    }

    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }));

  return {
    getTrackCount: () => recordings.length,
    getBlockCount: () => count,
    getBlock: (track, index) => blocks[track]?.[index],
  };
}

function makeSine(seconds: number): Float32Array {
  return Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
}

/** Each sample holds its own time in the recording, so the output tells which time plays when. */
function makeTimed(seconds: number): Float32Array {
  return Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => i / SAMPLE_RATE / 100);
}

function playedAt(output: Float32Array, seconds: number): number {
  return output[Math.round(seconds * SAMPLE_RATE)]! * 100;
}

async function makeOfflinePlayer(seconds: number, recordings: Float32Array[], missing: number[] = []): Promise<{ player: AudioDriver; render: () => Promise<Float32Array> }> {
  const offlineCtx = new OfflineAudioContext(2, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const player = await AudioDriver.create(
    offlineCtx as unknown as AudioContext,
    new AudioClock(offlineCtx),
    makeBlockSource(offlineCtx, recordings, missing),
    { tracks: recordings.map(() => ({})), onAmplitudes: () => {} },
  );
  player.connect(offlineCtx.destination);
  return { player, render: async () => (await offlineCtx.startRendering()).getChannelData(0) };
}

describe("AudioDriver", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  afterEach(async () => {
    await ctx.close();
    vi.clearAllMocks();
  });

  async function makePlayer(recordings: Float32Array[] = [makeSine(1)]): Promise<AudioDriver> {
    return AudioDriver.create(ctx, new AudioClock(ctx), makeBlockSource(ctx, recordings), {
      tracks: recordings.map(() => ({})),
      onAmplitudes: () => {},
    });
  }

  it("getPosition() starts at 0 before play", async () => {
    const player = await makePlayer();
    expect(player.getPosition()).toBe(0);
    player.dispose();
  });

  it("seek updates position when not playing", async () => {
    const player = await makePlayer();
    player.seek(0.5);
    expect(player.getPosition()).toBe(0.5);
    player.dispose();
  });

  it("seek and play resume from the seeked position", async () => {
    const player = await makePlayer();
    player.seek(0.3);
    player.play();
    expect(player.getPosition()).toBeGreaterThanOrEqual(0.3);
    player.pause();
    player.dispose();
  });

  it("pause snapshots the current position", async () => {
    const player = await makePlayer();
    player.seek(0.4);
    player.play();
    player.pause();
    expect(player.getPosition()).toBeCloseTo(0.4, 1);
    player.dispose();
  });

  it("pauses at a given position", async () => {
    const player = await makePlayer();
    player.play();
    player.pause(0.8);
    expect(player.getPosition()).toBe(0.8);
    player.dispose();
  });

  it("setTempo while playing reschedules without throwing", async () => {
    const player = await makePlayer();
    player.play();
    expect(() => player.setTempo(1.5)).not.toThrow();
    expect(() => player.setPitch(2)).not.toThrow();
    player.pause();
    player.dispose();
  });

  it("jump while not playing moves the position", async () => {
    const player = await makePlayer();
    player.jump(0, 0.7);
    expect(player.getPosition()).toBe(0.7);
    player.dispose();
  });

  it("dispose while playing stops without throwing", async () => {
    const player = await makePlayer();
    player.play();
    expect(() => player.dispose()).not.toThrow();
  });

  it("passes a block's signal through to the output", async () => {
    const { player, render } = await makeOfflinePlayer(1, [makeSine(2)]);
    player.play();

    expect(computeRms(await render())).toBeGreaterThan(0.1);
    player.dispose();
  });

  it("muted track produces near-silent output", async () => {
    const { player, render } = await makeOfflinePlayer(1, [makeSine(2)]);
    player.setGain(0, 0);
    player.play();

    expect(computeRms(await render())).toBeLessThan(0.05);
    player.dispose();
  });

  it("plays nothing for a silent block", async () => {
    const recording = makeSine(BLOCK_SECONDS * 2);
    recording.fill(0, 0, BLOCK_SECONDS * SAMPLE_RATE);
    const { player, render } = await makeOfflinePlayer(0.5, [recording]);
    player.seek(BLOCK_SECONDS - 0.25);
    player.play();

    const output = await render();

    expect(computeRms(output.subarray(0, SAMPLE_RATE * 0.2))).toBe(0);
    expect(computeRms(output.subarray(SAMPLE_RATE * 0.3))).toBeGreaterThan(0.1);
    player.dispose();
  });

  it.each([1, 0.85, 1.13])("joins blocks seamlessly at tempo %s", async (tempo) => {
    const { player, render } = await makeOfflinePlayer(0.5, [makeTimed(BLOCK_SECONDS * 2)]);
    player.setTempo(tempo);
    player.seek(BLOCK_SECONDS - 0.2);
    player.play();

    const output = await render();

    // A gap, a doubled overlap or a shifted block would leave the ramp by far more than this.
    const join = Math.round((0.2 / tempo) * SAMPLE_RATE);
    for (let i = join - 480; i < join + 480; i++) {
      const ideal = (BLOCK_SECONDS - 0.2 + (i / SAMPLE_RATE) * tempo) / 100;
      expect(Math.abs(output[i]! - ideal)).toBeLessThan(1e-4);
    }

    player.dispose();
  });

  it("reports where the playing segment reaches a block that is not loaded", async () => {
    const { player } = await makeOfflinePlayer(1, [makeSine(BLOCK_SECONDS * 2)], [1]);
    player.seek(BLOCK_SECONDS - 0.5);
    player.play();
    player.update();

    expect(player.getMissingPosition()).toBe(BLOCK_SECONDS);
    player.pause();
    expect(player.getMissingPosition()).toBeUndefined();
    player.dispose();
  });

  it("reports nothing missing while the missing block is beyond the schedule", async () => {
    const { player } = await makeOfflinePlayer(1, [makeSine(BLOCK_SECONDS * 2)], [1]);
    player.play();
    player.update();

    expect(player.getMissingPosition()).toBeUndefined();
    player.dispose();
  });

  describe("jumps", () => {
    async function makeTimedPlayer(): Promise<{ player: AudioDriver; render: () => Promise<Float32Array> }> {
      const timed = await makeOfflinePlayer(0.5, [makeTimed(2)]);
      timed.player.play();
      return timed;
    }

    it("lands a prepared jump exactly where the recording reaches it", async () => {
      const { player, render } = await makeTimedPlayer();
      player.prepareJump(0.25, 0.6);

      const output = await render();

      expect(playedAt(output, 0.2)).toBeCloseTo(0.2, 2);
      expect(playedAt(output, 0.35)).toBeCloseTo(0.7, 2);
      player.dispose();
    });

    it("keeps the prepared timing when the jump is made", async () => {
      const { player, render } = await makeTimedPlayer();
      player.prepareJump(0.25, 0.6);
      player.jump(0.25, 0.6);

      const output = await render();

      expect(playedAt(output, 0.2)).toBeCloseTo(0.2, 2);
      expect(playedAt(output, 0.35)).toBeCloseTo(0.7, 2);
      expect(player.getPosition()).toBeCloseTo(0.6 + 0.5 - 0.25, 2);
      player.dispose();
    });

    it("plays on when a prepared jump is cancelled", async () => {
      const { player, render } = await makeTimedPlayer();
      player.prepareJump(0.25, 0.6);
      player.cancelJump();

      const output = await render();

      expect(playedAt(output, 0.35)).toBeCloseTo(0.35, 2);
      player.dispose();
    });

    it("replaces a prepared jump whose target changed", async () => {
      const { player, render } = await makeTimedPlayer();
      player.prepareJump(0.25, 0.6);
      player.prepareJump(0.25, 0.8);

      const output = await render();

      expect(playedAt(output, 0.35)).toBeCloseTo(0.9, 2);
      player.dispose();
    });

    it("waits with a jump beyond the lookahead", async () => {
      const { player, render } = await makeTimedPlayer();
      player.prepareJump(0.45, 0.8);

      const output = await render();

      expect(playedAt(output, 0.48)).toBeCloseTo(0.48, 2);
      player.dispose();
    });

    it("jumps into another block", async () => {
      const { player, render } = await makeOfflinePlayer(0.5, [makeTimed(BLOCK_SECONDS * 2)]);
      player.play();
      player.prepareJump(0.25, BLOCK_SECONDS + 1);

      const output = await render();

      expect(playedAt(output, 0.35)).toBeCloseTo(BLOCK_SECONDS + 1.1, 2);
      player.dispose();
    });
  });
});
