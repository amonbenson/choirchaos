import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import Select from "primevue/select";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";

import type { SelectedRun } from "@/core/models/measureSelection";
import type Song from "@/core/models/song";
import { addWarpMarker } from "@/core/models/warpEditing";
import { dbUpdate } from "@/pocketbase/db";
import { idOf, makeAudioSongWithRepeat } from "@/test/fixtures";

import SyncGroup from "./SyncGroup.vue";

const POSITION_MS = 250;

type FakePosition = { position: number; beatTicks: number[]; endTick: number };

const player = vi.hoisted(() => ({
  ready: true,
  position: 0,
  currentLocation: undefined as { position: number } | undefined,
  duration: 2000,
  timeline: [] as FakePosition[],
  seekPosition: (() => {}) as (position: number) => void,
  syncWarp: () => {},
}));

vi.mock("@/stores/player", () => ({ usePlayerStore: () => player }));

const editor = vi.hoisted(() => ({ setSelection: (() => {}) as (measures: unknown[]) => void }));

vi.mock("@/composables/useMeasureEditor", () => ({ injectMeasureEditor: () => editor }));

const confirmation = vi.hoisted(() => ({ accept: true, require: (() => {}) as (options: { accept: () => void; reject: () => void }) => void }));

vi.mock("primevue/useconfirm", () => ({ useConfirm: () => confirmation }));

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

// Positions 0 to 7 play "1 2 3 2 3 2 3 4", with sync points on "1" at 0 s and "3" at 0.5 s.
function makeSong(): Song {
  const song = reactive(makeAudioSongWithRepeat()) as Song;
  player.timeline = song.getTimeline().map(({ position }) => ({ position, beatTicks: [position * POSITION_MS], endTick: (position + 1) * POSITION_MS }));
  return song;
}

function mountGroup(song: Song, run: SelectedRun): VueWrapper {
  return mount(SyncGroup, {
    props: { song, run },
    global: { plugins: [PrimeVue, ToastService] },
    attachTo: document.body,
  });
}

function button(wrapper: VueWrapper, name: string): ReturnType<VueWrapper["find"]> {
  return wrapper.findAll("button").find(element => (element.attributes("aria-label") ?? element.text()) === name)!;
}

function timeField(wrapper: VueWrapper): ReturnType<VueWrapper["find"]> {
  return wrapper.find("input");
}

function syncTimeOf(song: Song, label: string, occurrence = 1): number | undefined {
  return song.getWarpMarkers().find(marker => marker.measure === idOf(song, label) && marker.occurrence === occurrence)?.time;
}

