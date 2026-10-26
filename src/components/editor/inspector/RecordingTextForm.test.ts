import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import { formatRecording } from "@/core/models/recording";
import type Song from "@/core/models/song";
import { makeAudioSong, makeAudioSongWithBakedVamp, makeAudioSongWithRepeat } from "@/test/fixtures";

import RecordingTextForm from "./RecordingTextForm.vue";

const player = vi.hoisted(() => ({ position: 0, load: (async () => {}) as (song: unknown) => Promise<void>, seek: (() => {}) as (position: number) => void }));

vi.mock("@/stores/player", () => ({ usePlayerStore: () => player }));

const confirmation = vi.hoisted(() => ({ require: (() => {}) as (options: { accept: () => void; reject: () => void }) => void }));

vi.mock("primevue/useconfirm", () => ({ useConfirm: () => confirmation }));

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

function mountForm(song: Song): VueWrapper {
  return mount(RecordingTextForm, {
    props: { song: reactive(song) as Song },
    global: { plugins: [PrimeVue, ToastService] },
    attachTo: document.body,
  });
}

function field(wrapper: VueWrapper): ReturnType<VueWrapper["find"]> {
  return wrapper.find("input");
}

function saveButton(wrapper: VueWrapper): ReturnType<VueWrapper["find"]> {
  return wrapper.findAll("button").find(button => button.text() === "Save")!;
}

describe("RecordingTextForm", () => {
  beforeEach(() => {
    player.load = vi.fn(async () => {});
    player.seek = vi.fn();
    confirmation.require = vi.fn(options => options.accept());
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("starts with the current recording and the focus in the field", () => {
    const wrapper = mountForm(makeAudioSongWithRepeat());

    expect((field(wrapper).element as HTMLInputElement).value).toBe("1-3, 2-3, 2-4");
    expect(document.activeElement).toBe(field(wrapper).element);
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("shows why the text cannot be read next to the field", async () => {
    const wrapper = mountForm(makeAudioSong());

    await field(wrapper).setValue("1-2, 9");

    expect(wrapper.text()).toContain("There is no measure \"9\".");
    expect(field(wrapper).attributes("aria-invalid")).toBe("true");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("previews the new length and saves the spans", async () => {
    const song = makeAudioSong();
    const wrapper = mountForm(song);

    await field(wrapper).setValue("1-2 x2, 3-4");
    expect(wrapper.text()).toContain("The recording will play 6 measures instead of 4.");

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(formatRecording(song.getRecording(), song.getMeasures())).toBe("1-2 x2, 3-4");
    expect(player.load).toHaveBeenCalledWith(song);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("lists the references it would remove and asks before saving them away", async () => {
    const song = makeAudioSongWithBakedVamp();
    const wrapper = mountForm(song);

    await field(wrapper).setValue("1-4");
    expect(wrapper.text()).toContain("Removes the sync point at 2, 2nd time.");

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(confirmation.require).toHaveBeenCalledTimes(1);
    expect(formatRecording(song.getRecording(), song.getMeasures())).toBe("1-4");
  });

  it("closes on Cancel without saving", async () => {
    const song = makeAudioSong();
    const wrapper = mountForm(song);

    await field(wrapper).setValue("1-2");
    await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(formatRecording(song.getRecording(), song.getMeasures())).toBe("1-4");
  });
});
