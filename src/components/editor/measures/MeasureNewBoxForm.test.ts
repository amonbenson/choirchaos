import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick, reactive, type Ref, ref } from "vue";

import { provideSongEditor, type SongEditor } from "@/composables/useSongEditor";
import { createEmptyMeasureEdit } from "@/core/models/measure";
import Song from "@/core/models/song";
import { dbUpdate } from "@/pocketbase/db";
import { makeAudioSong } from "@/test/fixtures";

import MeasureNewBoxForm from "./MeasureNewBoxForm.vue";
import MeasureUnnumberedForm from "./MeasureUnnumberedForm.vue";

vi.mock("@/stores/player", () => ({ usePlayerStore: () => ({ currentLocation: undefined, seekLocation: vi.fn(), seekPosition: vi.fn() }) }));

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

const CONFLICT = /is already on the score/;
const FREE_SPOT = { page: 0, x: 0.8, y: 0.8, width: 0.1, height: 0.1 };

type Mounted = SongEditor & { wrapper: VueWrapper; song: Song; texts: string[] };

/**
 * Mounts a form the way the editor panel does, and records the text of every render that follows a
 * saved change, which is when a form that plans again against the saved song would show a conflict.
 */
function mountPanel(song: Song, form: (context: SongEditor) => ReturnType<typeof h> | undefined): Mounted {
  const reactiveSong = reactive(song) as Song;
  const texts: string[] = [];
  let context!: SongEditor;
  const host = {
    setup() {
      context = provideSongEditor(ref<Song | undefined>(reactiveSong) as Ref<Song | undefined>, ref(true));
      return () => h("div", [form(context)]);
    },
  };

  const wrapper = mount(host, { global: { plugins: [PrimeVue, ToastService] } });
  song.onLayersChange(() => {
    nextTick(() => texts.push(wrapper.text()));
  });
  return { wrapper, song: reactiveSong, texts, ...context };
}

describe("placing new measures", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("never plans again against the measures it just saved", async () => {
    const mounted = mountPanel(makeAudioSong(), ({ editor }) => editor.pendingBox.value && h(MeasureNewBoxForm, { layout: editor.pendingBox.value }));
    mounted.editor.startDrawing();
    mounted.editor.pendingCount.value = 1;
    mounted.editor.pendingBox.value = FREE_SPOT;
    await flushPromises();
    await mounted.wrapper.find("#new-box-start").setValue("9");
    expect(mounted.wrapper.text()).toContain("Places measure 9.");

    await mounted.wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(dbUpdate).toHaveBeenCalledOnce();
    expect(mounted.song.findMeasureByLabel("9")?.layout).toEqual(FREE_SPOT);
    expect(mounted.texts.length).toBeGreaterThan(0);
    expect(mounted.texts.join("\n")).not.toMatch(CONFLICT);
    expect(mounted.editor.pendingBox.value).toBeUndefined();
    expect(mounted.editor.drawing.value).toBe(true);
  });

  it("keeps the drawn box when the save fails", async () => {
    vi.mocked(dbUpdate).mockRejectedValueOnce(new Error("offline"));
    const mounted = mountPanel(makeAudioSong(), ({ editor }) => editor.pendingBox.value && h(MeasureNewBoxForm, { layout: editor.pendingBox.value }));
    mounted.editor.startDrawing("9");
    mounted.editor.pendingCount.value = 1;
    mounted.editor.pendingBox.value = FREE_SPOT;
    await flushPromises();

    await mounted.wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mounted.editor.pendingBox.value).toEqual(FREE_SPOT);
    expect(mounted.editor.placeFrom.value).toBe("9");
    expect(mounted.song.findMeasureByLabel("9")).toBeUndefined();
  });

  it("still offers to shift the measures in the way", async () => {
    const mounted = mountPanel(makeAudioSong(), ({ editor }) => editor.pendingBox.value && h(MeasureNewBoxForm, { layout: editor.pendingBox.value }));
    mounted.editor.startDrawing("2");
    mounted.editor.pendingCount.value = 1;
    mounted.editor.pendingBox.value = FREE_SPOT;
    await flushPromises();
    expect(mounted.wrapper.text()).toMatch(CONFLICT);

    await mounted.wrapper.findAll("button").find(button => button.text().startsWith("Shift 2 and later"))!.trigger("click");
    await flushPromises();

    expect(mounted.song.findMeasureByLabel("2")?.layout).toEqual(FREE_SPOT);
    expect(mounted.song.getMeasures()).toHaveLength(makeAudioSong().getMeasures().length + 1);
    expect(mounted.texts.join("\n")).not.toMatch(CONFLICT);
  });
});

describe("numbering a box without a number", () => {
  it("moves on to the next item before saving the number", async () => {
    const song = makeAudioSong();
    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), unnumberedBoxes: [FREE_SPOT] });
    vi.clearAllMocks();
    const mounted = mountPanel(song, ({ selection }) => {
      const current = selection.selected.value;
      return current.kind === "boxes" ? h(MeasureUnnumberedForm, { box: current.boxes[0]! }) : undefined;
    });
    mounted.editor.showReviewItem({ layout: FREE_SPOT });
    await flushPromises();
    await mounted.wrapper.find("#box-number").setValue("9");

    await mounted.wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mounted.song.findMeasureByLabel("9")?.layout).toEqual(FREE_SPOT);
    expect(mounted.song.getUnnumberedBoxes()).toEqual([]);
    expect(mounted.texts.join("\n")).not.toMatch(CONFLICT);
    expect(mounted.selection.selection.value).toEqual({ kind: "none" });
  });
});
