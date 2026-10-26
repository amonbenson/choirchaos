import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import Measure from "@/core/models/measure";
import { formatRecording } from "@/core/models/recording";
import Song from "@/core/models/song";
import Track from "@/core/models/track";
import { makeMidiSong } from "@/test/fixtures";

import DuplicateReviewCard from "./DuplicateReviewCard.vue";

const player = vi.hoisted(() => ({ position: 0, load: (async () => {}) as (song: unknown) => Promise<void>, seek: (() => {}) as (position: number) => void }));

vi.mock("@/stores/player", () => ({ usePlayerStore: () => player }));

const confirmation = vi.hoisted(() => ({ require: (() => {}) as (options: { accept: () => void; reject: () => void }) => void }));

vi.mock("primevue/useconfirm", () => ({ useConfirm: () => confirmation }));

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

/** Measures 1 to 4, then 4a and 4b on top of 1 and 2, then 5 and 6, all played once in score order. */
function makeFakedRepeatSong(id = "faked-repeat"): Song {
  const labels = ["1", "2", "3", "4", "4a", "4b", "5", "6"];
  const measures = labels.map((label, i) => new Measure(`m${i + 1}`, label, 4, { page: 0, x: i / 8, y: 0.1, width: 0.1, height: 0.1 }));
  measures[4]!.layout = measures[0]!.layout;
  measures[5]!.layout = measures[1]!.layout;
  const track = new Track("Mix", "Accompaniment", 0, "mix.mp3");
  return new Song(id, "1", "Faked repeat", undefined, undefined, undefined, ["mix.mp3"], [track], {
    measures,
    spans: [{ from: "m1", to: "m8" }],
    warpMarkers: [{ measure: "m1", occurrence: 1, time: 0 }, { measure: "m5", occurrence: 1, time: 8 }, { measure: "m8", occurrence: 1, time: 14 }],
  });
}

function mountCard(song: Song): VueWrapper {
  return mount(DuplicateReviewCard, {
    props: { song: reactive(song) as Song },
    global: { plugins: [PrimeVue, ToastService] },
  });
}

function button(wrapper: VueWrapper, label: string): ReturnType<VueWrapper["find"]> {
  return wrapper.findAll("button").find(candidate => candidate.text() === label)!;
}

describe("DuplicateReviewCard", () => {
  beforeEach(() => {
    sessionStorage.clear();
    player.load = vi.fn(async () => {});
    player.seek = vi.fn();
    confirmation.require = vi.fn(options => options.accept());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proposes playing the duplicates as another pass and previews the recording", () => {
    const wrapper = mountCard(makeFakedRepeatSong());

    expect(wrapper.text()).toContain("Measures 4a to 4b lie exactly on top of 1 to 2");
    expect(wrapper.text()).toContain("Is the recording playing 1 to 2 a 2nd time?");
    expect(wrapper.text()).toContain("Recording becomes 1-4, 1-2, 5-6.");
    expect(button(wrapper, "Play as 2nd time of 1 to 2").exists()).toBe(true);
  });

  it("plays the duplicates as a repeat, keeps the sync and reloads the player", async () => {
    const song = makeFakedRepeatSong();
    const wrapper = mountCard(song);

    await button(wrapper, "Play as 2nd time of 1 to 2").trigger("click");
    await flushPromises();

    expect(song.getMeasures().map(measure => measure.label)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(formatRecording(song.getRecording(), song.getMeasures())).toBe("1-4, 1-2, 5-6");
    expect(song.getWarpMarkers()).toEqual([
      { measure: "m1", occurrence: 1, time: 0 },
      { measure: "m1", occurrence: 2, time: 8 },
      { measure: "m8", occurrence: 1, time: 14 },
    ]);
    expect(confirmation.require).not.toHaveBeenCalled();
    expect(player.load).toHaveBeenCalledWith(song);
    expect(wrapper.find("li").exists()).toBe(false);
  });

  it("hides the proposal for the session when the measures are kept separate", async () => {
    const song = makeFakedRepeatSong();
    const wrapper = mountCard(song);

    await button(wrapper, "Keep separate measures").trigger("click");

    expect(wrapper.find("li").exists()).toBe(false);
    expect(mountCard(song).find("li").exists()).toBe(false);
    expect(mountCard(makeFakedRepeatSong("other-song")).find("li").exists()).toBe(true);
    expect(song.getMeasures()).toHaveLength(8);
  });

  it("proposes nothing for MIDI songs", () => {
    expect(mountCard(makeMidiSong()).find("li").exists()).toBe(false);
  });
});
