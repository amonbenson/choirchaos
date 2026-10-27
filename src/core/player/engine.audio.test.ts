import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Section } from "@/core/models/sections";
import type Song from "@/core/models/song";
import type { VampOut, VampVocals } from "@/core/player/types";
import {
  idOf,
  locationOf,
  makeAudioSong,
  makeAudioSongWithBakedVamp,
  makeAudioSongWithCut,
  makeAudioSongWithRepeat,
  makeAudioSongWithVamp,
  makeAudioSongWithVampOut,
  makeAudioSongWithVocalVamp,
} from "@/test/fixtures";
import { ManualUpdater } from "@/test/updater";

import AudioDriver from "./audio/driver";
import PlayerEngine from "./engine";

vi.mock("axios");
vi.mock("./audio/driver", () => ({ default: { create: vi.fn() } }));

// The repeat and baked vamp fixtures place 8 and 7 positions 0.25 s apart, so the buffer must last 2 s.
const BUFFER_SECONDS = 2;
const STEP = 0.02;

type MockFn = Mock<(...args: any[]) => any>;

type MockAudioDriver = {
  getPosition: MockFn;
  play: MockFn;
  pause: MockFn;
  seek: MockFn;
  scheduleSeek: MockFn;
  setGain: MockFn;
  setTempo: MockFn;
  setPitch: MockFn;
  connect: MockFn;
  dispose: MockFn;
};

/** A driver mock whose position only moves when the test sets it, and follows crossfade seeks. */
function makeMockAP(): MockAudioDriver {
  const ap: MockAudioDriver = {
    getPosition: vi.fn().mockReturnValue(0),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    scheduleSeek: vi.fn(),
    setGain: vi.fn(),
    setTempo: vi.fn(),
    setPitch: vi.fn(),
    connect: vi.fn(),
    dispose: vi.fn(),
  };
  ap.scheduleSeek.mockImplementation((pos: number) => ap.getPosition.mockReturnValue(pos));
  return ap;
}

function makePlayer(): { player: PlayerEngine; updater: ManualUpdater; ctx: AudioContext } {
  const ctx = new AudioContext();
  let updater!: ManualUpdater;
  const player = new PlayerEngine(ctx, (cb) => {
    updater = new ManualUpdater(cb);
    return updater;
  });
  return { player, updater, ctx };
}

async function loadSong(player: PlayerEngine, ctx: AudioContext, ap: MockAudioDriver, song: Song): Promise<void> {
  const buf = ctx.createBuffer(2, 44100 * BUFFER_SECONDS, 44100);
  vi.spyOn(ctx, "decodeAudioData").mockResolvedValue(buf);
  vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
  vi.mocked(AudioDriver.create).mockResolvedValue(ap as unknown as AudioDriver);
  await player.load(song);

  // The initial seek to 0 would pollute call counts.
  ap.seek.mockClear();
  ap.scheduleSeek.mockClear();
}

