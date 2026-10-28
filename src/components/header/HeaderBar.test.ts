import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type Show from "@/core/models/show";
import type { TimelinePosition } from "@/core/player/timeline";
import type { PlayerLocation, PlayerSectionState } from "@/core/player/types";
import { usePlayerStore } from "@/stores/player";
import { locationOf, makeMidiSongWithRepeat } from "@/test/fixtures";

import HeaderBar from "./HeaderBar.vue";

const player = vi.hoisted(() => ({
  ready: true,
  playing: true,
  mode: "midi",
  position: 0,
  duration: 1000,
  currentTempo: 120,
  currentTimeSignature: [4, 2],
  playbackSpeed: 1,
  playbackTransposition: 0,
  currentSegue: undefined,
  currentLocation: undefined as PlayerLocation | undefined,
  currentTimelinePosition: undefined as TimelinePosition | undefined,
  currentSection: undefined as PlayerSectionState | undefined,
  timeline: [] as TimelinePosition[],
  setMeasure: () => {},
  setBeat: () => {},
  seek: () => {},
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

// The breadcrumb's logo and the account menu need the router and assets, which the transport does not.
vi.mock("./ShowBreadcrumb.vue", () => ({ default: { render: () => null } }));
vi.mock("./UserMenuButton.vue", () => ({ default: { render: () => null } }));

vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

const song = makeMidiSongWithRepeat();
const show = { songs: [song] } as unknown as Show;

const VAMP: PlayerSectionState = { section: 0, kind: "vamp", pass: 2, passes: 4, recordedPasses: 4, released: false };

function mountHeader(): VueWrapper {
  return mount(HeaderBar, {
    props: { show, songId: song.id, playback: true },
    global: {
      plugins: [PrimeVue],
    },
  });
}

const TICKS_PER_POSITION = 100;

function resolveTimeline(): TimelinePosition[] {
  return song.getTimeline().map((entry) => {
    const start = entry.position * TICKS_PER_POSITION;
    return { ...entry, beats: 4, beatTicks: [0, 1, 2, 3].map(beat => start + beat * 25), endTick: start + TICKS_PER_POSITION };
  });
}

/** Plays a beat of a timeline position, as the store reports it. */
function playAt(position: number, beat = 0): void {
  const state = fakePlayer();
  const entry = state.timeline[position]!;
  state.currentLocation = { position, measure: entry.measure, occurrence: entry.occurrence, beat };
  state.currentTimelinePosition = entry;
}

function sectionButton(wrapper: VueWrapper): VueWrapper["element"] {
  return wrapper.findAll("button").find(button => /^(Vamp|Repeat|Exiting|Cut)/.test(button.text()))!.element;
}

describe("HeaderBar", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    const state = fakePlayer();
    state.currentSection = undefined;
    state.mode = "midi";
    state.playbackSpeed = 1;
    state.timeline = resolveTimeline();
    playAt(4, 1);
    state.duration = state.timeline.length * TICKS_PER_POSITION;
  });

  it("shows the label of the playing measure and its beat", () => {
    const wrapper = mountHeader();

    expect(wrapper.find("button[aria-label='Current measure 2']").text()).toBe("2");
    expect(wrapper.find("button[aria-label='Current beat 2']").text()).toBe("2");
  });

  it.each<[string, Partial<PlayerSectionState>]>([
    ["Vamp 2/4", {}],
    ["Vamp 3", { pass: 3, passes: undefined }],
    ["Exiting", { released: true, passes: 2 }],
    ["Repeat 2/3", { kind: "repeat", passes: 3, recordedPasses: 3 }],
    ["Cut", { kind: "cut" }],
  ])("shows %s while a section plays", async (label, state) => {
    const wrapper = mountHeader();
    fakePlayer().currentSection = { ...VAMP, ...state };
    await flushPromises();

    expect(sectionButton(wrapper).textContent?.trim()).toBe(label);
  });

  it("releases and resets only vamps, and is active during repeats", async () => {
    const wrapper = mountHeader();
    fakePlayer().currentSection = { ...VAMP, kind: "repeat" };
    await flushPromises();
    const button = sectionButton(wrapper) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(wrapper.emitted("toggleVamp")).toBeUndefined();

    fakePlayer().currentSection = VAMP;
    await flushPromises();
    (sectionButton(wrapper) as HTMLButtonElement).click();

    expect(wrapper.emitted("toggleVamp")).toHaveLength(1);
  });

  it.each<[string, Partial<PlayerSectionState>, string | undefined]>([
    ["a vamp", {}, "bg-section-vamp"],
    ["a released vamp", { released: true }, undefined],
    ["a repeat", { kind: "repeat" }, "bg-section-repeat"],
    ["a cut", { kind: "cut" }, "bg-section-cut"],
  ])("takes the color of %s", async (_name, state, color) => {
    const wrapper = mountHeader();
    fakePlayer().currentSection = { ...VAMP, ...state };
    await flushPromises();
    const classes = sectionButton(wrapper).classList;

    expect([...classes].filter(name => name.startsWith("bg-section-"))).toEqual(color ? [color] : []);
  });

  it("shows the pass of a written repeat outside sections", () => {
    const button = sectionButton(mountHeader()) as HTMLButtonElement;

    expect(button.textContent?.trim()).toBe("Repeat 2/3");
    expect(button.disabled).toBe(false);
  });

  it("shows Vamp, disabled, outside sections and repeats", () => {
    playAt(1);
    const button = sectionButton(mountHeader()) as HTMLButtonElement;

    expect(button.textContent?.trim()).toBe("Vamp");
    expect(button.disabled).toBe(true);
  });

  it("colors the recorded passes of each section on the playbar", () => {
    const wrapper = mountHeader();
    const timeline = fakePlayer().timeline;
    const first = timeline.findIndex(entry => entry.measure === locationOf(song, "2").measure);
    const ranges = wrapper.findAll("div.bg-section-repeat");

    expect(ranges).toHaveLength(1);
    expect((ranges[0]!.element as HTMLElement).style.left).toBe(`${first / timeline.length * 100}%`);
    expect((ranges[0]!.element as HTMLElement).style.width).toBe(`${6 / timeline.length * 100}%`);
  });

  it("names the measure and section in the position slider", async () => {
    const wrapper = mountHeader();
    fakePlayer().currentSection = { ...VAMP, kind: "repeat", passes: 3, recordedPasses: 3 };
    await flushPromises();

    expect(wrapper.find("[role='slider'][aria-label='Position']").attributes("aria-valuetext")).toBe("2, 2nd time, Repeat pass 2 of 3");
  });
  it("shows the beat and the played tempo in audio mode too", () => {
    const state = fakePlayer();
    state.mode = "audio";
    state.playbackSpeed = 0.5;
    const wrapper = mountHeader();

    expect(wrapper.find("button[aria-label='Current beat 2']").exists()).toBe(true);
    expect(wrapper.find("button[aria-label='Tempo 60']").text()).toContain("60");
  });
});
