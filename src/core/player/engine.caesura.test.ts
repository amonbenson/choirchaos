import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEAT_MAP_LABELS, type LabelSection, makeMidiBuffer, makeMidiSongWithSections, makeMtiJson, positionTick } from "@/test/fixtures";
import { ManualUpdater, stepUntil } from "@/test/updater";

import PlayerEngine from "./engine";

vi.mock("axios");

type Layout = keyof typeof BEAT_MAP_LABELS;

/** Where playback stopped at a caesura, as "position:beat". */
type Stop = `${number}:${number}`;

/** Releasing a vamp in its second pass, so every vamp is gone round once. */
const RELEASE_PASS = 2;

const MAX_RESUMES = 20;

function caesura(label: string, beat = 0, occurrence = 1): LabelSection {
  return { kind: "caesura", at: [label, beat], occurrence };
}

describe("PlayerEngine – caesuras", () => {
  let player: PlayerEngine;
  let updater: ManualUpdater;
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
    player = new PlayerEngine(ctx, (callback) => {
      updater = new ManualUpdater(callback);
      return updater;
    });
  });

  afterEach(async () => {
    player.unload();
    await ctx.close();
    vi.clearAllMocks();
  });

  async function load(layout: Layout, sections: LabelSection[]): Promise<void> {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: makeMidiBuffer() })
      .mockResolvedValueOnce({ data: makeMtiJson(BEAT_MAP_LABELS[layout]) });
    await player.load(makeMidiSongWithSections(layout, sections));
  }

  function isVampToRelease(): boolean {
    const section = player.getCurrentSection();
    return section?.kind === "vamp" && !section.released && section.pass >= RELEASE_PASS;
  }

  /** Plays from the start to the end, releasing vamps in their second pass and continuing after every stop. */
  function playThrough(): Stop[] {
    const stops: Stop[] = [];
    player.play();
    for (let i = 0; i < MAX_RESUMES && player.isPlaying(); i++) {
      stepUntil(updater, () => !player.isPlaying() || isVampToRelease());
      if (isVampToRelease()) {
        player.releaseVamp();
        continue;
      }

      if (!player.isWaitingAtCaesura()) {
        break;
      }

      const location = player.getCurrentLocation()!;
      stops.push(`${location.position}:${location.beat}`);
      player.play();
    }

    return stops;
  }

  describe("without sections", () => {
    it("stops before the beat of each caesura and plays on to the end", async () => {
      await load("plain", [caesura("2"), caesura("3", 2)]);

      expect(playThrough()).toEqual(["2:0", "3:2"]);
      expect(player.getPosition()).toBe(player.getDuration());
    });

    it("stops exactly at the caesura and waits until played again", async () => {
      await load("plain", [caesura("3")]);
      player.play();
      stepUntil(updater, () => !player.isPlaying());

      expect(player.getPosition()).toBe(positionTick(3));
      expect(player.isWaitingAtCaesura()).toBe(true);

      player.play();
      expect(player.isWaitingAtCaesura()).toBe(false);
      updater.step(0.1);
      expect(player.getPosition()).toBeGreaterThan(positionTick(3));
    });

    it("plays no note of the beat after the caesura before it continues", async () => {
      await load("plain", [caesura("2")]);
      const notes: number[] = [];
      player.onNote(note => notes.push(note.tick));
      player.play();
      stepUntil(updater, () => !player.isPlaying());

      expect(notes).toEqual([480]);

      player.play();
      updater.step(0.1);
      expect(notes).toEqual([480, 2400]);
    });

    it("stops no longer after a seek, and not when played from the caesura itself", async () => {
      await load("plain", [caesura("3")]);
      player.play();
      stepUntil(updater, () => !player.isPlaying());

      player.seek(positionTick(1));
      expect(player.isWaitingAtCaesura()).toBe(false);

      player.seek(positionTick(3));
      expect(playThrough()).toEqual([]);
    });

    it("plays through caesuras while they are disabled", async () => {
      player.setCaesurasEnabled(false);
      await load("plain", [caesura("2")]);

      expect(playThrough()).toEqual([]);
    });
  });

  describe("with a repeat going round", () => {
    const repeat: LabelSection = { kind: "repeat", from: ["2", 0], to: ["2", 3], passes: 3 };

    it("stops before the repeat only when entering it", async () => {
      await load("plain", [repeat, caesura("2")]);

      expect(playThrough()).toEqual(["2:0"]);
    });

    it("stops after the repeat only once it leaves", async () => {
      await load("plain", [repeat, caesura("3")]);

      expect(playThrough()).toEqual(["3:0"]);
    });

    it("stops inside the repeat in every pass", async () => {
      await load("plain", [repeat, caesura("2", 2)]);

      expect(playThrough()).toEqual(["2:2", "2:2", "2:2"]);
    });
  });

  describe("with a repeat over recorded passes", () => {
    // Positions 2 to 7 play "2 3" three times, the last pass leads on to "4" at position 8.
    const repeat: LabelSection = { kind: "repeat", from: ["2", 0], to: ["3", 3], passes: 5 };

    it("stops before a recorded pass when playing into it, but not when going round to it again", async () => {
      await load("repeat", [repeat, caesura("2", 0, 2)]);

      expect(playThrough()).toEqual(["4:0"]);
    });

    it("stops after the last recorded pass once", async () => {
      await load("repeat", [repeat, caesura("4")]);

      expect(playThrough()).toEqual(["8:0"]);
    });
  });

  describe("with a vamp", () => {
    const vamp: LabelSection = { kind: "vamp", from: ["2", 0], to: ["2", 3] };

    it("stops before the vamp only when entering it", async () => {
      await load("plain", [vamp, caesura("2")]);

      expect(playThrough()).toEqual(["2:0"]);
    });

    it("stops after the vamp only once it is released and left", async () => {
      await load("plain", [vamp, caesura("3")]);

      expect(playThrough()).toEqual(["3:0"]);
    });

    it("stops inside the vamp in every pass", async () => {
      await load("plain", [vamp, caesura("2", 2)]);

      expect(playThrough()).toEqual(["2:2", "2:2"]);
    });

    it("stops after a vamp that leaves early with a jump past its end", async () => {
      // Released in measure "1" of its second pass, the vamp leaves at the next barline and jumps to "3".
      await load("plain", [{ kind: "vamp", from: ["1", 0], to: ["2", 3], out: "anyBar" }, caesura("3")]);

      expect(playThrough()).toEqual(["3:0"]);
    });

    it("stops after a recorded vamp once its last recorded pass leads on", async () => {
      // Positions 2 to 5 play "2" four times, then "3" follows at position 6.
      await load("bakedVamp", [{ kind: "vamp", from: ["2", 0], to: ["2", 3], out: "anyBeat" }, caesura("3")]);

      expect(playThrough()).toEqual(["6:0"]);
    });

    it("stops after a disabled vamp, which plays as recorded", async () => {
      player.setVampsEnabled(false);
      await load("plain", [vamp, caesura("2"), caesura("3")]);

      expect(playThrough()).toEqual(["2:0", "3:0"]);
    });
  });

  describe("with a cut", () => {
    const cut: LabelSection = { kind: "cut", from: ["2", 0], to: ["3", 3] };

    it("stops after the cut, where its jump lands", async () => {
      await load("plain", [cut, caesura("4")]);

      expect(playThrough()).toEqual(["4:0"]);
    });

    it("leaves out caesuras on and inside the cut", async () => {
      await load("plain", [cut, caesura("2"), caesura("3"), caesura("3", 2)]);

      expect(playThrough()).toEqual([]);
    });

    it("stops once before a repeat that starts where the cut ends", async () => {
      await load("plain", [
        { kind: "cut", from: ["2", 0], to: ["2", 3] },
        { kind: "repeat", from: ["3", 0], to: ["3", 3], passes: 2 },
        caesura("3"),
      ]);

      expect(playThrough()).toEqual(["3:0"]);
    });
  });
});
