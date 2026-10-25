import { mount, type VueWrapper } from "@vue/test-utils";
import Checkbox from "primevue/checkbox";
import PrimeVue from "primevue/config";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { describe, expect, it, vi } from "vitest";

import type { Section } from "@/core/models/sections";
import type Song from "@/core/models/song";
import { locationOf, makeMidiSongWithBakedVamp, makeMidiSongWithRepeat, makeMidiSongWithVamp } from "@/test/fixtures";

import SectionRow, { describeRecordedPasses, describeSection } from "./SectionRow.vue";

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

function mountRow(song: Song, index = 0): VueWrapper {
  return mount(SectionRow, {
    props: { song, section: song.getSections()[index]!, index, active: false },
    global: { plugins: [PrimeVue] },
  });
}

function findSelect(wrapper: VueWrapper, name: string): VueWrapper {
  return wrapper.findAllComponents(Select).find(select => select.attributes("aria-label") === name
    || select.find(`[aria-label='${name}']`).exists())!;
}

function findPasses(wrapper: VueWrapper): VueWrapper {
  return wrapper.findAllComponents(InputNumber).find(input => input.find("input[aria-label^='Passes']").exists())!;
}

async function choose(select: VueWrapper, value: unknown): Promise<void> {
  await select.vm.$emit("update:modelValue", value);
  await select.vm.$emit("change", { value });
}

async function typeMeasure(wrapper: VueWrapper, name: string, label: string): Promise<void> {
  const input = wrapper.find(`input[aria-label='${name}']`);
  await input.setValue(label);
  await input.trigger("keydown", { key: "Enter" });
}

describe("describeSection", () => {
  it("names the kind, the range and occurrences after the first", () => {
    const song = makeMidiSongWithRepeat();
    const repeat = song.getSections()[0]!;
    expect(describeSection(song, repeat)).toBe("Repeat from 2 to 3");
    expect(describeSection(song, { ...repeat, kind: "vamp", to: locationOf(song, "2", 3, 2) } as Section)).toBe("Vamp from 2 to 2, 2nd time");
  });

  it("counts the recorded passes", () => {
    expect(describeRecordedPasses(makeMidiSongWithVamp(), makeMidiSongWithVamp().getSections()[0]!)).toBe("Recorded once");
    const baked = makeMidiSongWithBakedVamp();
    expect(describeRecordedPasses(baked, baked.getSections()[0]!)).toBe("Recorded 4 times");
  });
});

