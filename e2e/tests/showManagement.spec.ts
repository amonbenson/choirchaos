import type { RecordModel } from "pocketbase";

import { CONDUCTOR, MINIMAL } from "../generators/score/presets";
import { buildSongBundle } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { chooseFiles, collectPageErrors, toUploadFile, type UploadFile } from "../harness/page";

async function importBundleFiles(): Promise<UploadFile[]> {
  const audio = await buildSongBundle(MINIMAL, { mode: "audio" });
  const midi = await buildSongBundle(CONDUCTOR, { mode: "midi" });

  return [
    await toUploadFile(audio.files.pdfFile!, "01 Minimal.pdf"),
    await toUploadFile(audio.files.audioFiles[0]!, "01 Minimal - Solo.mp3"),
    await toUploadFile(audio.files.audioFiles[1]!, "01 Minimal - Piano.mp3"),
    await toUploadFile(midi.files.pdfFile!, "02 Conductor.pdf"),
    await toUploadFile(midi.files.midiFile!, "02 Conductor.mid"),
    await toUploadFile(midi.files.jsonFile!, "02 Conductor.json"),
    { name: "rehearsal-plan.txt", mimeType: "text/plain", buffer: Buffer.from("notes") },
  ];
}

test.describe("home page", () => {
  test("groups shows by ownership and hides empty sections", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser({ name: "Owner" });
    const other = await factory.createUser({ name: "Other" });
    await factory.createShow(owner, { title: "Own Show" });
    await factory.createShow(other, { title: "Public Show", visibility: "public" });

    await loginAs(owner);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "My shows" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Public" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shared with me" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "My shows" }).getByRole("link", { name: "Own Show" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Public" }).getByRole("link", { name: "Public Show" })).toBeVisible();
  });

  test("shows a single section without a heading to visitors", async ({ page, factory }) => {
    const owner = await factory.createUser();
    await factory.createShow(owner, { title: "Public Show", visibility: "public" });

    await page.goto("/");

    await expect(page.getByRole("link", { name: "Public Show" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New show" })).toHaveCount(0);
  });
});

test.describe("show management", () => {
  test("a new show is private, owned by its creator and opens for editing", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await page.goto("/");

    await page.getByRole("button", { name: "New show" }).click();
    await page.getByLabel("Title").fill("Spring Concert");
    await page.getByRole("button", { name: "Create show" }).click();

    await expect(page).toHaveURL(/\/show\/\w+\/edit$/);
    await expect(page.getByText("Add the songs of this show")).toBeVisible();
    const shows = await admin.collection("shows").getFullList();
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({ title: "Spring Concert", owner: owner.id, visibility: "private", editors: [], viewers: [] });
    expect(errors).toEqual([]);
  });

  test("importing files creates one song per number with its files, tracks and measures", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    await chooseFiles(page, page.getByRole("button", { name: "Choose files" }), await importBundleFiles());
    const dialog = page.getByRole("dialog", { name: "Import 7 files" });
    await expect(dialog.getByText("This file type is not supported.")).toBeVisible();
    await dialog.getByRole("button", { name: "Import 2 songs" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const songs = await admin.collection("songs").getFullList({ sort: "number" });
    expect(songs.map(s => [s.number, s.title, s.show])).toEqual([["1", "Minimal", show.id], ["2", "Conductor", show.id]]);

    const [audioSong, midiSong] = songs as [RecordModel, RecordModel];
    expect(audioSong.pdfFile).not.toBe("");
    expect(audioSong.audioFiles).toHaveLength(2);
    expect(audioSong.tracks.map((t: { title: string; classification: string }) => [t.title, t.classification]))
      .toEqual([["Solo", "Vocal"], ["Piano", "Accompaniment"]]);

    expect(midiSong.midiFile).not.toBe("");
    expect(midiSong.jsonFile).not.toBe("");
    expect(midiSong.tracks.map((t: { title: string }) => t.title)).toEqual(CONDUCTOR.parts.map(part => part.name));
    expect(midiSong.measures.length).toBeGreaterThan(0);

    await expect(page.getByTestId("song-row-1")).toContainText("2 recordings");
    await expect(page.getByTestId("song-row-2")).toContainText("MIDI");
    expect(errors).toEqual([]);
  });

  test("importing into an existing song adds files instead of creating a duplicate", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none", withPdf: false }));
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    const bundle = await buildSongBundle(MINIMAL, { mode: "none" });
    await chooseFiles(page, page.getByRole("button", { name: "Import files" }), [await toUploadFile(bundle.files.pdfFile!, `${MINIMAL.number} Minimal.pdf`)]);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`Update #${MINIMAL.number}`)).toBeVisible();
    await dialog.getByRole("button", { name: "Import 1 song" }).click();
    await expect(dialog).toBeHidden();

    const songs = await admin.collection("songs").getFullList();
    expect(songs).toHaveLength(1);
    expect(songs[0]!.pdfFile).not.toBe("");
    expect(songs[0]!.title).toBe(MINIMAL.title);
  });

  test("song details rename, renumber and delete a song", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none", withPdf: false }));
    await factory.createSong(owner, show, await buildSongBundle(CONDUCTOR, { mode: "none", withPdf: false }));
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    await page.getByTestId(`song-row-${song.number}`).click();
    const dialog = page.getByRole("dialog", { name: "Song details" });
    await dialog.getByLabel("No.").fill(CONDUCTOR.number);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText(`Song ${CONDUCTOR.number} already exists.`)).toBeVisible();

    await dialog.getByLabel("No.").fill("12a");
    await dialog.getByLabel("Title").fill("Renamed");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).title).toBe("Renamed");
    expect((await admin.collection("songs").getOne(song.id)).number).toBe("12a");

    await page.getByTestId("song-row-12a").click();
    await dialog.getByRole("button", { name: "Delete song" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete song" }).click();
    await expect(page.getByTestId("song-row-12a")).toHaveCount(0);
    expect(await admin.collection("songs").getFullList()).toHaveLength(1);
  });

  test("a new song created from the player opens right away", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none", withPdf: false }));
    await loginAs(owner);
    await page.goto(`/show/${show.id}/song/${song.id}`);

    await page.getByRole("combobox", { name: "Song" }).click();
    await page.getByRole("button", { name: "Add song" }).click();
    const dialog = page.getByRole("dialog", { name: "New song" });
    await dialog.getByLabel("Title").fill("Encore");
    await dialog.getByRole("button", { name: "Create song" }).click();

    await expect.poll(async () => (await admin.collection("songs").getFullList()).length).toBe(2);
    const created = (await admin.collection("songs").getFullList()).find(s => s.title === "Encore")!;
    await expect(page).toHaveURL(new RegExp(`/song/${created.id}$`));
  });

  test("deleting a show removes it with all its songs", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner, { title: "Old Show" });
    await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none", withPdf: false }));
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    await page.getByRole("button", { name: "Delete show" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete show" });
    const confirm = dialog.getByRole("button", { name: "Delete show" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill("Old Show");
    await confirm.click();

    await expect(page).toHaveURL(/\/$/);
    expect(await admin.collection("shows").getFullList()).toEqual([]);
    expect(await admin.collection("songs").getFullList()).toEqual([]);
  });

  test("editors manage songs but cannot delete the show", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const editor = await factory.createUser();
    const show = await factory.createShow(owner, { editors: [editor] });
    await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none", withPdf: false }));
    await loginAs(editor);
    await page.goto(`/show/${show.id}/edit`);

    await expect(page.getByRole("button", { name: "New song" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete show" })).toHaveCount(0);
  });

  test("viewers are sent to the player instead of the edit page", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const viewer = await factory.createUser();
    const show = await factory.createShow(owner, { viewers: [viewer] });
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "none", withPdf: false }));
    await loginAs(viewer);
    await page.goto(`/show/${show.id}/edit`);

    await expect(page).toHaveURL(new RegExp(`/show/${show.id}/song/${song.id}$`));
  });

  test("an empty show opens the edit page for editors", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    await loginAs(owner);
    await page.goto(`/show/${show.id}`);

    await expect(page).toHaveURL(new RegExp(`/show/${show.id}/edit$`));
  });
});

test.describe("not found page", () => {
  test("unknown addresses show a 404 page", async ({ page }) => {
    await page.goto("/this/does/not/exist");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page).toHaveURL(/\/this\/does\/not\/exist$/);
  });

  test("private shows offer visitors to sign in", async ({ page, factory }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);

    await page.goto(`/show/${show.id}`);

    await expect(page.getByRole("heading", { name: "Show not found" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?redirect=.*${show.id}`));
  });
});
