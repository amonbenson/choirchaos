import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, reactive, type Ref, ref } from "vue";

import { provideSongEditor, type SongEditor } from "@/composables/useSongEditor";
import type { SongHistoryControls } from "@/composables/useSongHistory";
import { addMarker } from "@/core/models/markers";
import { selectMeasures } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { dbUpdate } from "@/pocketbase/db";
import { usePlayerStore } from "@/stores/player";
import { idOf, locationOf, makeAudioSongWithRepeat, makeMidiSong, makeMidiSongWithRepeat } from "@/test/fixtures";

import SongEditorPanel from "./SongEditorPanel.vue";

const POSITION_MS = 250;

type FakePosition = { position: number; beatTicks: number[]; endTick: number };

const player = vi.hoisted(() => ({
  ready: true,
  position: 0,
  currentLocation: undefined as { position: number; measure: string; occurrence: number; beat: number } | undefined,
  duration: 2000,
  timeline: [] as FakePosition[],
  seekPosition: (() => {}) as (position: number) => void,
  seekLocation: (() => {}) as (location: unknown) => void,
}));

vi.mock("@/stores/player", async () => {
  const { reactive } = await import("vue");
  const state = reactive(player);
  return { usePlayerStore: () => state };
});

/** The mocked store, which tests change to move the playhead. */
const fakePlayer = (): typeof player => usePlayerStore() as unknown as typeof player;

vi.mock("@/core/pdf/measureDetector", () => ({ detectMeasures: vi.fn() }));

const confirmation = vi.hoisted(() => ({
  messages: [] as string[],
  require: (() => {}) as (options: { message: string; accept: () => void; reject?: () => void }) => void,
}));

vi.mock("primevue/useconfirm", () => ({ useConfirm: () => confirmation }));

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

// PrimeVue's Select and the bottom sheet query media features, which jsdom does not implement.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

const HISTORY = { canUndo: ref(false), canRedo: ref(false), undo: vi.fn(), redo: vi.fn() } as unknown as SongHistoryControls;

type Mounted = SongEditor & { wrapper: VueWrapper; song: Song };

const mounted: VueWrapper[] = [];

