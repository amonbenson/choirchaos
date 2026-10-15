import type { Page } from "@playwright/test";
import type { RecordModel } from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, type SongMeasure } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";

async function openEditor(page: Page, show: RecordModel, song: RecordModel): Promise<void> {
  await page.goto(`/show/${show.id}/song/${song.id}`);
  await page.getByRole("button", { name: "Toggle Edit Mode" }).click();
}

function layoutOf(song: RecordModel, value: string): SongMeasure["layout"] {
  return song.measures.find((m: SongMeasure) => m.value === value)?.layout;
}

test.describe("measure editing", () => {
  test("a placed measure can be renumbered, swapping layouts with the target", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Measure 1", exact: true }).click();
    await page.getByRole("combobox", { name: "Measure number" }).click();
    await page.getByRole("option", { name: "3 (swap)" }).click();

    await expect.poll(async () => layoutOf(await admin.collection("songs").getOne(song.id), "1")).toEqual(layoutOf(song, "3"));
    expect(layoutOf(await admin.collection("songs").getOne(song.id), "3")).toEqual(layoutOf(song, "1"));
    expect(errors).toEqual([]);
  });

  test("a measure can be removed from the score", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Measure 2", exact: true }).click();
    await page.getByRole("button", { name: "Remove from score" }).click();

    await expect.poll(async () => layoutOf(await admin.collection("songs").getOne(song.id), "2")).toBeUndefined();
  });

  test("measures are added as a range", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Add measures" }).click();
    await page.getByLabel("Measures", { exact: true }).fill("10..12");
    await page.getByRole("button", { name: "Add 3 measures" }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).measures.map((m: SongMeasure) => m.value))
      .toEqual(expect.arrayContaining(["10", "11", "12"]));
  });

  test("drawing a box places the next unplaced measures", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    bundle.fields.measures = bundle.fields.measures.map(({ value, beats }) => ({ value, beats }));
    const song = await factory.createSong(owner, show, bundle);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Place measures" }).click();
    const pdfPage = page.locator(".cursor-crosshair").first();
    const box = (await pdfPage.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3, { steps: 5 });
    await page.mouse.up();

    await page.getByLabel("Measures in this box").fill("2");
    await page.getByRole("button", { name: "Place", exact: true }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).measures.filter((m: SongMeasure) => m.layout).map((m: SongMeasure) => m.value))
      .toEqual(["1", "2"]);
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
