import type { Page } from "@playwright/test";
import type { RecordModel } from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, type SongMeasure } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";

async function openEditor(page: Page, show: RecordModel, song: RecordModel): Promise<void> {
  await page.goto(`/show/${show.id}/song/${song.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/song/${song.id}/edit$`));
}

function layoutOf(song: RecordModel, value: string): SongMeasure["layout"] {
  return song.measures.find((m: SongMeasure) => m.value === value)?.layout;
}

async function storedMeasures(admin: { collection: (name: string) => { getOne: (id: string) => Promise<RecordModel> } }, id: string): Promise<SongMeasure[]> {
  return (await admin.collection("songs").getOne(id)).measures;
}

// The loading overlay covers the score until the player is ready, which takes a while for MIDI songs.
async function dragOnScore(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await expect(page.getByRole("button", { name: "Play / Pause" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText(/^Loading (audio data|PDF)/)).toHaveCount(0);
  const box = (await page.getByTestId("score-page").first().boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 });
  await page.mouse.up();
}

test.describe("measure editing", () => {
  test("renumbering a box onto a placed measure offers a swap", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Measure 1", exact: true }).click();
    const panel = page.getByTestId("measure-panel");
    await panel.getByLabel("Number").fill("3");
    await panel.getByLabel("Number").press("Enter");
    await panel.getByRole("button", { name: "Swap with measure 3" }).click();

    await expect.poll(async () => layoutOf(await admin.collection("songs").getOne(song.id), "1")).toEqual(layoutOf(song, "3"));
    expect(layoutOf(await admin.collection("songs").getOne(song.id), "3")).toEqual(layoutOf(song, "1"));
    expect(errors).toEqual([]);
  });

  test("shift-click selects a range whose boxes are removed in one step", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Measure 2", exact: true }).click();
    await page.getByRole("button", { name: "Measure 3", exact: true }).click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("measure-panel")).toContainText("2 measures selected");
    await page.getByRole("button", { name: "Remove boxes" }).click();

    await expect.poll(async () => (await storedMeasures(admin, song.id)).filter(m => !m.layout).map(m => m.value)).toEqual(["2", "3"]);
  });

  test("beats of several measures are changed with one save", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Measure 1", exact: true }).click();
    await page.getByRole("button", { name: "Measure 2", exact: true }).click({ modifiers: ["ControlOrMeta"] });
    const beats = page.getByTestId("measure-panel").getByLabel("Beats");
    await beats.fill("3");
    await beats.press("Enter");

    await expect.poll(async () => (await storedMeasures(admin, song.id)).filter(m => m.beats === 3).map(m => m.value)).toEqual(["1", "2"]);
  });

  test("measures are added as a range", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Add..." }).click();
    await page.getByLabel("Measures", { exact: true }).fill("10..12");
    await page.getByRole("button", { name: "Add 3 measures" }).click();

    await expect.poll(async () => (await storedMeasures(admin, song.id)).map(m => m.value))
      .toEqual(expect.arrayContaining(["10", "11", "12"]));
  });

  test("drawing a box places measures from the panel's first number", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    bundle.fields.measures = bundle.fields.measures.map(({ value, beats }) => ({ value, beats }));
    const song = await factory.createSong(owner, show, bundle);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Place measures 1" }).first().click();
    await dragOnScore(page, [0.1, 0.2], [0.9, 0.3]);

    const panel = page.getByTestId("measure-panel");
    await panel.getByLabel("Measures in this box").fill("2");
    await expect(panel.getByLabel("First number")).toHaveValue("1");
    await panel.getByRole("button", { name: "Place", exact: true }).click();

    await expect.poll(async () => (await storedMeasures(admin, song.id)).filter(m => m.layout).map(m => m.value))
      .toEqual(["1", "2"]);
  });

  test("dragging on empty space selects the boxes it touches", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "midi" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await dragOnScore(page, [0.01, 0.01], [0.99, 0.99]);

    const placed = song.measures.filter((m: SongMeasure) => m.layout).length;
    await expect(page.getByTestId("measure-panel")).toContainText(`${placed} measures selected`);
    await expect(page.getByTestId("measure-panel")).toContainText("from the beat map");
    await expect(page.getByRole("button", { name: "Delete measures" })).toHaveCount(0);
  });
});

test.describe("measure detection", () => {
  type Layout = NonNullable<SongMeasure["layout"]>;

  function containsCenter(outer: Layout, inner: Layout): boolean {
    const x = inner.x + inner.width / 2;
    const y = inner.y + inner.height / 2;
    return inner.page === outer.page && x > outer.x && x < outer.x + outer.width && y > outer.y && y < outer.y + outer.height;
  }

  test("detected boxes are applied to the measures they belong to", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    const expected = bundle.fields.measures;
    bundle.fields.measures = expected.map(({ value, beats }) => ({ value, beats }));
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Detect..." }).click();
    await page.getByRole("button", { name: "Detect", exact: true }).click();
    await expect(page.getByText(`Places ${expected.length} measures of the song.`)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Apply" }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).measures.every((m: SongMeasure) => m.layout)).toBe(true);
    const stored = await admin.collection("songs").getOne(song.id);
    for (const measure of expected) {
      expect(containsCenter(measure.layout!, layoutOf(stored, measure.value)!), `measure ${measure.value}`).toBe(true);
    }

    expect(errors).toEqual([]);
  });
});

test.describe("audio synchronization", () => {
  async function waveformState(page: Page): Promise<{ scale: number; sampleRate: number }> {
    const root = page.locator("[data-zoom-scale]");
    await expect(root).not.toHaveAttribute("data-zoom-scale", "0");
    return {
      scale: Number(await root.getAttribute("data-zoom-scale")),
      sampleRate: Number(await root.getAttribute("data-sample-rate")),
    };
  }

  test("ctrl and wheel zoom in down to single samples", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    const waveform = page.getByTestId("waveform");
    await expect(waveform.locator("canvas").first()).toBeVisible();
    const before = await waveformState(page);
    const box = (await waveform.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    const afterOneTick = await waveformState(page);
    expect(afterOneTick.scale).toBeLessThan(before.scale);
    expect(afterOneTick.scale).toBeGreaterThan(before.scale / 4);

    for (let i = 0; i < 40; i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }

    expect((await waveformState(page)).scale).toBe(1);
    expect(errors).toEqual([]);
  });

  test("dragging a marker moves it in time", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    const { scale, sampleRate } = await waveformState(page);
    const marker = song.warpMarkers[1] as { measure: string; time: number };
    const box = (await page.getByTestId("waveform").boundingBox())!;
    const markerX = box.x + (marker.time * sampleRate) / scale;
    const dragPixels = 30;

    await page.mouse.move(markerX, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(markerX + dragPixels, box.y + 8, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => {
      const stored = await admin.collection("songs").getOne(song.id);
      return stored.warpMarkers.find((m: { measure: string }) => m.measure === marker.measure).time;
    }).toBeCloseTo(marker.time + (dragPixels * scale) / sampleRate, 1);
  });
});
