import type { Page } from "@playwright/test";

import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, locationAt, type SongSection, type SongWarpMarker } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { waitForPlayer } from "../harness/playback";

const SECOND_TIME = { measure: "m2", occurrence: 2 };

function isSecondTime(marker: SongWarpMarker): boolean {
  return marker.measure === SECOND_TIME.measure && marker.occurrence === SECOND_TIME.occurrence;
}

async function playheadSeconds(page: Page): Promise<number> {
  return Number(await page.getByRole("slider", { name: "Position" }).getAttribute("aria-valuenow")) / 1000;
}

async function waveformState(page: Page): Promise<{ scale: number; sampleRate: number }> {
  const root = page.locator("[data-zoom-scale]");
  await expect(root).not.toHaveAttribute("data-zoom-scale", "0");
  return {
    scale: Number(await root.getAttribute("data-zoom-scale")),
    sampleRate: Number(await root.getAttribute("data-sample-rate")),
  };
}

test.describe("timeline and audio sync", () => {
  test("syncs a measure to the playhead and nudges it by keyboard", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    // Recorded as 1, 2, 1, 2, 3, 4. The second time of measure 2 (position 3) starts without a sync point.
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio", repeats: [{ from: "1", to: "2", passes: 2 }] });
    const times = bundle.fields.recording.warpMarkers.map(marker => marker.time);
    bundle.fields.recording.warpMarkers = bundle.fields.recording.warpMarkers.filter(marker => !isSecondTime(marker));
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const timeline = page.getByRole("region", { name: "Timeline" });
    const panel = page.getByRole("region", { name: "Editor panel" });
    await expect(timeline.getByRole("list", { name: "Recording" }).getByRole("listitem")).toHaveCount(2);

    await page.getByRole("button", { name: "Measure 2", exact: true }).click();
    await panel.getByRole("group", { name: "Pass, follows the playhead" }).getByRole("button", { name: "2nd time" }).click();
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^2, 2nd time/);
    const sync = panel.getByRole("region", { name: "Audio sync" });
    await expect(sync).toContainText("No sync point.");

    // Moves the playhead to where the second time really starts in this test. It stays inside the estimated
    // second time, since the playhead decides which pass of the selected measure is synced.
    const { scale, sampleRate } = await waveformState(page);
    const target = times[2]! + 0.65 * (times[4]! - times[2]!);
    const waveform = (await page.getByRole("img", { name: "Waveform" }).boundingBox())!;
    await page.mouse.click(waveform.x + (target * sampleRate) / scale, waveform.y + waveform.height * 0.7);
    await expect.poll(() => playheadSeconds(page)).toBeCloseTo(target, 1);
    const playhead = await playheadSeconds(page);

    await sync.getByRole("button", { name: "Sync to playhead" }).click();

    const storedTime = async (): Promise<number | undefined> =>
      (await admin.collection("songs").getOne(song.id)).recording.warpMarkers.find(isSecondTime)?.time;
    await expect.poll(storedTime).toBeCloseTo(playhead, 2);
    await expect(panel.getByRole("heading", { name: "Sync point at 2, 2nd time" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Measure 2", exact: true }))
      .toHaveAccessibleDescription(/Sync point on the 1st and 2nd time/);

    await panel.getByRole("textbox", { name: "Starts at" }).press("ArrowUp");
    await expect.poll(storedTime).toBeCloseTo(playhead + 0.01, 3);
    await panel.getByRole("button", { name: "Nudge earlier" }).click();
    await expect.poll(storedTime).toBeCloseTo(playhead, 3);

    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(panel.getByRole("region", { name: "Audio sync" })).toContainText("Synced with");
    expect(errors).toEqual([]);
  });

  test("moves a sync point to another measure and keeps its time", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    // Measure 4 has no sync point, so the one on measure 3 can move there.
    const [, , third] = bundle.fields.recording.warpMarkers;
    bundle.fields.recording.warpMarkers = bundle.fields.recording.warpMarkers.filter(marker => marker.measure !== "m4");
    const song = await factory.createSong(owner, show, bundle);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const panel = page.getByRole("region", { name: "Editor panel" });
    await page.getByRole("button", { name: "Measure 3", exact: true }).click();
    await panel.getByRole("region", { name: "Audio sync" }).getByRole("button", { name: "Select sync point at 3" }).click();
    await panel.getByRole("button", { name: "Move to another measure" }).click();
    await page.getByRole("combobox", { name: /^Which measure starts at/ }).click();
    await page.getByRole("option", { name: "4", exact: true }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).recording.warpMarkers.map((m: SongWarpMarker) => m.measure))
      .toEqual(["m1", "m2", "m4"]);
    const stored = await admin.collection("songs").getOne(song.id);
    expect(stored.recording.warpMarkers[2].time).toBe(third!.time);
    await expect(panel.getByRole("heading", { name: "Sync point at 4" })).toBeVisible();
  });

  test("timeline objects select themselves and measure cells follow the score selection", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    const { score } = bundle.fields;
    bundle.fields.arrangement.sections = [{ kind: "cut", from: locationAt(score, "3"), to: locationAt(score, "3", 3) }];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const timeline = page.getByRole("region", { name: "Timeline" });
    const panel = page.getByRole("region", { name: "Editor panel" });

    const measures = timeline.getByRole("list", { name: "Measures" });
    await page.getByRole("button", { name: "Measure 1", exact: true }).click();
    await expect(measures.getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");

    await measures.getByRole("button", { name: "4", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^4/);
    await expect(panel.getByRole("heading", { name: "Measure 4" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Measure 4", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(measures.getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "false");

    await timeline.getByRole("list", { name: "Markers" }).click();
    await expect(measures.getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Measure 4", exact: true })).toHaveAttribute("aria-pressed", "false");

    await timeline.getByRole("list", { name: "Sections" }).getByRole("button", { name: "Cut 3" }).click();
    await expect(panel.getByRole("heading", { name: "Cut 3" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Measure /, pressed: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Score" }).getByRole("slider", { name: "First measure of cut 3" })).toBeVisible();
    await expect(timeline.getByRole("slider", { name: "First measure of cut 3" })).toBeVisible();

    await timeline.getByRole("list", { name: "Recording" }).getByRole("button").first().click();
    await expect(panel.getByRole("heading", { name: /^Recording pass/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("dragging anywhere scrubs the playhead without selecting, and zooming in hides what left the view", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "midi", withPdf: false });
    const { score } = bundle.fields;
    bundle.fields.arrangement.sections = [{ kind: "cut", from: locationAt(score, "4"), to: locationAt(score, "4", 3) }];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const timeline = page.getByRole("region", { name: "Timeline", exact: true });
    const panel = page.getByRole("region", { name: "Editor panel" });
    const measures = timeline.getByRole("list", { name: "Measures" });
    const start = (await measures.getByRole("button", { name: "1", exact: true }).boundingBox())!;
    const end = (await measures.getByRole("button", { name: "3", exact: true }).boundingBox())!;

    // Starts on the recording pass, which a click would select.
    const recording = (await timeline.getByRole("list", { name: "Recording" }).boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, recording.y + recording.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, recording.y + recording.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^3/);
    await expect(panel.getByRole("heading", { name: "Song setup" })).toBeVisible();

    const sections = timeline.getByRole("list", { name: "Sections" });
    await expect(sections.getByRole("button", { name: "Cut 4" })).toHaveCount(1);
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }

    // Rewinding brings the playhead at the start back into view, far from the cut at the end.
    await page.getByRole("button", { name: "Rewind / Previous Song" }).click();
    await expect(measures.getByRole("button", { name: "1", exact: true })).toBeVisible();
    await expect(sections.getByRole("listitem")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a selected section's handles move it to another pass by mouse and keyboard, without moving the playhead", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    // Recorded as 1, 2, 1, 2, 1, 2, 3, 4, with a vamp on the first pass and a cut on the third.
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio", withPdf: false, repeats: [{ from: "1", to: "2", passes: 3 }] });
    const { score } = bundle.fields;
    const vamp: SongSection = { kind: "vamp", from: locationAt(score, "1"), to: locationAt(score, "2", 3), out: "onEnd", vocals: "all" };
    const cut: SongSection = { kind: "cut", from: locationAt(score, "1", 0, 3), to: locationAt(score, "2", 3, 3) };
    bundle.fields.arrangement.sections = [vamp, cut];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const timeline = page.getByRole("region", { name: "Timeline", exact: true });
    await timeline.getByRole("list", { name: "Sections" }).getByRole("button", { name: "Vamp 1 to 2" }).click();
    const position = page.getByRole("slider", { name: "Position" });
    await expect(position).toHaveAttribute("aria-valuetext", /^1, 1st time/);

    // Drops the last handle on the end of the second pass, where the third time of 1 starts.
    const last = timeline.getByRole("slider", { name: "Last measure of vamp 1 to 2" });
    await expect(last).toHaveAttribute("aria-valuetext", "2, 1st time");
    const handle = (await last.boundingBox())!;
    const thirdTime = (await timeline.getByRole("list", { name: "Measures" }).getByRole("button", { name: "1, 3rd time" }).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(thirdTime.x + 2, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    const stored = async (): Promise<SongSection[]> => (await admin.collection("songs").getOne(song.id)).arrangement.sections;
    await expect.poll(stored).toEqual([{ ...vamp, to: locationAt(score, "2", 3, 2) }, cut]);
    await expect(position).toHaveAttribute("aria-valuetext", /^1, 1st time/);

    const moved = timeline.getByRole("slider", { name: "Last measure of vamp 1, 1st time to 2, 2nd time" });
    await expect(moved).toHaveAttribute("aria-valuetext", "2, 2nd time");
    await moved.press("ArrowLeft");
    await expect.poll(stored).toEqual([{ ...vamp, to: locationAt(score, "1", 3, 2) }, cut]);
    await expect(position).toHaveAttribute("aria-valuetext", /^1, 1st time/);

    expect(errors).toEqual([]);

    // The end of the recording would take in the cut, which is explained instead of saved.
    await timeline.getByRole("slider", { name: "Last measure of vamp 1, 1st time to 1, 2nd time" }).press("End");
    await expect(page.getByText("Sections must not overlap.")).toBeVisible();
    expect(await stored()).toEqual([{ ...vamp, to: locationAt(score, "1", 3, 2) }, cut]);
  });

  test("two sync points sync recorded repeats, and a meter change between them leads to a hint", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio", repeats: [{ from: "1", to: "2", passes: 3 }] });
    const markers = bundle.fields.recording.warpMarkers;
    bundle.fields.recording.warpMarkers = [markers[0]!, markers.at(-1)!];
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const panel = page.getByRole("region", { name: "Editor panel" });
    const checklist = panel.getByRole("list", { name: "Setup checklist" });
    await expect(panel.getByRole("region", { name: "Audio sync" })).toContainText("Synced with 2 sync points");
    await expect(checklist).not.toContainText("meter change");

    await admin.collection("songs").update(song.id, {
      score: { ...bundle.fields.score, measures: bundle.fields.score.measures.map(measure => measure.id === "m3" ? { ...measure, beats: 2 } : measure) },
    });
    await page.reload();
    await waitForPlayer(page);
    await expect(checklist).toContainText("A meter change between sync points mistimes the measures around it");
    await checklist.getByRole("button", { name: "Go to 3" }).click();
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^3/);
    await expect(panel.getByRole("heading", { name: "Measure 3" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a MIDI song shows its timeline read-only and without audio", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "midi", withPdf: false }));
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByRole("list", { name: "Measures" }).getByRole("listitem")).toHaveCount(4);
    await timeline.getByRole("list", { name: "Recording" }).getByRole("button").first().click();
    const panel = page.getByRole("region", { name: "Editor panel" });
    await expect(panel).toContainText("A MIDI song plays its beat map");
    await expect(panel.getByRole("button", { name: "Move earlier" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Waveform" })).toHaveCount(0);
    await expect(timeline.getByRole("button", { name: "Add sync point" })).toHaveCount(0);
  });

  test("rehearsers see no timeline", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const viewer = await factory.createUser();
    const show = await factory.createShow(owner, { viewers: [viewer] });
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(viewer);

    await page.goto(`/show/${show.id}/song/${song.id}`);
    await waitForPlayer(page);
    await expect(page.getByRole("region", { name: "Timeline" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sync to playhead" })).toHaveCount(0);
  });
});
