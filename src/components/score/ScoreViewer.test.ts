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
import type { PlayerLocation } from "@/core/player/types";
import { usePlayerStore } from "@/stores/player";
import { idOf, makeAudioSong, makeMidiSongWithRepeat } from "@/test/fixtures";

import ScoreViewer from "./ScoreViewer.vue";

const TICKS_PER_POSITION = 400;

const player = vi.hoisted(() => ({
  position: 0,
  timeline: [] as TimelinePosition[],
  currentLocation: undefined as PlayerLocation | undefined,
  measureTrackIndices: new Map<MeasureId, Set<number>>(),
  seekPosition: vi.fn(),
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

      expect(box(wrapper, "3").className).toContain("bg-sky-400/25");
      expect(box(wrapper, "2").className).not.toContain("bg-sky-400/25");
    });
  });

  describe("while editing", () => {
    it("labels each box with its measure label", () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song, true);

      expect(box(wrapper, "2").textContent?.trim()).toBe("2");
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
