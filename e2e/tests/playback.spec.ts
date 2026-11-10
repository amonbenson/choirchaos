import type { Page } from "@playwright/test";
import type { RecordModel } from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import type { ScoreSpec } from "../generators/score/types";
import { buildSongBundle, locationAt, measureId, recordedBarTimes } from "../generators/song";
import type { Factory, TestUser } from "../harness/factories";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { type PlaybackSample, positionTolerance, readPlayback, recordPlayback, sequenceOf, waitForPlayer } from "../harness/playback";

/** Four one-second bars without a committed PDF, so playback tests stay short. */
const FAST: ScoreSpec = { ...MINIMAL, id: "minimal-fast", title: "Fast Test Song", seed: 101, tempo: 240 };

/** The song after `FAST` in a show, for segues. */
const FAST_NEXT: ScoreSpec = { ...FAST, id: "minimal-fast-next", title: "Next Test Song", number: "2", seed: 102 };

const MS_PER_SECOND = 1000;

/** A show of `FAST` with a segue into `FAST_NEXT`. */
async function createSegueShow(factory: Factory, owner: TestUser): Promise<{ show: RecordModel; first: RecordModel; next: RecordModel }> {
  const show = await factory.createShow(owner);
  const bundle = await buildSongBundle(FAST, { mode: "audio", withPdf: false });
  bundle.fields.arrangement.segue = true;
  const first = await factory.createSong(owner, show, bundle);
  const next = await factory.createSong(owner, show, await buildSongBundle(FAST_NEXT, { mode: "audio", withPdf: false }));
  return { show, first, next };
}

async function play(page: Page, show: RecordModel, song: RecordModel): Promise<void> {
  await page.goto(`/show/${show.id}/song/${song.id}`);
  await waitForPlayer(page);
  await page.getByRole("button", { name: "Play / Pause" }).click();
}

/** Whether the player may have been in `[from, to)` when the slider showed this sample. */
function mayBeInside(sample: PlaybackSample, from: number, to: number): boolean {
  const tolerance = positionTolerance(sample);
  return sample.position >= from - tolerance && sample.position < to + tolerance;
}

/** Whether the player was surely in `[from, to)` when the slider showed this sample. */
function isSurelyInside(sample: PlaybackSample, from: number, to: number): boolean {
  const tolerance = positionTolerance(sample);
  return sample.position >= from + tolerance && sample.position < to - tolerance;
}

