import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { h, reactive, type Ref, ref, type SetupContext } from "vue";

import { provideSongEditor, type SongEditor } from "@/composables/useSongEditor";
import { selectMeasures } from "@/core/models/selection";
import Song from "@/core/models/song";
import type { TimelinePosition } from "@/core/player/timeline";
import type { PlayerLocation, PlayerSectionState } from "@/core/player/types";
import { dbUpdate } from "@/pocketbase/db";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { idOf, locationOf, makeAudioSong, makeMidiSongWithCut, makeMidiSongWithRepeat, makeMidiSongWithVamp } from "@/test/fixtures";

import BoxResizeHandle from "./BoxResizeHandle.vue";
import ScoreViewer from "./ScoreViewer.vue";

const TICKS_PER_POSITION = 400;

const player = vi.hoisted(() => ({
  position: 0,
  timeline: [] as TimelinePosition[],
  ready: true,
  currentLocation: undefined as PlayerLocation | undefined,
  currentTimelinePosition: undefined as TimelinePosition | undefined,
  currentSection: undefined as PlayerSectionState | undefined,
  seekPosition: vi.fn(),
  seekLocation: vi.fn(),
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
      expose({ redraw: () => {}, zoomToPage: () => {}, isLocationVisible: () => true });
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
  state.currentTimelinePosition = entry;
  state.position = position * TICKS_PER_POSITION + ticksIn;
}

function mountViewer(song: Song, editMode = false): SongEditor & { wrapper: VueWrapper } {
  const reactiveSong = reactive(song) as Song;
  fakePlayer().timeline = resolveTimeline(song);
  let context!: SongEditor;
  const host = {
    setup() {
      context = provideSongEditor(ref<Song | undefined>(reactiveSong) as Ref<Song | undefined>, ref(editMode));
      return () => h(ScoreViewer, { song: reactiveSong, editMode });
    },
  };

  const wrapper = mount(host, { global: { plugins: [PrimeVue, ToastService] } });
  return { wrapper, ...context };
}

function selectedLabels({ selection }: SongEditor): string[] {
  const current = selection.selected.value;
  return current.kind === "measures" ? current.measures.map(measure => measure.label) : [];
}

function click(element: Element, init: MouseEventInit = {}): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
}

function box(wrapper: VueWrapper, label: string): VueWrapper["element"] {
  return wrapper.find(`[role='button'][aria-label='Measure ${label}']`).element;
}

/** The box with its badges and playbar around it. */
function frame(wrapper: VueWrapper, label: string): HTMLElement {
  return (box(wrapper, label) as HTMLElement).closest<HTMLElement>("[data-measure]")!;
}

function playbar(wrapper: VueWrapper, label: string): HTMLElement {
  return frame(wrapper, label).querySelector<HTMLElement>("[style*='left']")!;
}

/** The short texts on a box, which screen readers hear through its name and description instead. */
function badgeTexts(wrapper: VueWrapper, label: string): string[] {
  return [...frame(wrapper, label).querySelectorAll("[aria-hidden='true']")].map(badge => badge.textContent!.trim()).filter(text => text);
}

describe("ScoreViewer", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
  });

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
    const state = fakePlayer();
    state.currentLocation = undefined;
    state.currentTimelinePosition = undefined;
    state.currentSection = undefined;
    state.position = 0;
  });

  describe("while rehearsing", () => {
    it("names the boxes by label and keys them by measure ID", () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song);

      expect(frame(wrapper, "2").getAttribute("data-measure")).toBe(idOf(song, "2"));
    });

    it("marks the box of the playing measure in every pass", async () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song);

      playAt(2, 200);
      await flushPromises();
      expect(box(wrapper, "2").getAttribute("aria-current")).toBe("location");
      expect(playbar(wrapper, "2").style.left).toBe("50%");

      playAt(4, 100);
      await flushPromises();
      expect(box(wrapper, "2").getAttribute("aria-current")).toBe("location");
      expect(playbar(wrapper, "2").style.left).toBe("25%");
      expect(box(wrapper, "3").getAttribute("aria-current")).toBeNull();
    });

    it("enters a clicked measure at its first pass, wherever the playback is", async () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song);
      playAt(7);
      await flushPromises();

      click(box(wrapper, "2"));

      expect(fakePlayer().seekLocation).toHaveBeenCalledWith({ measure: idOf(song, "2"), occurrence: 1, beat: 0 });
    });
  });

  describe("arrangement overlays", () => {
    function description(wrapper: VueWrapper, label: string): string | undefined {
      const id = box(wrapper, label).getAttribute("aria-describedby");
      return id ? wrapper.find(`[id='${id}']`).text() : undefined;
    }

    it("describes the sections on each box and shows no badge for recorded repeats", () => {
      const { wrapper } = mountViewer(makeMidiSongWithRepeat());

      expect(description(wrapper, "2")).toBe("Repeat 2 to 3, 3 times.");
      expect(description(wrapper, "1")).toBeUndefined();
      expect(wrapper.find("button[aria-label='Repeat 2 to 3, 3 times']").text()).toBe("Repeat 3×");
      expect(badgeTexts(wrapper, "3")).toEqual([]);
    });

    it("shows the same section badges and no pass while a section plays", async () => {
      const { wrapper } = mountViewer(makeMidiSongWithRepeat());
      playAt(4);
      fakePlayer().currentSection = { section: 0, kind: "repeat", pass: 2, passes: 3, recordedPasses: 3, released: false };
      await flushPromises();

      expect(wrapper.find("button[aria-label='Repeat 2 to 3, 3 times']").text()).toBe("Repeat 3×");
      expect(badgeTexts(wrapper, "2")).not.toContain("2nd time");
      expect(description(wrapper, "2")).toBe("Repeat 2 to 3, 3 times.");
    });

    it("shows a chip where the recording jumps only in edit mode", async () => {
      const song = makeAudioSong();
      await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "3") }, { from: idOf(song, "1"), to: idOf(song, "2") }, { from: idOf(song, "4"), to: idOf(song, "4") }]);
      expect(description(mountViewer(song).wrapper, "2")).toBeUndefined();

      const { wrapper } = mountViewer(song, true);

      expect(wrapper.find("[role='img'][aria-label='After 3, the recording continues at 1, 2nd time']").text()).toBe("to 1, 2nd time");
      expect(wrapper.find("[role='img'][aria-label='After 2, 2nd time, the recording continues at 4']").text()).toBe("to 4");
      expect(description(wrapper, "2")).toBe("After 2, 2nd time, the recording continues at 4.");
    });

    it("moves the playhead to a section or marker whose badge is clicked", async () => {
      const song = makeMidiSongWithRepeat();
      await song.editLayers({ markers: [{ at: locationOf(song, "3"), text: "A" }] });
      const { wrapper, selection } = mountViewer(song);

      click(wrapper.find("button[aria-label='Repeat 2 to 3, 3 times']").element);
      expect(fakePlayer().seekLocation).toHaveBeenLastCalledWith(song.getSections()[0]!.from);

      click(wrapper.find("button[aria-label='Marker A, 1st time']").element);
      expect(fakePlayer().seekLocation).toHaveBeenLastCalledWith(locationOf(song, "3"));
      expect(selection.selection.value).toEqual({ kind: "none" });
    });

    it("hatches the boxes of a cut without a bar, which only editors select by", () => {
      const song = makeMidiSongWithCut();

      const rehearsing = mountViewer(song).wrapper;
      expect(rehearsing.findAll(".hatch-section-cut").length).toBeGreaterThan(0);
      expect(rehearsing.find("button[aria-label^='Cut']").exists()).toBe(false);

      const editing = mountViewer(song, true).wrapper;
      expect(editing.find("button[aria-label^='Cut']").text()).toBe("Cut");
    });

    it("hides sections while rehearsing when they are turned off, but not while editing", () => {
      useSettingsStore().update({ appearance: { arrangementVisible: { cut: false } } });
      const song = makeMidiSongWithCut();

      const rehearsing = mountViewer(song).wrapper;
      expect(rehearsing.findAll(".hatch-section-cut")).toHaveLength(0);

      const editing = mountViewer(song, true).wrapper;
      expect(editing.findAll(".hatch-section-cut").length).toBeGreaterThan(0);
    });

    it("hides markers while rehearsing when they are turned off, but not while editing", async () => {
      const song = makeMidiSongWithRepeat();
      await song.editLayers({ markers: [{ at: locationOf(song, "3"), text: "A" }] });
      const marker = "button[aria-label='Marker A, 1st time']";

      expect(mountViewer(song).wrapper.find(marker).exists()).toBe(true);

      useSettingsStore().update({ appearance: { arrangementVisible: { marker: false } } });
      expect(mountViewer(song).wrapper.find(marker).exists()).toBe(false);
      expect(mountViewer(song, true).wrapper.find(marker).exists()).toBe(true);
    });
  });

  describe("while editing", () => {
    it("labels each box with its measure label", () => {
      const song = makeMidiSongWithRepeat();
      const { wrapper } = mountViewer(song, true);

      expect(badgeTexts(wrapper, "2")).toEqual(["2"]);
    });

    it("selects the section or marker of a clicked badge, not the box below it", async () => {
      const song = makeMidiSongWithRepeat();
      await song.editLayers({ markers: [{ at: locationOf(song, "3"), text: "A" }] });
      const { wrapper, selection } = mountViewer(song, true);

      click(wrapper.find("button[aria-label='Repeat 2 to 3, 3 times']").element);
      await flushPromises();
      expect(selection.selection.value).toEqual({ kind: "section", from: song.getSections()[0]!.from });
      expect(wrapper.find("button[aria-label='Repeat 2 to 3, 3 times']").attributes("aria-pressed")).toBe("true");

      click(wrapper.find("button[aria-label='Marker A, 1st time']").element);
      await flushPromises();
      expect(selection.selection.value).toEqual({ kind: "marker", marker: song.getMarkers()[0] });
      expect(fakePlayer().seekLocation).toHaveBeenLastCalledWith(locationOf(song, "3"));
    });

    it("leaves a click on any other badge to its box", async () => {
      const song = makeMidiSongWithRepeat();
      const context = mountViewer(song, true);

      const label = [...frame(context.wrapper, "3").querySelectorAll("[aria-hidden='true']")].find(badge => badge.textContent?.trim() === "3")!;
      click(label);

      expect(selectedLabels(context)).toEqual(["3"]);
    });

    it("selects a clicked measure and enters it at its first pass", async () => {
      const song = makeMidiSongWithRepeat();
      const context = mountViewer(song, true);
      playAt(7);
      await flushPromises();

      click(box(context.wrapper, "2"));

      expect(selectedLabels(context)).toEqual(["2"]);
      expect(fakePlayer().seekLocation).toHaveBeenCalledWith({ measure: idOf(song, "2"), occurrence: 1, beat: 0 });
    });

    it("toggles with ctrl-click and moves the playhead only to measures it adds", async () => {
      const song = makeMidiSongWithRepeat();
      const context = mountViewer(song, true);
      context.selection.select(selectMeasures([idOf(song, "1"), idOf(song, "2")]));
      await flushPromises();

      click(box(context.wrapper, "2"), { ctrlKey: true });
      expect(selectedLabels(context)).toEqual(["1"]);
      expect(fakePlayer().seekLocation).not.toHaveBeenCalled();

      click(box(context.wrapper, "3"), { metaKey: true });
      expect(selectedLabels(context)).toEqual(["1", "3"]);
      expect(fakePlayer().seekLocation).toHaveBeenCalledOnce();
    });

    it("selects a range in reading order with shift-click", async () => {
      const song = makeMidiSongWithRepeat();
      const context = mountViewer(song, true);

      click(box(context.wrapper, "3"));
      click(box(context.wrapper, "1"), { shiftKey: true });

      expect(selectedLabels(context)).toEqual(["1", "2", "3"]);
    });

    describe("selection box", () => {
      // Boxes are placed in percent of the page, which these tests make 100 pixels square.
      function mockLayoutRects(): void {
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
          if (!this.dataset.measure) {
            return new DOMRect(0, 0, 100, 100);
          }

          const { left, top, width, height } = this.style;
          return new DOMRect(Number.parseFloat(left), Number.parseFloat(top), Number.parseFloat(width), Number.parseFloat(height));
        });
      }

      function drag(overlay: HTMLElement, from: [number, number], to: [number, number], init: PointerEventInit = {}): void {
        const options = { pointerType: "mouse", pointerId: 1, button: 0, shiftKey: true, bubbles: true, ...init };
        overlay.dispatchEvent(new PointerEvent("pointerdown", { ...options, clientX: from[0], clientY: from[1], buttons: 1 }));
        overlay.dispatchEvent(new PointerEvent("pointermove", { ...options, clientX: to[0], clientY: to[1], buttons: 1 }));
      }

      /** The overlay once its listeners are attached, which happens after the render. */
      async function overlayOf(wrapper: VueWrapper): Promise<HTMLElement> {
        await flushPromises();
        const overlay = wrapper.find("[role='group'][aria-label='Page 1']").element.parentElement!;
        // jsdom has no pointer capture.
        overlay.setPointerCapture = vi.fn();
        overlay.hasPointerCapture = vi.fn(() => false);
        return overlay;
      }

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("selects the measures a shift drag touches, and swallows the click ending it", async () => {
        mockLayoutRects();
        const song = makeMidiSongWithRepeat();
        const context = mountViewer(song, true);
        const overlay = await overlayOf(context.wrapper);
        click(box(context.wrapper, "4"));

        drag(overlay, [20, 5], [50, 20]);
        expect(selectedLabels(context)).toEqual(["1", "2"]);
        await flushPromises();
        expect(context.wrapper.find("[aria-hidden='true'].outline-primary").exists()).toBe(true);

        overlay.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", pointerId: 1, bubbles: true }));
        click(box(context.wrapper, "2"), { shiftKey: true });
        expect(selectedLabels(context)).toEqual(["1", "2"]);
      });

      it("adds to the selection with ctrl, and Escape restores the selection before it", async () => {
        mockLayoutRects();
        const song = makeMidiSongWithRepeat();
        const context = mountViewer(song, true);
        const overlay = await overlayOf(context.wrapper);
        click(box(context.wrapper, "4"));

        drag(overlay, [20, 5], [30, 20], { ctrlKey: true });
        expect(selectedLabels(context)).toEqual(["1", "4"]);

        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(selectedLabels(context)).toEqual(["4"]);
      });

      it("leaves a shift press without movement to the shift-click", async () => {
        mockLayoutRects();
        const song = makeMidiSongWithRepeat();
        const context = mountViewer(song, true);
        const overlay = await overlayOf(context.wrapper);
        click(box(context.wrapper, "1"));

        drag(overlay, [40, 5], [41, 5]);
        click(box(context.wrapper, "3"), { shiftKey: true });
        expect(selectedLabels(context)).toEqual(["1", "2", "3"]);
      });
    });

    it("selects one kind at a time", async () => {
      const song = makeMidiSongWithVamp();
      const context = mountViewer(song, true);
      context.selection.select({ kind: "section", from: song.getSections()[0]!.from });
      await flushPromises();

      click(box(context.wrapper, "2"), { ctrlKey: true });

      expect(context.selection.selection.value).toEqual(selectMeasures([idOf(song, "2")]));
    });

    it("clears the selection with a click on empty space, but not with a modifier", async () => {
      const song = makeMidiSongWithRepeat();
      const context = mountViewer(song, true);
      click(box(context.wrapper, "2"));
      const page = context.wrapper.find("[role='group'][aria-label='Page 1']").element;

      click(page, { shiftKey: true });
      expect(selectedLabels(context)).toEqual(["2"]);

      click(page);
      expect(context.selection.selection.value).toEqual({ kind: "none" });
    });

    it("draws a box only while drawing, and Escape steps back from it", async () => {
      const song = makeAudioSong();
      const context = mountViewer(song, true);
      expect(context.wrapper.find(".cursor-crosshair").exists()).toBe(false);

      context.editor.startDrawing();
      await flushPromises();
      const layer = context.wrapper.find(".cursor-crosshair").element as HTMLElement;
      // jsdom has no pointer capture.
      layer.setPointerCapture = vi.fn();
      const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
      layer.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, buttons: 1, pointerId: 1 }));
      layer.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 20, buttons: 1, pointerId: 1 }));
      layer.dispatchEvent(new PointerEvent("pointerup", { clientX: 40, clientY: 20, buttons: 0, pointerId: 1 }));

      rect.mockRestore();
      expect(context.editor.pendingBox.value).toEqual({ page: 0, x: 0.1, y: 0.1, width: expect.closeTo(0.3), height: expect.closeTo(0.1) });

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(context.editor.pendingBox.value).toBeUndefined();
      expect(context.editor.drawing.value).toBe(true);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(context.editor.drawing.value).toBe(false);
    });

    describe("section range handles", () => {
      function handle(wrapper: VueWrapper, name: string): VueWrapper["element"] {
        return wrapper.find(`[role='slider'][aria-label='${name}']`).element;
      }

      it("appear on the selected section and name its ends", async () => {
        const song = makeMidiSongWithRepeat();
        const { wrapper, selection } = mountViewer(song, true);
        selection.select({ kind: "section", from: song.getSections()[0]!.from });
        await flushPromises();

        const last = handle(wrapper, "Last measure of repeat 2 to 3");
        expect(last.getAttribute("aria-valuetext")).toBe("3, 1st time");
        expect(last.getAttribute("aria-valuenow")).toBe("4");
        expect(handle(wrapper, "First measure of repeat 2 to 3").getAttribute("aria-valuetext")).toBe("2, 1st time");
      });

      it("move the section by one measure with the arrow keys", async () => {
        const song = makeMidiSongWithVamp();
        const { wrapper, selection } = mountViewer(song, true);
        selection.select({ kind: "section", from: song.getSections()[0]!.from });
        await flushPromises();

        handle(wrapper, "Last measure of vamp 2").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        await flushPromises();
        expect(song.getSections()[0]).toMatchObject({ from: locationOf(song, "2"), to: locationOf(song, "3", 3) });

        handle(wrapper, "First measure of vamp 2 to 3").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
        await flushPromises();
        expect(song.getSections()[0]).toMatchObject({ from: locationOf(song, "0"), to: locationOf(song, "3", 3) });
        expect(dbUpdate).toHaveBeenCalledTimes(2);
        expect(selection.selection.value).toEqual({ kind: "section", from: locationOf(song, "0") });
      });

      it("are not shown while the measures of a section are selected", async () => {
        const song = makeMidiSongWithVamp();
        const { wrapper, selection } = mountViewer(song, true);
        selection.select(selectMeasures([idOf(song, "2")]));
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
      const context = mountViewer(song, true);
      const { wrapper } = context;
      const measure = song.findMeasure(idOf(song, "2"))!;
      const neighbour = song.findMeasure(idOf(song, "3"))!;
      const before = { measure: { ...measure.layout! }, neighbour: { ...neighbour.layout! } };
      context.selection.select(selectMeasures([measure.id]));
      await flushPromises();

      const right = wrapper.findAllComponents(BoxResizeHandle)[1]!.element as HTMLElement;
      // jsdom has no pointer capture.
      right.setPointerCapture = vi.fn();
      right.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, buttons: 1, pointerId: 1 }));
      right.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 0, buttons: 1, pointerId: 1 }));
      right.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, buttons: 1, pointerId: 1 }));
      await flushPromises();
      expect(apply).not.toHaveBeenCalled();
      expect(measure.layout).toEqual(before.measure);

      right.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 0, buttons: 0, pointerId: 1 }));
      await flushPromises();

      expect(apply).toHaveBeenCalledTimes(1);
      const edit = apply.mock.calls[0]![0];
      expect(edit.layouts.get(measure.id)?.width).toBeCloseTo(before.measure.width + 0.1);
      expect(edit.layouts.get(neighbour.id)?.x).toBeCloseTo(before.neighbour.x + 0.1);
      expect(edit.layouts.get(neighbour.id)?.width).toBeCloseTo(before.neighbour.width - 0.1);
      expect([...edit.layouts.keys()]).toEqual([measure.id, neighbour.id]);
      expect(context.selection.selection.value).toEqual(selectMeasures([measure.id]));
    });
  });
});
