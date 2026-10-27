import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, reactive } from "vue";

import { type MeasureEditor, provideMeasureEditor } from "@/composables/useMeasureEditor";
import { findSectionsAt, type SelectedRun } from "@/core/models/measureSelection";
import type Song from "@/core/models/song";
import { locationOf, makeMidiSong, makeMidiSongWithRepeat, makeMidiSongWithVamp } from "@/test/fixtures";

import RehearsalGroup from "./RehearsalGroup.vue";

const player = vi.hoisted(() => ({ syncWarp: (() => {}) as () => void }));

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

// PrimeVue's Select queries media features, which jsdom does not implement.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

const confirmation = vi.hoisted(() => ({ accept: true, require: (() => {}) as (options: { message: string; accept: () => void }) => void }));

vi.mock("primevue/useconfirm", () => ({ useConfirm: () => confirmation }));

const selectSection = vi.fn();

function mountGroup(song: Song, run: SelectedRun): VueWrapper {
  const reactiveSong = reactive(song) as Song;
  const host = {
    setup() {
      provideMeasureEditor({ selectSection } as unknown as MeasureEditor);
      return () => h(RehearsalGroup, {
        song: reactiveSong,
        run,
        matches: findSectionsAt(reactiveSong.getTimeline(), reactiveSong.getSections(), run),
      });
    },
  };

  return mount(host, { global: { plugins: [PrimeVue, ToastService] } });
}

async function choose(wrapper: VueWrapper, label: string): Promise<void> {
  const option = wrapper.findAll("[aria-label='Rehearsal'] button").find(button => button.text() === label);
  await option!.trigger("click");
  await flushPromises();
}

function findSelect(wrapper: VueWrapper, label: string): VueWrapper {
  const id = wrapper.findAll("span").find(span => span.text() === label)!.attributes("id");
  return wrapper.findAllComponents(Select).find(select => select.attributes("aria-labelledby") === id
    || select.find(`[aria-labelledby='${id}']`).exists())!;
}

describe("RehearsalGroup", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    player.syncWarp = vi.fn();
    confirmation.require = vi.fn(options => confirmation.accept && options.accept());
    confirmation.accept = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("turns the selected measures into a repeat over whole measures", async () => {
    const song = makeMidiSong();
    const wrapper = mountGroup(song, { first: 1, last: 2 });
    expect(wrapper.text()).toContain("How rehearsals play these measures");

    await choose(wrapper, "Repeat");

    expect(song.getSections()).toEqual([{ kind: "repeat", from: locationOf(song, "1"), to: locationOf(song, "2", 3), passes: 2 }]);
    expect(player.syncWarp).toHaveBeenCalledOnce();
  });

  it("makes the section on the occurrence that is selected", async () => {
    const song = makeMidiSongWithRepeat();
    await song.removeSection(0);
    const wrapper = mountGroup(song, { first: 4, last: 5 });

    await choose(wrapper, "Cut");

    expect(song.getSections()).toEqual([{ kind: "cut", from: locationOf(song, "2", 0, 2), to: locationOf(song, "3", 3, 2) }]);
  });

  it("edits the passes of the section the measures belong to", async () => {
    vi.useFakeTimers();
    const song = makeMidiSongWithRepeat();
    const wrapper = mountGroup(song, { first: 5, last: 5 });
    expect(wrapper.text()).toContain("Part of Repeat 2 to 3");
    expect(wrapper.find("button[aria-pressed='true']").text()).toBe("Repeat");

    await wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", 5);
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(song.getSections()[0]).toMatchObject({ kind: "repeat", from: locationOf(song, "2"), passes: 5 });
    expect(player.syncWarp).toHaveBeenCalledOnce();
  });

  it("selects the whole section it belongs to", async () => {
    const wrapper = mountGroup(makeMidiSongWithRepeat(), { first: 5, last: 5 });

    await wrapper.find("button[aria-label='Select repeat 2 to 3']").trigger("click");

    expect(selectSection).toHaveBeenCalledWith(0);
  });

  it("sets how a vamp ends and who sings, without a pass count", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountGroup(song, { first: 2, last: 2 });
    expect(wrapper.find("[aria-label='Select vamp 2']").exists()).toBe(false);
    expect(wrapper.findComponent(InputNumber).exists()).toBe(false);

    await findSelect(wrapper, "Out").vm.$emit("update:modelValue", "anyBar");
    await flushPromises();
    await findSelect(wrapper, "Vocals").vm.$emit("update:modelValue", "last");
    await flushPromises();
    expect(song.getSections()[0]).toEqual({ kind: "vamp", from: locationOf(song, "2"), to: locationOf(song, "2", 3), out: "anyBar", vocals: "last" });
  });

  it("switches a section to another kind with that kind's defaults", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await choose(wrapper, "Repeat");

    expect(song.getSections()).toEqual([{ kind: "repeat", from: locationOf(song, "2"), to: locationOf(song, "2", 3), passes: 2 }]);
  });

  it("plays the measures as recorded again after a confirmation", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await choose(wrapper, "As recorded");

    expect(confirmation.require).toHaveBeenCalledWith(expect.objectContaining({ message: "Remove vamp 2? These measures will play as recorded." }));
    expect(song.getSections()).toEqual([]);
    expect(player.syncWarp).toHaveBeenCalledOnce();
  });

  it("keeps the section when the removal is cancelled", async () => {
    const song = makeMidiSongWithVamp();
    confirmation.accept = false;
    const wrapper = mountGroup(song, { first: 2, last: 2 });

    await choose(wrapper, "As recorded");

    expect(song.getSections()).toMatchObject([{ kind: "vamp" }]);
    expect(player.syncWarp).not.toHaveBeenCalled();
  });

  it("names an overlapped section and replaces it only when asked", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountGroup(song, { first: 1, last: 2 });
    expect(wrapper.text()).toContain("These measures overlap Vamp 2.");

    await choose(wrapper, "Cut");
    expect(song.getSections()).toMatchObject([{ kind: "vamp" }]);

    await wrapper.findAll("button").find(button => button.text() === "Replace with cut")!.trigger("click");
    await flushPromises();
    expect(song.getSections()).toEqual([{ kind: "cut", from: locationOf(song, "1"), to: locationOf(song, "2", 3) }]);
  });

  it("explains a section that cannot be played instead of saving it", async () => {
    const song = makeMidiSong();
    const wrapper = mountGroup(song, { first: 0, last: 0 });

    await choose(wrapper, "Repeat");

    expect(song.getSections()).toEqual([]);
    expect(wrapper.text()).toContain("A section must start before it ends.");
    expect(player.syncWarp).not.toHaveBeenCalled();
  });
});
