import type { Page } from "@playwright/test";
import type { RecordModel } from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, measureId, type SongMeasure, type SongWarpMarker, withoutBoxes } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";

async function openEditor(page: Page, show: RecordModel, song: RecordModel): Promise<void> {
  await page.goto(`/show/${show.id}/song/${song.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/song/${song.id}/edit$`));
  await page.getByRole("tab", { name: "Measures" }).click();
}

function layoutOf(song: RecordModel, label: string): SongMeasure["layout"] {
  return song.score.measures.find((m: SongMeasure) => m.label === label)?.layout;
}

async function storedMeasures(admin: { collection: (name: string) => { getOne: (id: string) => Promise<RecordModel> } }, id: string): Promise<SongMeasure[]> {
  return (await admin.collection("songs").getOne(id)).score.measures;
}

// The loading overlay covers the score until the player is ready, which takes a while for MIDI songs.
async function dragOnScore(page: Page, from: [number, number], to: [number, number], options: { shift?: boolean } = {}): Promise<void> {
  await expect(page.getByRole("button", { name: "Play / Pause" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText(/^Loading (audio data|PDF)/)).toHaveCount(0);
  const box = (await page.getByRole("group", { name: "Page 1", exact: true }).boundingBox())!;
  if (options.shift) {
    await page.keyboard.down("Shift");
  }

  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 });
  await page.mouse.up();
  if (options.shift) {
    await page.keyboard.up("Shift");
  }
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
    const panel = page.getByRole("tabpanel", { name: "Measures" });
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
    await expect(page.getByRole("tabpanel", { name: "Measures" })).toContainText("2 measures selected");
    await page.getByRole("button", { name: "Remove boxes" }).click();

    await expect.poll(async () => (await storedMeasures(admin, song.id)).filter(m => !m.layout).map(m => m.label)).toEqual(["2", "3"]);
  });

  test("beats of several measures are changed with one save", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Measure 1", exact: true }).click();
    await page.getByRole("button", { name: "Measure 2", exact: true }).click({ modifiers: ["ControlOrMeta"] });
    const beats = page.getByRole("tabpanel", { name: "Measures" }).getByLabel("Beats");
    await beats.fill("3");
    await beats.press("Enter");

    await expect.poll(async () => (await storedMeasures(admin, song.id)).filter(m => m.beats === 3).map(m => m.label)).toEqual(["1", "2"]);
  });

  test("measures are added as a range", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("textbox", { name: "Measures", exact: true }).fill("10..12");
    await page.getByRole("button", { name: "Add 3 measures" }).click();

    await expect.poll(async () => (await storedMeasures(admin, song.id)).map(m => m.label))
      .toEqual(expect.arrayContaining(["10", "11", "12"]));
  });

  test("drawing a box places measures from the panel's first number", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    bundle.fields.score = withoutBoxes(bundle.fields.score);
    const song = await factory.createSong(owner, show, bundle);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("button", { name: "Place measures 1" }).first().click();
    await dragOnScore(page, [0.1, 0.2], [0.9, 0.3]);

    const panel = page.getByRole("tabpanel", { name: "Measures" });
    await panel.getByLabel("Measures in this box").fill("2");
    await expect(panel.getByLabel("First number")).toHaveValue("1");
    await panel.getByRole("button", { name: "Place", exact: true }).click();

    await expect.poll(async () => (await storedMeasures(admin, song.id)).filter(m => m.layout).map(m => m.label))
      .toEqual(["1", "2"]);
  });

  for (const { way, shift } of [{ way: "the Select tool", shift: false }, { way: "Shift held", shift: true }]) {
    test(`dragging with ${way} selects the boxes it touches`, async ({ page, factory, loginAs }) => {
      const owner = await factory.createUser();
      const show = await factory.createShow(owner);
      const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "midi" }));
      await loginAs(owner);
      await openEditor(page, show, song);

      if (!shift) {
        await page.getByRole("button", { name: "Select", exact: true }).click();
      }

      await dragOnScore(page, [0.01, 0.01], [0.99, 0.99], { shift });

      const placed = song.score.measures.filter((m: SongMeasure) => m.layout).length;
      await expect(page.getByRole("tabpanel", { name: "Measures" })).toContainText(`${placed} measures selected`);
      await expect(page.getByRole("tabpanel", { name: "Measures" })).toContainText("from the beat map");
      await expect(page.getByRole("button", { name: "Delete measures" })).toHaveCount(0);
    });
  }
});

