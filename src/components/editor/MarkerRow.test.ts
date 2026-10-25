import { mount, type VueWrapper } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { describe, expect, it, vi } from "vitest";

import type { Marker } from "@/core/models/markers";
import type Song from "@/core/models/song";
import { locationOf, makeMidiSong, makeMidiSongWithRepeat } from "@/test/fixtures";

import MarkerRow from "./MarkerRow.vue";

// PrimeVue's Select queries media features, which jsdom does not implement.
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function mountRow(song: Song, marker: Marker): VueWrapper {
  return mount(MarkerRow, {
    props: { song, marker, active: false },
    global: { plugins: [PrimeVue] },
  });
}

function occurrencePicker(wrapper: VueWrapper): VueWrapper | undefined {
  const picker = wrapper.findComponent(Select);
  return picker.exists() ? picker : undefined;
}

async function typeMeasure(wrapper: VueWrapper, label: string): Promise<void> {
  const input = wrapper.find("input[aria-label='Measure of marker A']");
  await input.setValue(label);
  await input.trigger("keydown", { key: "Enter" });
}

describe("MarkerRow", () => {
  it("offers the occurrence only for a measure that plays more than once", async () => {
    const song = makeMidiSongWithRepeat();
    const wrapper = mountRow(song, { at: locationOf(song, "1"), text: "A" });
    expect(occurrencePicker(wrapper)).toBeUndefined();

    await wrapper.find("input[aria-label='Measure of marker A']").setValue("2");

    expect(wrapper.findComponent(Select).props("options")).toEqual([
      { label: "1st time", value: 1 },
      { label: "2nd time", value: 2 },
      { label: "3rd time", value: 3 },
    ]);
    expect(wrapper.find("[role='combobox'][aria-label='Occurrence of marker A']").exists()).toBe(true);
  });

  it("names its fields after the marker", () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1"), text: "A" });

    expect(wrapper.find("input[aria-label='Measure of marker A']").exists()).toBe(true);
    expect(wrapper.find("input[aria-label='Beat of marker A']").exists()).toBe(true);
    expect(wrapper.find("input[aria-label='Name of marker A']").exists()).toBe(true);
    expect(wrapper.find("button[aria-label='Delete marker A']").exists()).toBe(true);
  });

  it("moves the marker to another measure, keeping its beat", async () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1", 2), text: "A" });

    await typeMeasure(wrapper, "3");

    expect(wrapper.emitted("update")).toEqual([[locationOf(song, "3", 2), "A"]]);
  });

  it("moves the marker to another occurrence", async () => {
    const song = makeMidiSongWithRepeat();
    const wrapper = mountRow(song, { at: locationOf(song, "2"), text: "A" });

    const picker = occurrencePicker(wrapper)!;
    await picker.vm.$emit("update:modelValue", 3);
    await picker.vm.$emit("change", { value: 3 });

    expect(wrapper.emitted("update")).toEqual([[locationOf(song, "2", 0, 3), "A"]]);
  });

  it("falls back to the first occurrence when the new measure plays less often", async () => {
    const song = makeMidiSongWithRepeat();
    const wrapper = mountRow(song, { at: locationOf(song, "2", 0, 3), text: "A" });

    await typeMeasure(wrapper, "4");

    expect(wrapper.emitted("update")).toEqual([[locationOf(song, "4"), "A"]]);
  });

  it("moves the marker to another beat", async () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1"), text: "A" });

    await wrapper.findComponent(InputNumber).vm.$emit("update:modelValue", 4);
    await wrapper.find("input[aria-label='Beat of marker A']").trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update")).toEqual([[locationOf(song, "1", 3), "A"]]);
  });

  it("explains an unknown measure instead of saving", async () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1"), text: "A" });

    await typeMeasure(wrapper, "99");

    expect(wrapper.emitted("update")).toBeUndefined();
    expect(wrapper.text()).toContain("This song has no measure 99.");
    const input = wrapper.find("input[aria-label='Measure of marker A']");
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(wrapper.find(`#${input.attributes("aria-describedby")}`).text()).toBe("This song has no measure 99.");
  });

  it("explains a beat the measure does not have", async () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1", 3), text: "A" });

    await typeMeasure(wrapper, "0");

    expect(wrapper.emitted("update")).toBeUndefined();
    expect(wrapper.text()).toContain("Measure 0 has no beat 4.");
  });

  it("restores the saved location on Escape", async () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1"), text: "A" });
    const input = wrapper.find<HTMLInputElement>("input[aria-label='Measure of marker A']");

    await typeMeasure(wrapper, "99");
    await input.trigger("keydown", { key: "Escape" });

    expect(input.element.value).toBe("1");
    expect(wrapper.text()).not.toContain("no measure");
  });

  it("renames the marker", async () => {
    const song = makeMidiSong();
    const wrapper = mountRow(song, { at: locationOf(song, "1"), text: "A" });
    const name = wrapper.find("input[aria-label='Name of marker A']");

    await name.setValue("Chorus");
    await name.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update")).toEqual([[locationOf(song, "1"), "Chorus"]]);
  });
});