describe("SectionRow", () => {
  it("names its group and fields after the section", () => {
    const wrapper = mountRow(makeMidiSongWithVamp());

    expect(wrapper.attributes("role")).toBe("group");
    expect(wrapper.attributes("aria-label")).toBe("Vamp from 2 to 2");
    expect(wrapper.find("input[aria-label='Measure of start of vamp from 2 to 2']").exists()).toBe(true);
    expect(wrapper.find("input[aria-label='Beat of end of vamp from 2 to 2']").exists()).toBe(true);
    expect(wrapper.find("input[aria-label='Passes of vamp from 2 to 2']").exists()).toBe(true);
    expect(wrapper.find("[aria-label='Exit of vamp from 2 to 2']").exists()).toBe(true);
    expect(wrapper.find("[aria-label='Vocals of vamp from 2 to 2']").exists()).toBe(true);
    expect(wrapper.find("button[aria-label='Delete vamp from 2 to 2']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Recorded once");
  });

  it("offers the occurrence for a measure that plays more than once", () => {
    const wrapper = mountRow(makeMidiSongWithRepeat());

    expect(wrapper.find("[aria-label='Occurrence of start of repeat from 2 to 3']").exists()).toBe(true);
    expect(wrapper.find("[aria-label='Exit of repeat from 2 to 3']").exists()).toBe(false);
  });

  it("saves new passes", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountRow(song);

    await findPasses(wrapper).vm.$emit("update:modelValue", 4);
    await wrapper.find("input[aria-label='Passes of vamp from 2 to 2']").trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update")).toEqual([[{ ...song.getSections()[0], passes: 4 }]]);
  });

  it("saves a new range end", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountRow(song);

    await typeMeasure(wrapper, "Measure of end of vamp from 2 to 2", "3");

    expect(wrapper.emitted("update")).toEqual([[{ ...song.getSections()[0], to: locationOf(song, "3", 3) }]]);
  });

  it("lets a vamp run until released", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountRow(song);

    await wrapper.findComponent(Checkbox).vm.$emit("update:modelValue", true);

    expect(wrapper.emitted("update")).toEqual([[{ ...song.getSections()[0], passes: 0 }]]);
  });

  it("saves the exit and vocals of a vamp", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountRow(song);

    await choose(findSelect(wrapper, "Exit of vamp from 2 to 2"), "anyBar");
    await choose(findSelect(wrapper, "Vocals of vamp from 2 to 2"), "split");

    expect(wrapper.emitted("update")).toEqual([
      [{ ...song.getSections()[0], out: "anyBar" }],
      [{ ...song.getSections()[0], out: "anyBar", vocals: "split" }],
    ]);
  });

  it("turns a vamp into a repeat with the defaults of a repeat", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountRow(song);
    const { from, to } = song.getSections()[0]!;

    await choose(findSelect(wrapper, "Kind of vamp from 2 to 2"), "repeat");

    expect(wrapper.emitted("update")).toEqual([[{ kind: "repeat", from, to, passes: 2 }]]);
  });

  it("explains a range that ends before it starts instead of saving", async () => {
    const song = makeMidiSongWithVamp();
    const wrapper = mountRow(song);

    await typeMeasure(wrapper, "Measure of end of vamp from 2 to 2", "1");

    expect(wrapper.emitted("update")).toBeUndefined();
    const input = wrapper.find("input[aria-label='Measure of end of vamp from 2 to 2']");
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(wrapper.find(`#${input.attributes("aria-describedby")}`).text()).toBe("A section must start before it ends.");
  });

  it("explains an overlap with another section instead of saving", async () => {
    const song = makeMidiSongWithVamp();
    await song.addSection({ kind: "cut", from: locationOf(song, "3"), to: locationOf(song, "4", 3) });
    const wrapper = mountRow(song);

    await typeMeasure(wrapper, "Measure of end of vamp from 2 to 2", "3");

    expect(wrapper.emitted("update")).toBeUndefined();
    expect(wrapper.text()).toContain("Sections must not overlap.");
  });

  it("restores the saved section on Escape after a rejected edit", async () => {
    const song = makeMidiSongWithVamp();
    await song.addSection({ kind: "cut", from: locationOf(song, "3"), to: locationOf(song, "4", 3) });
    const wrapper = mountRow(song);
    const input = wrapper.find<HTMLInputElement>("input[aria-label='Measure of end of vamp from 2 to 2']");

    await typeMeasure(wrapper, "Measure of end of vamp from 2 to 2", "3");
    await input.trigger("keydown", { key: "Escape" });

    expect(input.element.value).toBe("2");
    expect(wrapper.text()).not.toContain("overlap");
  });

  it("explains an unknown measure instead of saving", async () => {
    const wrapper = mountRow(makeMidiSongWithVamp());

    await typeMeasure(wrapper, "Measure of start of vamp from 2 to 2", "99");

    expect(wrapper.emitted("update")).toBeUndefined();
    expect(wrapper.text()).toContain("This song has no measure 99.");
  });

  it("explains missing passes instead of saving", async () => {
    const wrapper = mountRow(makeMidiSongWithRepeat());

    await findPasses(wrapper).vm.$emit("update:modelValue", null);
    await wrapper.find("input[aria-label='Passes of repeat from 2 to 3']").trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update")).toBeUndefined();
    expect(wrapper.text()).toContain("A repeat needs at least 1 passes.");
  });

  it("asks its tab to remove the section", async () => {
    const wrapper = mountRow(makeMidiSongWithVamp());

    await wrapper.find("button[aria-label='Delete vamp from 2 to 2']").trigger("click");

    expect(wrapper.emitted("remove")).toHaveLength(1);
  });
});
