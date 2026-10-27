import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import type { SelectedRun } from "@/core/models/measureSelection";
import { formatRecording } from "@/core/models/recording";
import type Song from "@/core/models/song";
import { dbUpdate } from "@/pocketbase/db";
import { idOf, makeAudioSong, makeAudioSongWithBakedVamp, makeAudioSongWithRepeat, makeMidiSongWithRepeat } from "@/test/fixtures";

import RecordingGroup from "./RecordingGroup.vue";

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

function mountGroup(song: Song, run: SelectedRun): VueWrapper {
  return mount(RecordingGroup, {
    props: { song: reactive(song) as Song, run },
    global: { plugins: [PrimeVue, ToastService] },
  });
}

function recordingOf(song: Song): string {
  return formatRecording(song.getRecording(), song.getMeasures());
}

async function setCount(wrapper: VueWrapper, count: number): Promise<void> {
  wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", count);
  await vi.advanceTimersByTimeAsync(500);
  await flushPromises();
}

describe("RecordingGroup", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.useFakeTimers();
    confirmation.require = vi.fn(options => confirmation.accept ? options.accept() : options.reject());
    confirmation.accept = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("shows how often the selected measures are recorded back to back", () => {
    const wrapper = mountGroup(makeAudioSongWithRepeat(), { first: 3, last: 4 });

    expect(wrapper.text()).toContain("Recorded 3 times");
    expect((wrapper.find("input[role='spinbutton']").element as HTMLInputElement).value).toBe("3");
    expect(wrapper.text()).toContain("After 3, 2nd time, continue at");
  });

  it("removes a recorded pass and saves it", async () => {
    const song = makeAudioSongWithRepeat();
    const wrapper = mountGroup(song, { first: 1, last: 2 });

    await setCount(wrapper, 2);

    expect(recordingOf(song)).toBe("1-3, 2-3, 4");
    expect(confirmation.require).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalledOnce();
    expect(wrapper.find("[role='status']").text()).toBe("The recording now plays 6 measures.");
  });

  it("adds recorded passes to a single measure", async () => {
    const song = makeAudioSong();
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    await setCount(wrapper, 3);

    expect(recordingOf(song)).toBe("1-2, 2 x2, 3-4");
  });

  it("asks before removing a sync point and keeps everything when cancelled", async () => {
    confirmation.accept = false;
    const song = makeAudioSongWithBakedVamp();
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    await setCount(wrapper, 1);

    expect(confirmation.require).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("the sync point at 2, 2nd time"),
    }));
    expect(recordingOf(song)).toBe("1-2, 2 x2, 2-4");
    expect(dbUpdate).not.toHaveBeenCalled();
    expect((wrapper.find("input[role='spinbutton']").element as HTMLInputElement).value).toBe("4");
  });

  it("removes the sync point once confirmed", async () => {
    const song = makeAudioSongWithBakedVamp();
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    await setCount(wrapper, 1);

    expect(recordingOf(song)).toBe("1-4");
    expect(song.getWarpMarkers().map(marker => marker.measure)).toEqual([idOf(song, "1")]);
  });

  it("jumps to another measure after the selected occurrence", async () => {
    const song = makeAudioSong();
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    wrapper.findComponent(Select).vm.$emit("update:modelValue", idOf(song, "4"));
    await flushPromises();

    expect(recordingOf(song)).toBe("1-2, 4");
  });

  it("shows a MIDI recording read-only", () => {
    const wrapper = mountGroup(makeMidiSongWithRepeat(), { first: 2, last: 3 });

    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.text()).toContain("Recorded 3 times, then 2, 2nd time");
    expect(wrapper.text()).toContain("cannot be changed here");
  });
});
