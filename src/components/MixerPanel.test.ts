import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import Tooltip from "primevue/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import Song from "@/core/models/song";
import Track, { type TrackClassification } from "@/core/models/track";
import { dbUpdate } from "@/pocketbase/db";
import { useSettingsStore } from "@/stores/settings";

import MixerPanel from "./MixerPanel.vue";

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

// PrimeVue's Select queries media features, which jsdom does not implement.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function makeAudioSong(classifications: TrackClassification[]): Song {
  const files = classifications.map((_, i) => `track${i}.mp3`);
  const tracks = classifications.map((c, i) => new Track(`Track ${i}`, c, 0, files[i]));
  return new Song("song-id", "1", "Song", undefined, undefined, undefined, files, tracks);
}

function makeEmptySong(): Song {
  return new Song("song-id", "1", "Song", undefined, undefined, undefined);
}

function mountPanel(song: Song, editMode = false): VueWrapper {
  return mount(MixerPanel, {
    props: { song: reactive(song) as Song, editMode },
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  });
}

function groupHeadings(wrapper: VueWrapper): string[] {
  return wrapper.findAll("h3").map(h => h.text());
}

describe("MixerPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe.each([true, false])("with mergeAccompaniment=%s", (mergeAccompaniment) => {
    beforeEach(() => {
      useSettingsStore().update({ appearance: { mergeAccompaniment } });
    });

    it("renders a song with only vocal tracks", () => {
      const wrapper = mountPanel(makeAudioSong(["Vocal", "Vocal"]));

      expect(groupHeadings(wrapper)).toEqual(["Vocal"]);
    });

    it("renders a song with only accompaniment tracks", () => {
      const wrapper = mountPanel(makeAudioSong(["Accompaniment", "Percussion"]));

      expect(groupHeadings(wrapper)).toEqual(["Accompaniment"]);
    });

    it("renders a song with mixed tracks", () => {
      const wrapper = mountPanel(makeAudioSong(["Accompaniment", "Vocal"]));

      expect(groupHeadings(wrapper)).toEqual(["Accompaniment", "Vocal"]);
    });
  });

  it("asks for playback in edit mode when the song has none", async () => {
    const wrapper = mountPanel(makeEmptySong(), true);

    const button = wrapper.findAll("button").find(b => b.text() === "Add playback")!;
    await button.trigger("click");

    expect(wrapper.emitted("openSongDetails")).toHaveLength(1);
    expect(wrapper.find("input[type=file]").exists()).toBe(false);
  });

  it("renames a track in edit mode", async () => {
    const song = makeAudioSong(["Vocal"]);
    const wrapper = mountPanel(song, true);

    const input = wrapper.find<HTMLInputElement>("input[aria-label='Name of track 1']");
    input.element.value = "Soprano";
    await input.trigger("change");
    await flushPromises();

    expect(song.tracks[0]!.title).toBe("Soprano");
    expect(dbUpdate).toHaveBeenCalledWith("songs", "song-id", { tracks: [expect.objectContaining({ title: "Soprano" })] });
  });
});
