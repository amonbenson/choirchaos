import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import type { Location } from "@/core/models/recording";
import type Song from "@/core/models/song";
import type { PlayerLocation } from "@/core/player/types";
import { usePlayerStore } from "@/stores/player";
import { locationOf, makeMidiSongWithRepeat } from "@/test/fixtures";

import MarkerPanel from "./MarkerPanel.vue";

const player = vi.hoisted(() => ({
  currentLocation: undefined as PlayerLocation | undefined,
  duration: 1000,
  seekLocation: vi.fn(),
  getLocationTick: vi.fn((_location: Location): number | undefined => 250),
}));

vi.mock("@/stores/player", async () => {
  const { reactive } = await import("vue");
  const state = reactive(player);
  return { usePlayerStore: () => state };
});

/** The mocked store, typed as the fake so tests can set its state. */
function fakePlayer(): typeof player {
  return usePlayerStore() as unknown as typeof player;
}

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

async function makeSongWithMarkers(): Promise<Song> {
  const song = makeMidiSongWithRepeat();
  await song.addMarker(locationOf(song, "1"), "Intro");
  await song.addMarker(locationOf(song, "2", 0, 2), "Chorus");
  return song;
}

function mountPanel(song: Song): VueWrapper {
  return mount(MarkerPanel, {
    props: { song: reactive(song) as Song },
    global: { plugins: [PrimeVue] },
  });
}

describe("MarkerPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
    player.currentLocation = undefined;
  });

  it("names each marker with its location and occurrence", async () => {
    const wrapper = mountPanel(await makeSongWithMarkers());

    const names = wrapper.findAll("li button").map(button => button.attributes("aria-label"));
    expect(names).toEqual(["Intro, marker at 1", "Chorus, marker at 2, 2nd time"]);
    expect(wrapper.find("ul[aria-label='Markers']").exists()).toBe(true);
  });

  it("jumps to the marker's occurrence", async () => {
    const song = await makeSongWithMarkers();
    const wrapper = mountPanel(song);

    await wrapper.findAll("li button")[1]!.trigger("click");

    expect(player.seekLocation).toHaveBeenCalledWith(locationOf(song, "2", 0, 2));
  });

  it("shows where each marker lies in the song", async () => {
    const song = await makeSongWithMarkers();
    player.getLocationTick.mockImplementation(location => location.occurrence === 2 ? 500 : 0);
    const wrapper = mountPanel(song);
    await flushPromises();

    const widths = wrapper.findAll("li > div").map(bar => (bar.element as HTMLElement).style.width);
    expect(widths).toEqual(["calc(0% - 0.5rem)", "calc(50% - 0.5rem)"]);
  });

  it("highlights the marker of the playing occurrence only", async () => {
    const song = await makeSongWithMarkers();
    player.currentLocation = { position: 2, ...locationOf(song, "2"), beat: 0 };
    const wrapper = mountPanel(song);
    expect(wrapper.findAll("li button").map(button => button.classes("p-button-secondary"))).toEqual([true, true]);

    fakePlayer().currentLocation = { position: 4, ...locationOf(song, "2", 0, 2), beat: 0 };
    await flushPromises();

    expect(wrapper.findAll("li button").map(button => button.classes("p-button-secondary"))).toEqual([true, false]);
  });

  it("says so when the song has no markers", () => {
    const wrapper = mountPanel(makeMidiSongWithRepeat());

    expect(wrapper.text()).toContain("No markers available.");
  });
});
