import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import type { SelectedRun } from "@/core/models/measureSelection";
import type Song from "@/core/models/song";
import { locationOf, makeMidiSong, makeMidiSongWithRepeat } from "@/test/fixtures";

import MarkerGroup from "./MarkerGroup.vue";

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

function mountGroup(song: Song, run: SelectedRun): VueWrapper {
  return mount(MarkerGroup, {
    props: { song: reactive(song) as Song, run },
    global: { plugins: [PrimeVue, ToastService] },
    attachTo: document.body,
  });
}

function addButton(wrapper: VueWrapper): ReturnType<VueWrapper["find"]> {
  return wrapper.findAll("button").find(button => button.text().startsWith("Add marker"))!;
}

describe("MarkerGroup", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("adds a marker on the first beat of the selected occurrence", async () => {
    const song = makeMidiSongWithRepeat();
    const wrapper = mountGroup(song, { first: 4, last: 5 });

    await addButton(wrapper).trigger("click");
    await flushPromises();

    expect(song.getMarkers()).toEqual([{ at: locationOf(song, "2", 0, 2), text: "A" }]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name of marker A");
    expect(wrapper.text()).toContain("On the 2nd time");
  });

  it("names the add button after the measure and its occurrence", () => {
    expect(addButton(mountGroup(makeMidiSongWithRepeat(), { first: 4, last: 4 })).text()).toBe("Add marker at 2, 2nd time");
    expect(addButton(mountGroup(makeMidiSong(), { first: 1, last: 2 })).text()).toBe("Add marker at 1");
  });

  it("names new markers with the next free rehearsal letter", async () => {
    const song = makeMidiSong();
    await song.addMarker(locationOf(song, "1"), "A");
    const wrapper = mountGroup(song, { first: 3, last: 3 });

    await addButton(wrapper).trigger("click");
    await flushPromises();

    expect(song.getMarkers().map(marker => marker.text)).toEqual(["A", "B"]);
  });

  it("shows only the markers of the selected occurrence", async () => {
    const song = makeMidiSongWithRepeat();
    await song.addMarker(locationOf(song, "2"), "First");
    await song.addMarker(locationOf(song, "2", 2, 2), "Second");
    const wrapper = mountGroup(song, { first: 4, last: 4 });

    expect(wrapper.findAll("input").map(input => input.attributes("aria-label"))).toEqual(["Name of marker Second"]);
    expect(wrapper.text()).toContain("On the 2nd time, on the 3rd beat");
  });

  it("renames a marker and keeps where it is", async () => {
    const song = makeMidiSong();
    await song.addMarker(locationOf(song, "1", 2), "A");
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    const input = wrapper.find("input[aria-label='Name of marker A']");
    await input.setValue("Chorus");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(song.getMarkers()).toEqual([{ at: locationOf(song, "1", 2), text: "Chorus" }]);
  });

  it("keeps the name when the field is emptied or Escape is pressed", async () => {
    const song = makeMidiSong();
    await song.addMarker(locationOf(song, "1"), "A");
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    const input = wrapper.find("input[aria-label='Name of marker A']");
    await input.setValue("");
    await input.trigger("blur");
    expect((input.element as HTMLInputElement).value).toBe("A");

    await input.setValue("B");
    await input.trigger("keydown", { key: "Escape" });
    expect((input.element as HTMLInputElement).value).toBe("A");
    expect(song.getMarkers()[0]!.text).toBe("A");
  });

  it("deletes a marker", async () => {
    const song = makeMidiSong();
    await song.addMarker(locationOf(song, "1"), "A");
    const wrapper = mountGroup(song, { first: 1, last: 1 });

    await wrapper.find("button[aria-label='Delete marker A']").trigger("click");
    await flushPromises();

    expect(song.getMarkers()).toEqual([]);
  });
});