describe("SyncGroup", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    player.position = 0;
    player.currentLocation = undefined;
    player.seekPosition = vi.fn();
    player.syncWarp = vi.fn();
    editor.setSelection = vi.fn();
    confirmation.require = vi.fn(options => confirmation.accept ? options.accept() : options.reject());
    confirmation.accept = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("shows when the selected occurrence starts", () => {
    const wrapper = mountGroup(makeSong(), { first: 2, last: 2 });

    expect((timeField(wrapper).element as HTMLInputElement).value).toBe("0:00.500");
    expect(wrapper.text()).toContain("0:00.500");
  });

  it("nudges with the buttons and the arrow keys and saves only the latest time", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });
    let finishFirstSave = (): void => {};
    vi.mocked(dbUpdate).mockImplementationOnce(() => new Promise((resolve) => {
      finishFirstSave = () => resolve({});
    }));

    await button(wrapper, "Nudge later").trigger("click");
    await timeField(wrapper).trigger("keydown", { key: "ArrowUp", shiftKey: true });
    await timeField(wrapper).trigger("keydown", { key: "ArrowDown" });
    expect((timeField(wrapper).element as HTMLInputElement).value).toBe("0:00.600");
    finishFirstSave();
    await flushPromises();

    expect(syncTimeOf(song, "3")).toBeCloseTo(0.6);
    expect(dbUpdate).toHaveBeenCalledTimes(2);
  });

  it("brings the playhead back when a nudge moves the measure away from it", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    player.currentLocation = { position: 2 };
    await button(wrapper, "Nudge later").trigger("click");
    await flushPromises();
    expect(player.seekPosition).not.toHaveBeenCalled();

    player.currentLocation = { position: 1 };
    await button(wrapper, "Nudge later").trigger("click");
    await flushPromises();
    expect(player.seekPosition).toHaveBeenCalledWith(2);
  });

  it("keeps a nudged sync point after the one before it", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await button(wrapper, "Nudge earlier").trigger("click");
    for (let i = 0; i < 6; i++) {
      await timeField(wrapper).trigger("keydown", { key: "ArrowDown", shiftKey: true });
    }

    await flushPromises();

    expect(syncTimeOf(song, "3")).toBeCloseTo(0.01);
  });

  it("moves the sync point to a typed time", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await timeField(wrapper).setValue("0:01.25");
    await timeField(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(syncTimeOf(song, "3")).toBeCloseTo(1.25);
    expect((timeField(wrapper).element as HTMLInputElement).value).toBe("0:01.250");
  });

  it("restores the time when the typed text is not a time", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await timeField(wrapper).setValue("soon");
    await timeField(wrapper).trigger("blur");

    expect((timeField(wrapper).element as HTMLInputElement).value).toBe("0:00.500");
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("syncs an occurrence without a sync point to the playhead", async () => {
    const song = makeSong();
    player.position = 750;
    const wrapper = mountGroup(song, { first: 3, last: 4 });

    expect(wrapper.text()).toContain("No sync point. 2, 2nd time starts at about 0:00.750");
    await button(wrapper, "Sync to playhead").trigger("click");
    await flushPromises();

    expect(syncTimeOf(song, "2", 2)).toBe(0.75);
  });

  it("only syncs to the playhead between the neighbouring sync points", () => {
    player.position = 250;
    const wrapper = mountGroup(makeSong(), { first: 3, last: 3 });

    expect(button(wrapper, "Sync to playhead").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("To sync 2, 2nd time, move the playhead between the sync points before and after it.");
  });

  it("moves the sync point to another measure, keeps its time and selects that measure", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await button(wrapper, "Move to another measure").trigger("click");
    await nextTick();
    const select = wrapper.findComponent(Select);
    const options = select.props("options") as { label: string; value: string }[];
    expect(options.map(option => option.label)).toEqual(["2", "2, 2nd time", "3, 2nd time", "2, 3rd time", "3, 3rd time", "4"]);
    select.vm.$emit("update:modelValue", options.at(-1)!.value);
    await flushPromises();

    expect(syncTimeOf(song, "3")).toBeUndefined();
    expect(syncTimeOf(song, "4")).toBe(0.5);
    expect(editor.setSelection).toHaveBeenCalledWith([song.findMeasure(idOf(song, "4"))]);
    expect(player.seekPosition).toHaveBeenCalledWith(7);
  });

  it("removes the sync point only once confirmed", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    confirmation.accept = false;
    await button(wrapper, "Remove sync point at 3").trigger("click");
    await flushPromises();
    expect(syncTimeOf(song, "3")).toBe(0.5);

    confirmation.accept = true;
    await button(wrapper, "Remove sync point at 3").trigger("click");
    await flushPromises();
    expect(syncTimeOf(song, "3")).toBeUndefined();
    expect(wrapper.text()).toContain("No sync point.");
  });

  it("names the passes without a sync point and selects one on click", async () => {
    const song = makeSong();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    expect(wrapper.text()).toContain("2 sync points");
    expect(wrapper.text()).not.toContain("every pass covered");
    expect(wrapper.text()).toContain("No sync point in 2 to 3, 2nd time");
    expect(wrapper.text()).toContain("No sync point in 2, 3rd time to 4");

    await button(wrapper, "No sync point in 2 to 3, 2nd time").trigger("click");

    expect(player.seekPosition).toHaveBeenCalledWith(3);
    expect(editor.setSelection).toHaveBeenCalledWith([song.findMeasure(idOf(song, "2"))]);
  });

  it("says when every pass has a sync point", async () => {
    const song = makeSong();
    await song.editLayers({ warpMarkers: addWarpMarker(song.getTimeline(), song.getWarpMarkers(), { measure: idOf(song, "2"), occurrence: 2, time: 0.75 }) });
    await song.editLayers({ warpMarkers: addWarpMarker(song.getTimeline(), song.getWarpMarkers(), { measure: idOf(song, "2"), occurrence: 3, time: 1.25 }) });

    expect(mountGroup(song, { first: 2, last: 2 }).text()).toContain("4 sync points, every pass covered");
  });
});
