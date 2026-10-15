import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import Song from "@/core/models/song";
import Track, { type TrackClassification } from "@/core/models/track";
import { dbUpdateWithFiles } from "@/pocketbase/db";
import { usePlayerStore } from "@/stores/player";
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
    global: { plugins: [PrimeVue] },
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

  it("creates one track per uploaded file, linked to its stored name", async () => {
    vi.spyOn(usePlayerStore(), "load").mockResolvedValue(undefined as never);
    vi.mocked(dbUpdateWithFiles).mockResolvedValueOnce({ id: "song-id", audioFiles: ["lead_vocals_1.mp3", "piano_2.mp3"] });
    const song = makeEmptySong();
    const wrapper = mountPanel(song, true);

    await wrapper.findAll("button").find(b => b.text() === "MP3")!.trigger("click");
    const input = wrapper.find<HTMLInputElement>("input[type=file][accept='audio/*']");
    const files = [new File(["a"], "lead_vocals.mp3"), new File(["b"], "piano.mp3")];
    Object.defineProperty(input.element, "files", { value: files });
    await input.trigger("change");
    await flushPromises();

    expect(song.tracks.map(t => [t.title, t.classification, t.audioFile])).toEqual([
      ["Lead Vocals", "Vocal", "lead_vocals_1.mp3"],
      ["Piano", "Accompaniment", "piano_2.mp3"],
    ]);
    expect(groupHeadings(wrapper)).toEqual(["Accompaniment", "Vocal"]);
  });
});
