import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import Song from "@/core/models/song";
import type { PlayerLocation, PlayerSectionState } from "@/core/player/types";
import { locationOf, makeMidiSong, makeMidiSongWithVamp } from "@/test/fixtures";

import SectionTab from "./SectionTab.vue";

const player = vi.hoisted(() => ({
  currentLocation: undefined as PlayerLocation | undefined,
  currentSection: undefined as PlayerSectionState | undefined,
  syncWarp: (() => {}) as () => void,
}));

vi.mock("@/stores/player", async () => {
  const { reactive } = await import("vue");
  const state = reactive(player);
  return { usePlayerStore: () => state };
});

const confirmRequire = vi.hoisted(() => vi.fn((options: { accept: () => void }) => options.accept()));

vi.mock("primevue/useconfirm", () => ({ useConfirm: () => ({ require: confirmRequire }) }));

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
  return mount(SectionTab, {
    props: { song: song && reactive(song) as Song },
    global: { plugins: [PrimeVue, ToastService] },
  });
}

async function add(wrapper: VueWrapper, label: string): Promise<void> {
  const items = wrapper.findComponent(Menu).props("model") as MenuItem[];
  items.find(item => item.label === label)!.command!({} as never);
  await flushPromises();
}

describe("SectionTab", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    player.currentLocation = undefined;
    player.currentSection = undefined;
    player.syncWarp = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds a vamp over two measures from where playback is", async () => {
    const song = makeMidiSong();
    player.currentLocation = { position: 2, ...locationOf(song, "2"), beat: 1 };
    const wrapper = mountTab(song);

    await add(wrapper, "Vamp");

    expect(song.getSections()).toEqual([{
      kind: "vamp", from: locationOf(song, "2"), to: locationOf(song, "3", 3), passes: 0, out: "onEnd", vocals: "all",
    }]);
    expect(player.syncWarp).toHaveBeenCalledOnce();
    expect(wrapper.find("[role='group'][aria-label='Vamp from 2 to 3']").exists()).toBe(true);
  });

  it("adds a new section after the sections that are in the way", async () => {
    const song = makeMidiSongWithVamp();
    player.currentLocation = { position: 2, ...locationOf(song, "2"), beat: 0 };
    const wrapper = mountTab(song);

    await add(wrapper, "Cut");

    expect(song.getSections()[1]).toEqual({ kind: "cut", from: locationOf(song, "3"), to: locationOf(song, "4", 3) });
  });

  it("lists the sections in timeline order with their recorded passes", async () => {
    const song = makeMidiSongWithVamp();
    await song.addSection({ kind: "repeat", from: locationOf(song, "0"), to: locationOf(song, "1", 3), passes: 2 });
    const wrapper = mountTab(song);

    const list = wrapper.find("ul");
    expect(wrapper.find(`#${list.attributes("aria-labelledby")}`).text()).toBe("Sections");
    expect(list.findAll("[role='group']").map(row => row.attributes("aria-label"))).toEqual(["Repeat from 0 to 1", "Vamp from 2 to 2"]);
    expect(list.text()).toContain("Recorded once");
  });

  it("saves an edited section and lets the player follow", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountTab(song);

    const passes = wrapper.findAllComponents(InputNumber).find(input => input.find("input[aria-label^='Passes']").exists())!;
    await passes.vm.$emit("update:modelValue", 3);
    await wrapper.find("input[aria-label='Passes of vamp from 2 to 2']").trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(song.getSections()[0]).toMatchObject({ kind: "vamp", passes: 3 });
    expect(player.syncWarp).toHaveBeenCalledOnce();
  });

  it("removes a section after confirmation", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountTab(song);

    await wrapper.find("button[aria-label='Delete vamp from 2 to 2']").trigger("click");
    await flushPromises();

    expect(confirmRequire).toHaveBeenCalledOnce();
    expect(song.getSections()).toEqual([]);
    expect(player.syncWarp).toHaveBeenCalledOnce();
  });

  it("marks the section that is playing", async () => {
    const song = makeMidiSongWithVamp();
    await song.addSection({ kind: "cut", from: locationOf(song, "3"), to: locationOf(song, "4", 3) });
    player.currentSection = { section: 0, kind: "vamp", pass: 1, passes: 2, recordedPasses: 1, released: false };
    const wrapper = mountTab(song);

    const rows = wrapper.findAll("[role='group']");
    expect(rows.map(row => row.classes("border-primary"))).toEqual([true, false]);
  });

  it("points to the Measures tab while the song has no measures", () => {
    const wrapper = mountTab(new Song("song-id", "1", "Song", undefined, undefined, undefined));

    expect(wrapper.text()).toContain("Sections span measures");
    expect(wrapper.find("button[aria-label='Add section']").exists()).toBe(false);
  });
});