function mountPanel(original: Song): Mounted {
  const song = reactive(original) as Song;
  player.timeline = song.getTimeline().map(({ position }) => ({ position, beatTicks: [position * POSITION_MS], endTick: (position + 1) * POSITION_MS }));
  let context!: SongEditor;
  const host = {
    setup() {
      context = provideSongEditor(ref<Song | undefined>(song) as Ref<Song | undefined>, ref(true));
      return () => h(SongEditorPanel, { song, history: HISTORY });
    },
  };

  const wrapper = mount(host, {
    global: { plugins: [PrimeVue, ToastService], directives: { tooltip: Tooltip } },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { wrapper, song, ...context };
}

function title(wrapper: VueWrapper): string {
  return wrapper.find("h2").text();
}

function button(wrapper: VueWrapper, name: string): ReturnType<VueWrapper["find"]> {
  const found = wrapper.findAll("button").find(element => (element.attributes("aria-label") ?? element.text()) === name);
  if (!found) {
    throw new Error(`No button "${name}" in: ${wrapper.text()}`);
  }

  return found;
}

function region(wrapper: VueWrapper, name: string): VueWrapper["element"] | undefined {
  return wrapper.findAll("section").find(section => section.find("h3").exists() && section.find("h3").text() === name)?.element;
}

async function select(mounted: Mounted, labels: string[]): Promise<void> {
  mounted.selection.select(selectMeasures(labels.map(label => idOf(mounted.song, label))));
  await flushPromises();
}

describe("SongEditorPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    player.position = 0;
    player.currentLocation = undefined;
    player.seekPosition = vi.fn();
    player.seekLocation = vi.fn();
    confirmation.messages = [];
    confirmation.require = vi.fn((options) => {
      confirmation.messages.push(options.message);
      options.accept();
    });
  });

  afterEach(() => {
    mounted.splice(0).forEach(wrapper => wrapper.unmount());
    vi.clearAllMocks();
  });

  it("shows the setup overview with nothing selected", () => {
    const { wrapper } = mountPanel(makeMidiSong());

    expect(title(wrapper)).toBe("Song setup");
    expect(wrapper.text()).toContain("Setup checklist");
  });

  describe("with measures selected", () => {
    it("shows only the groups that apply to them", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      await select(mounted, ["2", "3"]);

      expect(title(mounted.wrapper)).toBe("Measures 2 to 3");
      expect(region(mounted.wrapper, "Section")).toBeDefined();
      expect(region(mounted.wrapper, "Markers")).toBeDefined();
      expect(region(mounted.wrapper, "Recording")).toBeUndefined();
      expect(region(mounted.wrapper, "Audio sync")).toBeUndefined();
      expect(mounted.wrapper.text()).toContain("Part of Repeat 2 to 3");

      await select(mounted, ["1", "3"]);
      expect(title(mounted.wrapper)).toBe("2 measures");
      expect(region(mounted.wrapper, "Section")).toBeUndefined();
    });

    it("links to the section they belong to, which then is the whole selection", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      await select(mounted, ["3"]);

      await button(mounted.wrapper, "Select repeat 2 to 3").trigger("click");

      expect(mounted.selection.selection.value).toEqual({ kind: "section", from: locationOf(mounted.song, "2") });
      expect(title(mounted.wrapper)).toBe("Repeat 2 to 3");
    });

    it("makes a section on the pass at the playhead and selects it", async () => {
      const mounted = mountPanel(makeMidiSong());
      await select(mounted, ["1", "2"]);

      await button(mounted.wrapper, "Vamp").trigger("click");
      await flushPromises();

      const vamp = { kind: "vamp", from: locationOf(mounted.song, "1"), to: locationOf(mounted.song, "2", 3), out: "onEnd", vocals: "all" };
      expect(mounted.song.getSections()).toEqual([vamp]);
      expect(mounted.selection.selection.value).toEqual({ kind: "section", from: vamp.from });
    });

    it("asks before a new section replaces the ones it overlaps", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      fakePlayer().currentLocation = { position: 7, measure: idOf(mounted.song, "3"), occurrence: 3, beat: 0 };
      await select(mounted, ["3", "4"]);

      await button(mounted.wrapper, "Cut").trigger("click");
      await flushPromises();

      expect(confirmation.messages).toEqual(["These measures overlap repeat 2 to 3. Replace it with a cut?"]);
      expect(mounted.song.getSections()).toMatchObject([{ kind: "cut", from: locationOf(mounted.song, "3", 0, 3) }]);
      expect(dbUpdate).toHaveBeenCalledOnce();
    });

    it("picks another pass by moving the playhead", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      await select(mounted, ["2"]);

      await button(mounted.wrapper, "3rd time").trigger("click");

      expect(player.seekPosition).toHaveBeenCalledWith(6);
    });

    it("deletes measures of an audio song and only takes those of a MIDI song off the score", async () => {
      const audio = mountPanel(makeAudioSongWithRepeat());
      await select(audio, ["4"]);
      await button(audio.wrapper, "Delete measure 4").trigger("click");
      await flushPromises();

      expect(audio.song.findMeasureByLabel("4")).toBeUndefined();
      expect(confirmation.messages[0]).toContain("will be deleted from the song and the score");
      expect(audio.selection.selection.value).toEqual({ kind: "none" });

      const midi = mountPanel(makeMidiSong());
      await select(midi, ["1", "2"]);
      await button(midi.wrapper, "Delete measures 1 to 2").trigger("click");
      await flushPromises();

      expect(midi.song.findMeasureByLabel("1")?.layout).toBeUndefined();
      expect(midi.song.findMeasureByLabel("2")?.layout).toBeUndefined();
      expect(confirmation.messages[1]).toContain("Not on the score");
    });

    it("adds a marker and selects it with its name ready to type", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      fakePlayer().currentLocation = { position: 4, measure: idOf(mounted.song, "2"), occurrence: 2, beat: 0 };
      await select(mounted, ["2"]);

      await button(mounted.wrapper, "Add marker at 2, 2nd time").trigger("click");
      await flushPromises();

      const marker = { at: locationOf(mounted.song, "2", 0, 2), text: "A" };
      expect(mounted.song.getMarkers()).toEqual([marker]);
      expect(mounted.selection.selection.value).toEqual({ kind: "marker", marker });
      expect(document.activeElement?.id).toBe("marker-name");
    });

    it("links to the sync point of the pass at the playhead in audio songs", async () => {
      const mounted = mountPanel(makeAudioSongWithRepeat());
      await select(mounted, ["3"]);

      expect(region(mounted.wrapper, "Recording")).toBeDefined();
      await button(mounted.wrapper, "Select sync point at 3, 1st time").trigger("click");

      expect(mounted.selection.selection.value).toEqual({ kind: "syncPoint", occurrence: { measure: idOf(mounted.song, "3"), occurrence: 1 } });
      expect(title(mounted.wrapper)).toBe("Sync point at 3, 1st time");
    });
  });

  describe("with a section selected", () => {
    it("edits the passes of a repeat", async () => {
      vi.useFakeTimers();
      const mounted = mountPanel(makeMidiSongWithRepeat());
      mounted.selection.select({ kind: "section", from: locationOf(mounted.song, "2") });
      await flushPromises();

      mounted.wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", 5);
      await vi.advanceTimersByTimeAsync(500);
      await flushPromises();
      vi.useRealTimers();

      expect(mounted.song.getSections()[0]).toMatchObject({ kind: "repeat", passes: 5 });
      expect(mounted.selection.selected.value.kind).toBe("section");
    });

    it("changes the kind and stays selected", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      mounted.selection.select({ kind: "section", from: locationOf(mounted.song, "2") });
      await flushPromises();

      await mounted.wrapper.findAll("[aria-label='Kind'] button").find(element => element.text() === "Vamp")!.trigger("click");
      await flushPromises();

      expect(mounted.song.getSections()[0]).toMatchObject({ kind: "vamp", from: locationOf(mounted.song, "2") });
      expect(title(mounted.wrapper)).toBe("Vamp 2 to 3");
    });

    it("removes the section after asking", async () => {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      mounted.selection.select({ kind: "section", from: locationOf(mounted.song, "2") });
      await flushPromises();

      await button(mounted.wrapper, "Remove section").trigger("click");
      await flushPromises();

      expect(confirmation.messages).toEqual(["Remove repeat 2 to 3? These measures will play as recorded."]);
      expect(mounted.song.getSections()).toEqual([]);
      expect(title(mounted.wrapper)).toBe("Song setup");
    });
  });

  describe("with a marker selected", () => {
    async function mountWithMarker(): Promise<Mounted> {
      const mounted = mountPanel(makeMidiSongWithRepeat());
      const marker = { at: locationOf(mounted.song, "2"), text: "A" };
      await mounted.song.editLayers({ markers: addMarker(mounted.song.getMarkers(), marker) });
      mounted.selection.select({ kind: "marker", marker });
      await flushPromises();
      return mounted;
    }

    it("renames it and keeps it selected", async () => {
      const mounted = await mountWithMarker();
      expect(title(mounted.wrapper)).toBe("Marker A");

      const name = mounted.wrapper.find("#marker-name");
      (name.element as HTMLInputElement).value = "Chorus";
      await name.trigger("keydown", { key: "Enter" });
      await flushPromises();

      expect(mounted.song.getMarkers()).toEqual([{ at: locationOf(mounted.song, "2"), text: "Chorus" }]);
      expect(title(mounted.wrapper)).toBe("Marker Chorus");
    });

    it("moves it to the playhead", async () => {
      const mounted = await mountWithMarker();
      fakePlayer().currentLocation = { position: 5, measure: idOf(mounted.song, "3"), occurrence: 2, beat: 2 };
      await flushPromises();

      await button(mounted.wrapper, "Move to playhead").trigger("click");
      await flushPromises();

      expect(mounted.song.getMarkers()).toEqual([{ at: locationOf(mounted.song, "3", 2, 2), text: "A" }]);
      expect(mounted.wrapper.text()).toContain("3, 2nd time, 3rd beat");
    });

    it("deletes it with the Delete key", async () => {
      const mounted = await mountWithMarker();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      await flushPromises();

      expect(mounted.song.getMarkers()).toEqual([]);
      expect(title(mounted.wrapper)).toBe("Song setup");
    });
  });

  describe("with a sync point selected", () => {
    it("nudges it and moves it to another measure, where the selection follows", async () => {
      const mounted = mountPanel(makeAudioSongWithRepeat());
      const [, second] = mounted.song.getWarpMarkers();
      mounted.selection.select({ kind: "syncPoint", occurrence: { measure: second!.measure, occurrence: second!.occurrence } });
      await flushPromises();

      await button(mounted.wrapper, "Nudge later").trigger("click");
      await flushPromises();
      expect(mounted.song.getWarpMarkers()[1]!.time).toBeCloseTo(second!.time + 0.01);

      await button(mounted.wrapper, "Move to another measure").trigger("click");
      const options = mounted.wrapper.findComponent({ name: "Select" });
      options.vm.$emit("update:modelValue", `${idOf(mounted.song, "2")}#1`);
      await flushPromises();

      expect(mounted.selection.selection.value).toEqual({ kind: "syncPoint", occurrence: { measure: idOf(mounted.song, "2"), occurrence: 1 } });
    });
  });

  describe("with a recording pass selected", () => {
    it("moves it and keeps it selected at its new place", async () => {
      const mounted = mountPanel(makeAudioSongWithRepeat());
      const spans = [...mounted.song.getRecording()];
      mounted.selection.select({ kind: "pass", index: 1 });
      await flushPromises();
      expect(title(mounted.wrapper)).toMatch(/^Recording pass/);

      await button(mounted.wrapper, "Move earlier").trigger("click");
      await flushPromises();

      expect(mounted.song.getRecording()[0]).toEqual(spans[1]);
      expect(mounted.selection.selection.value).toEqual({ kind: "pass", index: 0 });
    });
  });
});
