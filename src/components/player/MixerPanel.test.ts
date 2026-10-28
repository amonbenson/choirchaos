import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import Tooltip from "primevue/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import Song from "@/core/models/song";
import Track, { DEFAULT_TRACK_GAIN, type TrackClassification } from "@/core/models/track";
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

function mountPanel(song: Song, editMode = false, showId = "show-id"): VueWrapper {
  return mount(MixerPanel, {
    props: { showId, song: reactive(song) as Song, editMode },
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

  it("leaves track setup to the song details dialog", () => {
    const wrapper = mountPanel(makeAudioSong(["Vocal"]), true);

    expect(wrapper.find("input").exists()).toBe(false);
    expect(groupHeadings(wrapper)).toEqual(["Vocal"]);
  });

  it("applies the stored mixer settings to replaced tracks", async () => {
    const song = reactive(makeAudioSong(["Vocal"])) as Song;
    useSettingsStore().updateTrackMixer("show-id", "Alto", { mute: true });
    mountPanel(song);

    await song.setTracks([new Track("Alto", "Vocal", 0, "track0.mp3")]);
    await flushPromises();

    expect(song.tracks[0]!.mixer.mute).toBe(true);
  });

  it("starts every track at the default gain", () => {
    const song = reactive(makeAudioSong(["Vocal", "Accompaniment"])) as Song;
    mountPanel(song);

    expect(song.tracks.map(t => t.mixer.gain)).toEqual([DEFAULT_TRACK_GAIN, DEFAULT_TRACK_GAIN]);
  });

  it("keeps the mixer settings of each show apart", () => {
    useSettingsStore().updateTrackMixer("other-show", "Track 0", { gain: 0.2, mute: true });
    const song = reactive(makeAudioSong(["Vocal"])) as Song;
    mountPanel(song, false, "show-id");

    expect(song.tracks[0]!.mixer.gain).toBe(DEFAULT_TRACK_GAIN);
    expect(song.tracks[0]!.mixer.mute).toBe(false);
  });
});
