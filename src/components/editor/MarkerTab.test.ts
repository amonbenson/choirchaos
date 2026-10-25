import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import Song from "@/core/models/song";
import type { PlayerLocation } from "@/core/player/types";
import { locationOf, makeMidiSongWithRepeat } from "@/test/fixtures";

import MarkerTab from "./MarkerTab.vue";

const player = vi.hoisted(() => ({ currentLocation: undefined as PlayerLocation | undefined }));

vi.mock("@/stores/player", async () => {
  const { reactive } = await import("vue");
  const state = reactive(player);
  return { usePlayerStore: () => state };
});

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function mountTab(song: Song | undefined): VueWrapper {
  return mount(MarkerTab, {
    props: { song: song && reactive(song) as Song },
    global: { plugins: [PrimeVue, ToastService] },
  });
}

describe("MarkerTab", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    player.currentLocation = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds a marker at the occurrence that is playing", async () => {
    const song = makeMidiSongWithRepeat();
    const at = locationOf(song, "2", 0, 2);
    player.currentLocation = { position: 4, ...at, beat: 2 };
    const wrapper = mountTab(song);

    await wrapper.find("button[aria-label='Add marker']").trigger("click");
    await flushPromises();

    expect(song.getMarkers()).toEqual([{ at, text: "A" }]);
    expect(wrapper.find("input[aria-label='Name of marker A']").exists()).toBe(true);
  });

  it("adds a marker at the start without playback", async () => {
    const song = makeMidiSongWithRepeat();
    const wrapper = mountTab(song);

    await wrapper.find("button[aria-label='Add marker']").trigger("click");
    await flushPromises();

    expect(song.getMarkers()).toEqual([{ at: locationOf(song, "0"), text: "A" }]);
  });

  it("names new markers with the next free rehearsal letter", async () => {
    const song = makeMidiSongWithRepeat();
    await song.addMarker(locationOf(song, "1"), "A");
    await song.addMarker(locationOf(song, "3"), "C");
    const wrapper = mountTab(song);

    await wrapper.find("button[aria-label='Add marker']").trigger("click");
    await flushPromises();

    expect(song.getMarkers().map(marker => marker.text)).toContain("B");
  });

  it("saves an edited location", async () => {
    const song = makeMidiSongWithRepeat();
    await song.addMarker(locationOf(song, "1"), "A");
    const wrapper = mountTab(song);

    const input = wrapper.find("input[aria-label='Measure of marker A']");
    await input.setValue("4");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(song.getMarkers()).toEqual([{ at: locationOf(song, "4"), text: "A" }]);
  });

  it("removes a marker", async () => {
    const song = makeMidiSongWithRepeat();
    await song.addMarker(locationOf(song, "1"), "A");
    const wrapper = mountTab(song);

    await wrapper.find("button[aria-label='Delete marker A']").trigger("click");
    await flushPromises();

    expect(song.getMarkers()).toEqual([]);
  });

  it("marks the marker of the playing occurrence only", async () => {
    const song = makeMidiSongWithRepeat();
    await song.addMarker(locationOf(song, "2"), "A");
    await song.addMarker(locationOf(song, "2", 0, 2), "B");
    player.currentLocation = { position: 4, ...locationOf(song, "2", 0, 2), beat: 0 };
    const wrapper = mountTab(song);

    const rows = wrapper.findAll(".border-l-2");
    expect(rows.map(row => row.classes("border-primary"))).toEqual([false, true]);
  });

  it("points to the Measures tab while the song has no measures", () => {
    const wrapper = mountTab(new Song("song-id", "1", "Song", undefined, undefined, undefined));

    expect(wrapper.text()).toContain("Markers point to measures");
    expect(wrapper.find("button[aria-label='Add marker']").exists()).toBe(false);
  });
});