test.describe("markers", () => {
  test("markers are added, renamed and deleted in the song editor", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("tab", { name: "Markers" }).click();
    const panel = page.getByRole("tabpanel", { name: "Markers" });
    await panel.getByRole("button", { name: "Add marker" }).click();
    const name = panel.getByLabel("Name of marker A");
    await expect(name).toBeFocused();
    await name.fill("Chorus");
    await name.press("Enter");
    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).arrangement.markers)
      .toEqual([{ at: { measure: measureId(song.score, "1"), beat: 0 }, text: "Chorus" }]);

    await panel.getByLabel("Measure of marker Chorus").fill("3");
    await panel.getByLabel("Measure of marker Chorus").press("Enter");
    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).arrangement.markers[0].at).toEqual({ measure: measureId(song.score, "3"), beat: 0 });

    await panel.getByRole("button", { name: "Delete marker Chorus" }).click();
    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).arrangement.markers).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("selecting a box on the score switches to the measures", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await openEditor(page, show, song);

    await page.getByRole("tab", { name: "Details" }).click();
    await page.getByRole("button", { name: "Measure 1", exact: true }).click();

    await expect(page.getByRole("tab", { name: "Measures" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Measures" })).toContainText("Measure 1");
  });

  test("rehearsers do not see a markers panel for a song without markers", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);
    await page.goto(`/show/${show.id}/song/${song.id}`);

    await expect(page.getByRole("button", { name: "Play / Pause" })).toBeVisible();
    await expect(page.getByText("No markers available.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Markers panel" })).toHaveCount(0);
  });
});

test.describe("measure detection", () => {
  type Layout = NonNullable<SongMeasure["layout"]>;

  function containsCenter(outer: Layout, inner: Layout): boolean {
    const x = inner.x + inner.width / 2;
    const y = inner.y + inner.height / 2;
    return inner.page === outer.page && x > outer.x && x < outer.x + outer.width && y > outer.y && y < outer.y + outer.height;
  }

  test("detected boxes are previewed on the score and applied from the panel", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    const expected = bundle.fields.score.measures;
    bundle.fields.score = withoutBoxes(bundle.fields.score);
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    const panel = page.getByRole("tabpanel", { name: "Measures" });
    await panel.getByRole("button", { name: "Detect", exact: true }).click();
    await expect(panel.getByText(`Places ${expected.length} measures`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("img", { name: /^Detected / })).toHaveCount(expected.length);
    expect((await storedMeasures(admin, song.id)).some(m => m.layout)).toBe(false);
    await panel.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("img", { name: /^Detected / })).toHaveCount(0);

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).score.measures.every((m: SongMeasure) => m.layout)).toBe(true);
    const stored = await admin.collection("songs").getOne(song.id);
    for (const measure of expected) {
      expect(containsCenter(measure.layout!, layoutOf(stored, measure.label)!), `measure ${measure.label}`).toBe(true);
    }

    expect(errors).toEqual([]);
  });
});

test.describe("measure review", () => {
  test("flagged measures and boxes without a number are worked through in reading order", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    const original = bundle.fields.score.measures;
    const third = original.find(m => m.label === "3")!.layout!;
    const stray = { page: 0, x: 0.02, y: 0.9, width: 0.05, height: 0.05 };
    const measures = original.map(m => m.label === "2" ? { ...m, layout: { ...m.layout!, review: true } } : m.label === "3" ? { id: m.id, label: m.label, beats: m.beats } : m);
    bundle.fields.score = { measures, unnumberedBoxes: [third, stray] };
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await openEditor(page, show, song);

    const panel = page.getByRole("tabpanel", { name: "Measures" });
    await expect(panel).toContainText("3 to review");
    await panel.getByRole("button", { name: "Review" }).click();
    await expect(panel).toContainText("1 of 3 to review");
    await expect(page.getByRole("button", { name: "Measure 2", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Enter");
    await expect(panel).toContainText("1 of 2 to review");
    expect((await storedMeasures(admin, song.id)).find(m => m.label === "2")!.layout).toEqual(original.find(m => m.label === "2")!.layout);

    await page.keyboard.press("3");
    await expect(panel.getByLabel("Number")).toHaveValue("3");
    await page.keyboard.press("Enter");
    await expect(panel).toContainText("1 of 1 to review");

    await page.keyboard.press("Delete");
    await expect(panel).not.toContainText("to review");

    const stored = await admin.collection("songs").getOne(song.id);
    expect(stored.score.unnumberedBoxes).toEqual([]);
    expect(layoutOf(stored, "3")).toEqual(third);
    expect(stored.score.measures.some((m: SongMeasure) => m.layout?.review)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("a song with boxes to review is not ready on the show page", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "midi" });
    bundle.fields.score.unnumberedBoxes = [{ page: 0, x: 0.02, y: 0.9, width: 0.05, height: 0.05 }];
    const song = await factory.createSong(owner, show, bundle);
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    await page.getByRole("button", { name: "Check measures (1 left)" }).click();
    await expect(page).toHaveURL(new RegExp(`/song/${song.id}/edit$`));
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

    const waveform = page.getByRole("img", { name: "Waveform" });
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
    const marker = song.recording.warpMarkers[1] as SongWarpMarker;
    const box = (await page.getByRole("img", { name: "Waveform" }).boundingBox())!;
    const markerX = box.x + (marker.time * sampleRate) / scale;
    const dragPixels = 30;

    await page.mouse.move(markerX, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(markerX + dragPixels, box.y + 8, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => {
      const stored = await admin.collection("songs").getOne(song.id);
      return stored.recording.warpMarkers.find((m: SongWarpMarker) => m.measure === marker.measure && m.occurrence === marker.occurrence).time;
    }).toBeCloseTo(marker.time + (dragPixels * scale) / sampleRate, 1);
  });
});