test.describe("playback", () => {
  test("a written repeat in a MIDI song plays both passes on the same box", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "midi", repeats: [{ from: "2", to: "3", passes: 2, labels: "R" }] });
    const { score } = bundle.fields;
    expect(bundle.fields.recording.spans).toEqual([
      { from: measureId(score, "1"), to: measureId(score, "3") },
      { from: measureId(score, "2"), to: measureId(score, "4") },
    ]);
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await play(page, show, song);
    const samples = await recordPlayback(page, sample => sample.measure === "4");

    expect(sequenceOf(samples, "measure")).toEqual(["1", "2", "3", "2", "3", "4"]);
    expect(sequenceOf(samples, "box")).toEqual(["1", "2", "3", "2", "3", "4"]);
    const secondPass = bundle.recording.timeline.measures[3]!;
    expect(samples.some(sample => sample.box === "2" && sample.position >= secondPass.startTick)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a vamp recorded once loops until released", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(FAST, { mode: "audio", withPdf: false });
    const { score } = bundle.fields;
    bundle.fields.arrangement.sections = [
      { kind: "vamp", from: locationAt(score, "2"), to: locationAt(score, "3", 3), out: "onEnd", vocals: "all" },
    ];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await play(page, show, song);
    const looping = await recordPlayback(page, sample => sample.section === "Vamp 3");
    await page.getByRole("button", { name: "Vamp 3", exact: true }).click();
    const leaving = await recordPlayback(page, sample => sample.measure === "4");
    const samples = [...looping, ...leaving];

    expect(sequenceOf(samples, "measure")).toEqual(["1", "2", "3", "2", "3", "2", "3", "4"]);
    expect(sequenceOf(samples, "section")).toEqual(["Vamp", "Vamp 1", "Vamp 2", "Vamp 3", "Exiting", "Vamp"]);
    expect(errors).toEqual([]);
  });

  test("a released vamp recorded four times ends in the last recorded pass", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(FAST, { mode: "audio", withPdf: false, repeats: [{ from: "2", to: "3", passes: 4 }] });
    const { score } = bundle.fields;
    bundle.fields.arrangement.sections = [
      { kind: "vamp", from: locationAt(score, "2"), to: locationAt(score, "3", 3), out: "onEnd", vocals: "all" },
    ];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await play(page, show, song);
    const times = recordedBarTimes(bundle).map(seconds => seconds * MS_PER_SECOND);
    const entering = await recordPlayback(page, sample => sample.section === "Vamp 2");
    await page.getByRole("button", { name: "Vamp 2", exact: true }).click();
    const leaving = await recordPlayback(page, sample => sample.measure === "4");
    const samples = [...entering, ...leaving];

    expect(sequenceOf(samples, "section")).toEqual(["Vamp", "Vamp 1", "Vamp 2", "Exiting", "Vamp"]);
    // The release lands in the second recorded pass, which then finishes or jumps into the last one.
    const exiting = samples.filter(sample => sample.section === "Exiting");
    expect(exiting.every(sample => mayBeInside(sample, times[3]!, times[5]!) || mayBeInside(sample, times[7]!, times[9]!))).toBe(true);
    expect(samples.filter(sample => isSurelyInside(sample, times[5]!, times[7]!))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a cut skips its range", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(FAST, { mode: "audio", withPdf: false });
    const { score } = bundle.fields;
    bundle.fields.arrangement.sections = [{ kind: "cut", from: locationAt(score, "2"), to: locationAt(score, "3", 3) }];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await play(page, show, song);
    const times = recordedBarTimes(bundle).map(seconds => seconds * MS_PER_SECOND);
    const samples = await recordPlayback(page, sample => sample.measure === "4");

    expect(sequenceOf(samples, "measure")).toEqual(["1", "4"]);
    expect(samples.filter(sample => isSurelyInside(sample, times[1]!, times[3]!))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a caesura after a repeat pauses once until played again", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(FAST, { mode: "audio", withPdf: false });
    const { score } = bundle.fields;
    bundle.fields.arrangement.sections = [
      { kind: "repeat", from: locationAt(score, "2"), to: locationAt(score, "3", 3), passes: 2 },
      { kind: "caesura", at: locationAt(score, "4") },
    ];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await play(page, show, song);
    const samples = await recordPlayback(page, sample => sample.measure === "4");
    const banner = page.getByText("Caesura", { exact: true });
    await expect(banner).toBeVisible();

    const waiting = await readPlayback(page);
    const times = recordedBarTimes(bundle).map(seconds => seconds * MS_PER_SECOND);
    expect(Math.abs(waiting.position - times[3]!)).toBeLessThanOrEqual(positionTolerance(waiting));
    await page.waitForTimeout(MS_PER_SECOND / 2);
    expect((await readPlayback(page)).position).toBe(waiting.position);

    await page.keyboard.press("Space");
    await expect(banner).toBeHidden();
    await expect.poll(async () => (await readPlayback(page)).position).toBeGreaterThan(waiting.position);
    expect(sequenceOf(samples, "measure")).toEqual(["1", "2", "3", "2", "3", "4"]);
    expect(errors).toEqual([]);
  });

  test("a segue starts the next song", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const { show, first, next } = await createSegueShow(factory, owner);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await play(page, show, first);

    await expect(page).toHaveURL(new RegExp(`/song/${next.id}$`), { timeout: 15_000 });
    const position = page.getByRole("slider", { name: "Position" });
    await expect.poll(async () => Number(await position.getAttribute("aria-valuenow")), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("an editor stays on the song and is told about the skipped segue", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const { show, first } = await createSegueShow(factory, owner);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${first.id}/edit`);
    await waitForPlayer(page);
    await page.getByRole("button", { name: "Play / Pause" }).click();

    await expect(page.getByText("Segue skipped while editing").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Outside the editor, #2 Next Test Song would start now.")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/song/${first.id}/edit$`));
    expect(errors).toEqual([]);
  });
});
