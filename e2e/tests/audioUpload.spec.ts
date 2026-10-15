import type { Page } from "@playwright/test";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import { encodeMp3, renderPartStem } from "../generators/audio";
import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, type SongTrack } from "../generators/song";
import { expect, test } from "../harness/fixtures";

type UploadFile = { name: string; mimeType: string; buffer: Buffer };

async function buildStem(partId: string, name: string): Promise<UploadFile> {
  const bundle = await buildSongBundle(MINIMAL, { mode: "none", withPdf: false });
  const mp3 = await encodeMp3(renderPartStem(bundle.timeline, partId));
  return { name, mimeType: "audio/mpeg", buffer: Buffer.from(mp3) };
}

/** Vue reports render errors through console.error, so uncaught exceptions alone miss them. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

async function openSongInEditMode(page: Page, show: RecordModel, song: RecordModel): Promise<void> {
  await page.goto(`/show/${show.id}/song/${song.id}`);
  await page.getByRole("button", { name: "Toggle Edit Mode" }).click();
}

async function uploadStems(page: Page, files: UploadFile[]): Promise<void> {
  await page.locator("input[type=file][accept='audio/*']").setInputFiles(files);
}

async function waitForTracks(admin: PocketBase, songId: string, count: number): Promise<RecordModel> {
  await expect.poll(async () => (await admin.collection("songs").getOne(songId)).tracks.length).toBe(count);
  return admin.collection("songs").getOne(songId);
}

function trackFileStems(song: RecordModel): Record<string, string> {
  return Object.fromEntries(song.tracks.map((track: SongTrack) => [track.title, track.audioFile.replace(/_[a-z0-9]+\.mp3$/i, "")]));
}

test.describe("audio upload", () => {
  test("a single vocal stem creates a playable track", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none" }));
    const errors = collectPageErrors(page);

    await loginAs(owner);
    await openSongInEditMode(page, show, song);
    await page.getByRole("button", { name: "MP3" }).click();
    await uploadStems(page, [await buildStem("solo", "solo.mp3")]);

    const stored = await waitForTracks(admin, song.id, 1);
    expect(stored.audioFiles).toHaveLength(1);
    expect(stored.tracks[0]).toMatchObject({ title: "Solo", classification: "Vocal", audioFile: stored.audioFiles[0] });

    await expect(page.getByRole("heading", { name: "Vocal", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Accompaniment", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("several stems uploaded at once each link to their own file", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none" }));
    const errors = collectPageErrors(page);

    await loginAs(owner);
    await openSongInEditMode(page, show, song);
    await page.getByRole("button", { name: "MP3" }).click();
    await uploadStems(page, [await buildStem("solo", "solo.mp3"), await buildStem("piano", "piano.mp3")]);

    const stored = await waitForTracks(admin, song.id, 2);
    expect(trackFileStems(stored)).toEqual({ Solo: "solo", Piano: "piano" });
    expect(stored.tracks.map((t: SongTrack) => t.classification)).toEqual(["Vocal", "Accompaniment"]);

    await expect(page.getByRole("heading", { name: "Vocal", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Accompaniment", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("uploading to a song with audio keeps existing tracks linked", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    const errors = collectPageErrors(page);

    await loginAs(owner);
    await openSongInEditMode(page, show, song);
    await uploadStems(page, [await buildStem("solo", "extra-vocals.mp3")]);

    const stored = await waitForTracks(admin, song.id, song.tracks.length + 1);
    expect(stored.audioFiles).toHaveLength(song.audioFiles.length + 1);
    expect(stored.tracks.slice(0, -1)).toEqual(song.tracks);
    expect(stored.tracks.at(-1)).toMatchObject({ title: "Extra Vocals", classification: "Vocal" });
    expect(stored.audioFiles).toContain(stored.tracks.at(-1).audioFile);
    expect(song.audioFiles).not.toContain(stored.tracks.at(-1).audioFile);
    expect(errors).toEqual([]);
  });

  test("deleting the only track removes its file and returns to mode selection", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none" }));
    const errors = collectPageErrors(page);

    await loginAs(owner);
    await openSongInEditMode(page, show, song);
    await page.getByRole("button", { name: "MP3" }).click();
    await uploadStems(page, [await buildStem("solo", "solo.mp3")]);
    await waitForTracks(admin, song.id, 1);

    await page.getByRole("button", { name: "Delete track" }).click();

    const stored = await waitForTracks(admin, song.id, 0);
    expect(stored.audioFiles).toEqual([]);
    await expect(page.getByRole("button", { name: "MP3" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
