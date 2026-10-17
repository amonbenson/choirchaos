import type { Locator, Page } from "@playwright/test";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import { encodeMp3, encodeWav, type PcmAudio, renderPartStem } from "../generators/audio";
import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, type SongTrack } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { chooseFiles, collectPageErrors, type UploadFile } from "../harness/page";

async function renderStem(partId: string): Promise<PcmAudio> {
  const bundle = await buildSongBundle(MINIMAL, { mode: "none", withPdf: false });
  return renderPartStem(bundle.timeline, partId);
}

async function buildStem(partId: string, name: string): Promise<UploadFile> {
  const mp3 = await encodeMp3(await renderStem(partId));
  return { name, mimeType: "audio/mpeg", buffer: Buffer.from(mp3) };
}

async function buildWavStem(partId: string, name: string): Promise<UploadFile> {
  return { name, mimeType: "audio/wav", buffer: Buffer.from(encodeWav(await renderStem(partId))) };
}

function isMpegAudio(bytes: Uint8Array): boolean {
  const startsWithId3 = String.fromCharCode(...bytes.slice(0, 3)) === "ID3";
  const startsWithFrameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  return startsWithId3 || startsWithFrameSync;
}

async function openSongDetails(page: Page, show: RecordModel, song: RecordModel): Promise<Locator> {
  await page.goto(`/show/${show.id}/song/${song.id}/edit`);
  await page.getByRole("tab", { name: "Details" }).click();
  return page.getByRole("tabpanel", { name: "Details" });
}

// After saving, the panel starts over from the stored song, so there is nothing left to save.
async function addRecordings(panel: Locator, files: UploadFile[]): Promise<void> {
  await panel.getByRole("button", { name: "Recordings", exact: true }).click();
  await chooseFiles(panel.page(), panel.getByRole("button", { name: "Add recordings" }), files);
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled({ timeout: 30_000 });
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
    const panel = await openSongDetails(page, show, song);
    await addRecordings(panel, [await buildStem("solo", "solo.mp3")]);

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
    const panel = await openSongDetails(page, show, song);
    await addRecordings(panel, [await buildStem("solo", "solo.mp3"), await buildStem("piano", "piano.mp3")]);

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
    const panel = await openSongDetails(page, show, song);
    await addRecordings(panel, [await buildStem("solo", "extra-vocals.mp3")]);

    const stored = await waitForTracks(admin, song.id, song.tracks.length + 1);
    expect(stored.audioFiles).toHaveLength(song.audioFiles.length + 1);
    expect(stored.tracks.slice(0, -1)).toEqual(song.tracks);
    expect(stored.tracks.at(-1)).toMatchObject({ title: "Extra Vocals", classification: "Vocal" });
    expect(stored.audioFiles).toContain(stored.tracks.at(-1).audioFile);
    expect(song.audioFiles).not.toContain(stored.tracks.at(-1).audioFile);
    expect(errors).toEqual([]);
  });

  test("a WAV recording is stored as MP3 and plays", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none" }));
    const errors = collectPageErrors(page);

    await loginAs(owner);
    const panel = await openSongDetails(page, show, song);
    await addRecordings(panel, [await buildWavStem("solo", "solo.wav")]);

    const stored = await waitForTracks(admin, song.id, 1);
    expect(stored.audioFiles).toEqual([expect.stringMatching(/^solo_[a-z0-9]+\.mp3$/)]);
    expect(stored.tracks[0]).toMatchObject({ title: "Solo", audioFile: stored.audioFiles[0] });

    const response = await fetch(admin.files.getURL(stored, stored.audioFiles[0]));
    expect(isMpegAudio(new Uint8Array(await response.arrayBuffer()))).toBe(true);

    await expect(page.locator("[data-zoom-scale]")).not.toHaveAttribute("data-zoom-scale", "0");
    expect(errors).toEqual([]);
  });

  test("a file that is not audio is rejected and nothing is stored", async ({ page, factory, loginAs, snapshot }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none" }));
    const broken = { name: "solo.wav", mimeType: "audio/wav", buffer: Buffer.from("not audio") };

    await loginAs(owner);
    const panel = await openSongDetails(page, show, song);
    const before = await snapshot();

    await panel.getByRole("button", { name: "Recordings", exact: true }).click();
    await chooseFiles(page, panel.getByRole("button", { name: "Add recordings" }), [broken]);
    await panel.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Could not read 'solo.wav' as audio.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(await snapshot()).toEqual(before);
  });

  test("removing the only recording removes its file and track", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none" }));
    const errors = collectPageErrors(page);

    await loginAs(owner);
    const panel = await openSongDetails(page, show, song);
    await addRecordings(panel, [await buildStem("solo", "solo.mp3")]);
    await waitForTracks(admin, song.id, 1);

    await panel.getByRole("button", { name: "Remove Solo" }).click();
    await panel.getByRole("button", { name: "Save" }).click();

    const stored = await waitForTracks(admin, song.id, 0);
    expect(stored.audioFiles).toEqual([]);
    await expect(page.getByRole("button", { name: "Add playback" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
