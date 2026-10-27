import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { h, reactive, type Ref, ref, type SetupContext } from "vue";

import Draggable from "@/components/base/Draggable.vue";
import { type MeasureEditor, provideMeasureEditor, useMeasureEditor } from "@/composables/useMeasureEditor";
import type { MeasureId } from "@/core/models/measure";
import Song from "@/core/models/song";
import type { TimelinePosition } from "@/core/player/timeline";
import type { PlayerLocation, PlayerSectionState } from "@/core/player/types";
import { dbUpdate } from "@/pocketbase/db";
import { usePlayerStore } from "@/stores/player";
import { idOf, locationOf, makeAudioSong, makeMidiSongWithCut, makeMidiSongWithRepeat, makeMidiSongWithVamp } from "@/test/fixtures";

import ScoreViewer from "./ScoreViewer.vue";

const TICKS_PER_POSITION = 400;

const player = vi.hoisted(() => ({
  position: 0,
  timeline: [] as TimelinePosition[],
  ready: true,
  currentLocation: undefined as PlayerLocation | undefined,
  currentSection: undefined as PlayerSectionState | undefined,
  measureTrackIndices: new Map<MeasureId, Set<number>>(),
  seekPosition: vi.fn(),
  syncWarp: vi.fn(),
  load: vi.fn(),
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

vi.mock("@/core/pdf/measureDetector", () => ({ detectMeasures: vi.fn() }));

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

// The real viewer renders PDF pages on a canvas. One full-size page is enough for the overlay.
vi.mock("./PdfViewer.vue", () => ({
  default: {
    setup(_: unknown, { slots, expose }: SetupContext) {
      expose({ redrawOverlay: () => {}, redrawAll: () => {}, zoomToPage: () => {}, isLocationVisible: () => true });
      return () => slots.default?.({ visiblePages: [{ pageNumber: 0, x: 0, y: 0, width: 1, height: 1 }] });
    },
  },
}));

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function resolveTimeline(song: Song): TimelinePosition[] {
  return song.getTimeline().map((entry) => {
    const start = entry.position * TICKS_PER_POSITION;
    return { ...entry, beats: 4, beatTicks: [0, 1, 2, 3].map(beat => start + beat * 100), endTick: start + TICKS_PER_POSITION };
  });
}

function playAt(position: number, ticksIn = 0): void {
  const state = fakePlayer();
  const entry = state.timeline[position]!;
  state.currentLocation = { position, measure: entry.measure, occurrence: entry.occurrence, beat: 0 };
  state.position = position * TICKS_PER_POSITION + ticksIn;
}

function mountViewer(song: Song, editMode = false): { wrapper: VueWrapper; editor: MeasureEditor } {
  const reactiveSong = reactive(song) as Song;
  fakePlayer().timeline = resolveTimeline(song);
  let editor!: MeasureEditor;
  const host = {
    setup() {
      editor = useMeasureEditor(ref<Song | undefined>(reactiveSong) as Ref<Song | undefined>, ref(editMode));
      provideMeasureEditor(editor);
      return () => h(ScoreViewer, { song: reactiveSong, editMode });
    },
  };

  const wrapper = mount(host, { global: { plugins: [PrimeVue, ToastService] } });
  return { wrapper, editor };
}

function box(wrapper: VueWrapper, label: string): VueWrapper["element"] {
  return wrapper.find(`[role='button'][aria-label='Measure ${label}']`).element;
}

describe("ScoreViewer", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    const state = fakePlayer();
    state.currentLocation = undefined;
    state.currentSection = undefined;
    state.position = 0;
    state.measureTrackIndices = new Map();
  });

  describe("while rehearsing", () => {
    it("names the boxes by label and keys them by measure ID", () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song);

      expect(box(wrapper, "2").getAttribute("data-measure")).toBe(idOf(song, "2"));
    });

    it("marks the box of the playing measure in every pass", async () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song);

      playAt(2, 200);
      await flushPromises();
      expect(box(wrapper, "2").getAttribute("aria-current")).toBe("location");
      expect((box(wrapper, "2").querySelector("div") as HTMLElement).style.left).toBe("50%");

      playAt(4, 100);
      await flushPromises();
      expect(box(wrapper, "2").getAttribute("aria-current")).toBe("location");
      expect((box(wrapper, "2").querySelector("div") as HTMLElement).style.left).toBe("25%");
      expect(box(wrapper, "3").getAttribute("aria-current")).toBeNull();
    });

    it("jumps to the occurrence of a clicked measure that is closest to the playback", async () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song);
      playAt(7);
      await flushPromises();

      (box(wrapper, "2") as HTMLElement).click();

      expect(fakePlayer().seekPosition).toHaveBeenCalledWith(6);
    });

    it("highlights measures where a highlighted track plays", async () => {
      const song = makeMidiSongWithRepeat();
      song.tracks[1]!.mixer.highlight = true;
      fakePlayer().measureTrackIndices = new Map([[idOf(song, "3"), new Set([1])]]);
      const { wrapper } = mountViewer(song);
      await flushPromises();

      expect(box(wrapper, "3").className).toContain("bg-track-highlight/25");
      expect(box(wrapper, "2").className).not.toContain("bg-track-highlight/25");
    });
  });

  describe("arrangement overlays", () => {
    function description(wrapper: VueWrapper, label: string): string | undefined {
      const id = box(wrapper, label).getAttribute("aria-describedby");
      return id ? wrapper.find(`[id='${id}']`).text() : undefined;
    }

    it("describes the sections and recorded repeats on each box", () => {
      const { wrapper } = mountViewer(makeMidiSongWithRepeat());

      expect(description(wrapper, "2")).toBe("Repeat 2 to 3, 3 times. Recorded 3 times.");
      expect(description(wrapper, "1")).toBeUndefined();
      expect(wrapper.find("[role='img'][aria-label='Repeat 2 to 3, 3 times']").text()).toBe("Repeat 3×");
      expect(wrapper.find("[role='img'][aria-label='Measures 2 to 3 recorded 3 times']").text()).toBe("×3");
    });

    it("shows the pass of the playing section and the occurrence of the playing box", async () => {
      const { wrapper } = mountViewer(makeMidiSongWithRepeat());
      playAt(4);
      fakePlayer().currentSection = { section: 0, kind: "repeat", pass: 2, passes: 3, recordedPasses: 3, released: false };
      await flushPromises();

      expect(wrapper.find("[role='img'][aria-label='Repeat 2 to 3, pass 2 of 3']").text()).toBe("Repeat 2/3");
      expect(box(wrapper, "2").textContent).toContain("2nd time");
      expect(description(wrapper, "2")).toBe("Repeat 2 to 3, pass 2 of 3. Recorded 3 times.");
    });

    it("shows a chip where the recording jumps", async () => {
      const song = makeAudioSong();
      await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "3") }, { from: idOf(song, "1"), to: idOf(song, "2") }, { from: idOf(song, "4"), to: idOf(song, "4") }]);
      const { wrapper } = mountViewer(song);

      expect(wrapper.find("[role='img'][aria-label='After 3, the recording continues at 1, 2nd time']").text()).toBe("to 1, 2nd time");
      expect(wrapper.find("[role='img'][aria-label='After 2, 2nd time, the recording continues at 4']").text()).toBe("to 4");
      expect(description(wrapper, "2")).toBe("After 2, 2nd time, the recording continues at 4.");
    });

    it("hatches the boxes of a cut", () => {
      const song = makeMidiSongWithCut();
      const { wrapper } = mountViewer(song);

      expect(wrapper.findAll(".hatch-section-cut").length).toBeGreaterThan(0);
      expect(wrapper.find("[role='img'][aria-label^='Cut']").text()).toBe("Cut");
    });
  });

  describe("while editing", () => {
    it("labels each box with its measure label", () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song, true);

      expect(box(wrapper, "2").textContent?.trim()).toBe("2");
    });

    it("selects a clicked measure and moves the playhead to its nearest occurrence", async () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper, editor } = mountViewer(song, true);
      playAt(7);
      await flushPromises();

      (box(wrapper, "2") as HTMLElement).click();

      expect(editor.selection.value.map(measure => measure.label)).toEqual(["2"]);
      expect(fakePlayer().seekPosition).toHaveBeenCalledWith(6);
    });

    it("does not move the playhead when a ctrl-click takes a measure out of the selection", async () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper, editor } = mountViewer(song, true);
      editor.setSelection([song.findMeasure(idOf(song, "1"))!, song.findMeasure(idOf(song, "2"))!]);
      await flushPromises();

      box(wrapper, "2").dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true }));

      expect(editor.selection.value.map(measure => measure.label)).toEqual(["1"]);
      expect(fakePlayer().seekPosition).not.toHaveBeenCalled();
    });

    describe("section range handles", () => {
      function handle(wrapper: VueWrapper, name: string): VueWrapper["element"] {
        return wrapper.find(`[role='slider'][aria-label='${name}']`).element;
      }

      it("appear on the section the selection belongs to and name its ends", async () => {
        const song = makeMidiSongWithRepeat();
        const { wrapper, editor } = mountViewer(song, true);
        playAt(5);
        editor.selectOnly(song.findMeasure(idOf(song, "3"))!);
        await flushPromises();

        const last = handle(wrapper, "Last measure of repeat 2 to 3");
        expect(last.getAttribute("aria-valuetext")).toBe("3, 1st time");
        expect(last.getAttribute("aria-valuenow")).toBe("4");
        expect(handle(wrapper, "First measure of repeat 2 to 3").getAttribute("aria-valuetext")).toBe("2, 1st time");
      });

      it("move the section by one measure with the arrow keys", async () => {
        const song = makeMidiSongWithVamp();
        const { wrapper, editor } = mountViewer(song, true);
        editor.selectSection(0);
        await flushPromises();

        handle(wrapper, "Last measure of vamp 2").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        await flushPromises();
        expect(song.getSections()[0]).toMatchObject({ from: locationOf(song, "2"), to: locationOf(song, "3", 3) });

        handle(wrapper, "First measure of vamp 2 to 3").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
        await flushPromises();
        expect(song.getSections()[0]).toMatchObject({ from: locationOf(song, "0"), to: locationOf(song, "3", 3) });
        expect(dbUpdate).toHaveBeenCalledTimes(2);
        expect(editor.selection.value.map(measure => measure.label)).toEqual(["0", "1", "2", "3"]);
      });

      it("are not shown without a section to edit", async () => {
        const song = makeMidiSongWithVamp();
        const { wrapper, editor } = mountViewer(song, true);
        editor.selectOnly(song.findMeasure(idOf(song, "1"))!);
        await flushPromises();

        expect(wrapper.find("[role='slider']").exists()).toBe(false);
      });
    });

    it("previews detected boxes in place of the measures they replace", async () => {
      const song = makeAudioSong();
      const { wrapper, editor } = mountViewer(song, true);
      const layout = { page: 0, x: 0.1, y: 0.5, width: 0.2, height: 0.1 };
      editor.detection.replacePlaced.value = true;
      editor.detection.detected.value = [
        { value: "2", layout, confidence: 1 },
        { value: "9", layout: { ...layout, x: 0.4 }, confidence: 1 },
        { value: "", layout: { ...layout, x: 0.7 }, confidence: 1 },
      ];
      await flushPromises();

      const previews = wrapper.findAll("[role='img']").map(preview => preview.attributes("aria-label"));
      expect(previews).toEqual(["Detected measure 2", "Detected measure 9", "Detected box without a number"]);
      expect(wrapper.find("[role='button'][aria-label='Measure 2']").exists()).toBe(false);
      expect(wrapper.find("[role='button'][aria-label='Measure 1']").exists()).toBe(true);
    });

    it("saves a resize as one layout edit once the drag ends", async () => {
      const song = makeMidiSongWithRepeat();
      const apply = vi.spyOn(song, "applyMeasureEdit").mockResolvedValue([]);
      const { wrapper, editor } = mountViewer(song, true);
      const measure = song.findMeasure(idOf(song, "2"))!;
      const neighbour = song.findMeasure(idOf(song, "3"))!;
      const before = { measure: { ...measure.layout! }, neighbour: { ...neighbour.layout! } };
      editor.selectOnly(measure);
      await flushPromises();

      const right = wrapper.findAllComponents(Draggable)[1]!;
      right.vm.$emit("drag", { delta: { x: 5, y: 0 } });
      right.vm.$emit("drag", { delta: { x: 5, y: 0 } });
      await flushPromises();
      expect(apply).not.toHaveBeenCalled();
      expect(measure.layout).toEqual(before.measure);

      right.vm.$emit("dragend");
      await flushPromises();

      expect(apply).toHaveBeenCalledTimes(1);
      const edit = apply.mock.calls[0]![0];
      expect(edit.layouts.get(measure.id)?.width).toBeCloseTo(before.measure.width + 0.1);
      expect(edit.layouts.get(neighbour.id)?.x).toBeCloseTo(before.neighbour.x + 0.1);
      expect(edit.layouts.get(neighbour.id)?.width).toBeCloseTo(before.neighbour.width - 0.1);
      expect([...edit.layouts.keys()]).toEqual([measure.id, neighbour.id]);
      expect(editor.selection.value.map(selected => selected.id)).toEqual([measure.id]);
    });
  });
});