describe("PlayerEngine – audio mode", () => {
  let player: PlayerEngine;
  let updater: ManualUpdater;
  let ctx: AudioContext;
  let ap: MockAudioDriver;

  /** Lets the driver report `seconds`, then runs one engine step. */
  function stepAt(seconds: number): void {
    ap.getPosition.mockReturnValue(seconds);
    updater.step(STEP);
  }

  /**
   * Plays to the end like a real driver, which moves on by one step's time from wherever it is, and lists
   * the positions in the order they sound. A jump back within a position starts it again. A vamp is
   * released once it reaches `releaseAtPass`.
   */
  function playThrough(releaseAtPass = 1): number[] {
    let previous = player.getCurrentLocation()!;
    const positions = [previous.position];
    player.onCurrentLocationChange((location) => {
      if (location && (location.position !== previous.position || location.beat < previous.beat)) {
        positions.push(location.position);
      }

      previous = location ?? previous;
    });

    player.play();
    for (let i = 0; i < 1000 && player.isPlaying(); i++) {
      if ((player.getCurrentSection()?.pass ?? 0) >= releaseAtPass) {
        player.releaseVamp();
      }

      stepAt(ap.getPosition() + STEP);
    }

    return positions;
  }

  async function reload(song: Song): Promise<void> {
    await loadSong(player, ctx, ap, song);
  }

  beforeEach(async () => {
    ({ player, updater, ctx } = makePlayer());
    ap = makeMockAP();
    await reload(makeAudioSong());
  });

  afterEach(async () => {
    player.unload();
    await ctx.close();
    vi.clearAllMocks();
  });

  // ── status lifecycle ──────────────────────────────────────────────────────

  it("reaches ready status after load in audio mode", () => {
    expect(player.getStatus()).toBe("ready");
    expect(player.getMode()).toBe("audio");
  });

  // ── timeline ──────────────────────────────────────────────────────────────

  it("times positions with the default warp spacing without markers", () => {
    expect(player.getTimeline().map(p => p.beatTicks[0])).toEqual([0, 2000, 4000, 6000]);
    expect(player.getFinalLocation()).toMatchObject({ position: 0, beat: 3 });
  });

  it("times baked passes through warp markers on later occurrences", async () => {
    const song = makeAudioSongWithBakedVamp();
    await reload(song);

    expect(player.getTimeline().map(p => p.beatTicks[0])).toEqual([0, 250, 500, 750, 1000, 1250, 1500]);
    expect(player.getLocationTick(locationOf(song, "2", 1, 3))).toBe(750 + 62.5);
    expect(player.getFinalLocation()).toEqual({ position: 6, measure: idOf(song, "4"), occurrence: 1, beat: 3 });
  });

  // ── position tracking ─────────────────────────────────────────────────────

  it("syncs position from audioPlayer.position (seconds → ticks/ms)", () => {
    player.play();
    stepAt(0.5);

    expect(player.getPosition()).toBeCloseTo(500, 0);
  });

  it("advances position as audioPlayer reports later positions", () => {
    player.play();

    stepAt(0.1);
    const p1 = player.getPosition();
    stepAt(0.3);

    expect(player.getPosition()).toBeGreaterThan(p1);
  });

  it("updates the current location while playing", async () => {
    const song = makeAudioSongWithVamp();
    await reload(song);
    player.play();
    stepAt(0.4);

    expect(player.getCurrentLocation()).toEqual({ position: 1, measure: idOf(song, "2"), occurrence: 1, beat: 2 });
  });

  // ── seek ──────────────────────────────────────────────────────────────────

  it("seek delegates to audioPlayer.seek in seconds", () => {
    player.seek(500);
    expect(ap.seek).toHaveBeenCalledWith(0.5);
  });

  // ── gain sync ─────────────────────────────────────────────────────────────

  it("propagates track gain changes to audioPlayer.setGain each step", () => {
    player.getCurrentSong()!.setTrackGain(0, 0.5);
    player.play();
    stepAt(0);

    expect(ap.setGain).toHaveBeenCalledWith(0, 0.5);
  });

  // ── end of song ───────────────────────────────────────────────────────────

  it("pauses when audioPlayer position reaches or exceeds duration", () => {
    player.play();
    stepAt(BUFFER_SECONDS + 0.1);

    expect(player.isPlaying()).toBe(false);
  });

  it("calls audioPlayer.play and pause", () => {
    player.play();
    expect(ap.play).toHaveBeenCalledOnce();

    player.pause();
    expect(ap.pause).toHaveBeenCalledOnce();
  });

  it("emits segue when end is reached with segue enabled", async () => {
    const song = makeAudioSong();
    vi.spyOn(song, "hasSegue").mockReturnValue(true);
    await reload(song);

    const segueEmitted = vi.fn();
    player.onSegue(segueEmitted);

    player.play();
    stepAt(BUFFER_SECONDS + 0.1);

    expect(segueEmitted).toHaveBeenCalledOnce();
  });

  // ── vamp recorded once ────────────────────────────────────────────────────
  // Vamp on measure "2" from 250 ms to 500 ms.

  describe("vamp recorded once", () => {
    beforeEach(async () => {
      await reload(makeAudioSongWithVamp());
      player.play();
    });

    it("crossfades back to the vamp start at its end", () => {
      stepAt(0.3);
      stepAt(0.5);

      expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);
      expect(ap.seek).not.toHaveBeenCalled();
      expect(player.getPosition()).toBe(250);
      expect(player.getCurrentSection()).toMatchObject({ pass: 2, passes: undefined });
    });

    it("jumps to the exact vamp start even when the driver overshoots the end", () => {
      stepAt(0.3);
      stepAt(0.51);

      expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);
    });

    it("leaves without a jump at the end of a released pass", () => {
      stepAt(0.3);
      stepAt(0.5);
      player.releaseVamp();
      ap.scheduleSeek.mockClear();
      stepAt(0.5);

      expect(ap.scheduleSeek).not.toHaveBeenCalled();
      expect(player.getCurrentSection()).toBeUndefined();
    });

    it("plays the vamp until released", () => {
      player.pause();
      player.seek(0);
      expect(playThrough(3)).toEqual([0, 1, 1, 1, 2, 3]);
    });
  });

  // ── baked passes ──────────────────────────────────────────────────────────

  describe("baked vamp", () => {
    // Measure "2" is recorded four times: positions 1 to 4, from 250 ms to 1250 ms.

    it("plays the passes in recorded order with the filler pass repeated until released", async () => {
      await reload(makeAudioSongWithBakedVamp());
      expect(playThrough(5)).toEqual([0, 1, 2, 3, 3, 3, 4, 5, 6]);
    });

    it("finishes the pass and then crossfades to the last recorded pass after a release", async () => {
      await reload(makeAudioSongWithBakedVamp());
      player.play();
      stepAt(0.3);
      player.releaseVamp();
      stepAt(0.5);

      // The first recorded pass is one measure, so its only barline lies before the release.
      expect(ap.scheduleSeek).toHaveBeenCalledWith(1.0, 0);
      expect(player.getCurrentSection()).toEqual({ section: 0, kind: "vamp", pass: 1, passes: 1, recordedPasses: 4, released: true });
    });
  });

  describe("repeat", () => {
    // Measures "2" and "3" are recorded three times: positions 1 to 6, from 250 ms to 1750 ms.

    it("plays every recorded pass when the passes match", async () => {
      await reload(makeAudioSongWithRepeat(3));
      expect(playThrough()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("skips to the last recorded pass for fewer passes", async () => {
      await reload(makeAudioSongWithRepeat(2));
      expect(playThrough()).toEqual([0, 1, 2, 5, 6, 7]);
    });
  });

  it("skips a cut", async () => {
    await reload(makeAudioSongWithCut());
    expect(playThrough()).toEqual([0, 3]);
  });

  // ── syncWarp ──────────────────────────────────────────────────────────────

  it("syncWarp re-times the timeline without seeking", async () => {
    const song = makeAudioSongWithVamp();
    await reload(song);
    player.seek(300);
    ap.seek.mockClear();

    vi.spyOn(song, "getWarpMarkers").mockReturnValue([{ measure: idOf(song, "1"), occurrence: 1, time: 0 }, { measure: idOf(song, "3"), occurrence: 1, time: 1 }]);
    player.syncWarp();

    expect(player.getTimeline()[1]!.beatTicks[0]).toBe(500);
    expect(player.getPosition()).toBe(300);
    expect(player.getCurrentLocation()?.position).toBe(0);
    expect(ap.seek).not.toHaveBeenCalled();
  });

  it("syncWarp re-resolves sections and keeps the pass being played", async () => {
    const song = makeAudioSongWithVamp();
    await reload(song);
    player.play();
    stepAt(0.3);
    stepAt(0.5);
    expect(player.getCurrentSection()?.pass).toBe(2);

    const [section] = song.getSections() as Section[];
    vi.spyOn(song, "getSections").mockReturnValue([{ ...section!, vocals: "split" } as Section]);
    player.syncWarp();

    expect(player.getCurrentSection()).toMatchObject({ kind: "vamp", pass: 2 });
  });

  it("syncWarp drops a removed section", async () => {
    const song = makeAudioSongWithVamp();
    await reload(song);
    player.seek(300);

    vi.spyOn(song, "getSections").mockReturnValue([]);
    player.syncWarp();

    expect(player.getCurrentSection()).toBeUndefined();
  });

  // ── vamp out ──────────────────────────────────────────────────────────────
  // Vamp on measures "2" and "3" (250 ms to 750 ms) until released. The barline inside is at 500 ms,
  // and beats are 62.5 ms apart.

  async function enterVampOut(out: VampOut): Promise<void> {
    await reload(makeAudioSongWithVampOut(out));
    player.play();
    stepAt(0.3);
    player.releaseVamp();
    ap.scheduleSeek.mockClear();
  }

  it("onEnd: a released vamp plays through the barline and leaves at its end", async () => {
    await enterVampOut("onEnd");

    stepAt(0.5);
    expect(ap.scheduleSeek).not.toHaveBeenCalled();
    expect(player.getCurrentSection()).toBeDefined();

    stepAt(0.75);
    expect(ap.scheduleSeek).not.toHaveBeenCalled();
    expect(player.getCurrentSection()).toBeUndefined();
  });

  it("anyBar: a released vamp jumps to its end at the next barline", async () => {
    await enterVampOut("anyBar");

    stepAt(0.52);
    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.75, 0);
    expect(player.getCurrentSection()).toBeUndefined();
  });

  it("anyBeat: a released vamp jumps to its end at the next beat", async () => {
    await enterVampOut("anyBeat");

    stepAt(0.32);
    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.75, 0);
    expect(player.getCurrentSection()).toBeUndefined();
  });

  it("keeps looping an unreleased vamp", async () => {
    await reload(makeAudioSongWithVampOut("anyBeat"));
    player.play();
    stepAt(0.3);
    stepAt(0.75);

    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);
    expect(player.getCurrentSection()).toMatchObject({ pass: 2, passes: undefined, released: false });
  });

  it("resetVamp takes back a release", async () => {
    await enterVampOut("onEnd");
    player.resetVamp();
    stepAt(0.75);

    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);
  });

  // ── vamp vocals ───────────────────────────────────────────────────────────
  // Accompaniment is track 0 and Vocals track 1. The vamp on measure "2" (250 ms to 500 ms) is recorded
  // once, so its midpoint at 375 ms splits entering from exiting material. Where
  // muting changes at the midpoint, the engine stops a step there, so crossing it takes an extra step.

  async function stepVocalVamp(vocals: VampVocals, seconds: number[], release = false): Promise<void> {
    await reload(makeAudioSongWithVocalVamp(vocals));
    player.play();
    for (const s of seconds) {
      stepAt(s);
    }

    if (release) {
      player.releaseVamp();
    }

    const last = seconds.at(-1)!;
    ap.setGain.mockClear();
    stepAt(last);
  }

  it.each([
    { vocals: "split" as const, name: "entering material of the first pass", seconds: [0.3], release: false, muted: false },
    { vocals: "split" as const, name: "exiting material of a pass that is not the last", seconds: [0.4], release: false, muted: true },
    { vocals: "split" as const, name: "exiting material after a release", seconds: [0.4], release: true, muted: false },
    { vocals: "split" as const, name: "entering material of the second pass", seconds: [0.3, 0.4, 0.5, 0.3], release: false, muted: true },
    { vocals: "split" as const, name: "exiting material of the second pass after a release", seconds: [0.3, 0.4, 0.5, 0.4], release: true, muted: false },
    { vocals: "all" as const, name: "exiting material of a pass that is not the last", seconds: [0.4], release: false, muted: false },
    { vocals: "first" as const, name: "entering material of the first pass", seconds: [0.3], release: false, muted: false },
    { vocals: "first" as const, name: "exiting material after a release", seconds: [0.4], release: true, muted: true },
    { vocals: "last" as const, name: "entering material of the first pass", seconds: [0.3], release: false, muted: true },
    { vocals: "last" as const, name: "exiting material of the second pass after a release", seconds: [0.3, 0.4, 0.5, 0.4], release: true, muted: false },
  ])("vocals=$vocals: $name is muted: $muted", async ({ vocals, seconds, release, muted }) => {
    await stepVocalVamp(vocals, seconds, release);

    expect(ap.setGain).toHaveBeenCalledWith(0, 1);
    if (muted) {
      expect(ap.setGain).toHaveBeenCalledWith(1, 0);
    } else {
      expect(ap.setGain).not.toHaveBeenCalledWith(1, 0);
    }
  });
});
