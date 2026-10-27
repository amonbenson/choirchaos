import type { Page } from "@playwright/test";
import type PocketBase from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, locationAt, type SongSection } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { waitForPlayer } from "../harness/playback";

async function storedSections(admin: PocketBase, id: string): Promise<SongSection[]> {
  return (await admin.collection("songs").getOne(id)).arrangement.sections;
}

async function storedLabels(admin: PocketBase, id: string): Promise<string[]> {
  return (await admin.collection("songs").getOne(id)).score.measures.map((measure: { label: string }) => measure.label);
}

async function select(page: Page, first: string, last?: string): Promise<void> {
  await page.getByRole("button", { name: `Measure ${first}`, exact: true }).click();
  if (last) {
    await page.getByRole("button", { name: `Measure ${last}`, exact: true }).click({ modifiers: ["Shift"] });
  }
}

test.describe("undo", () => {
  test("an editor undoes and redoes edits with the buttons and the keyboard", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const editor = await factory.createUser();
    const show = await factory.createShow(owner, { editors: [editor] });
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio" });
    const song = await factory.createSong(owner, show, bundle);
    const { score } = bundle.fields;
    const errors = collectPageErrors(page);
    await loginAs(editor);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const undo = page.getByRole("button", { name: "Undo" });
    const redo = page.getByRole("button", { name: "Redo" });
    const panel = page.getByRole("region", { name: "Editor panel" });
    const create = panel.getByRole("region", { name: "Section" });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await select(page, "1", "2");
    await create.getByRole("button", { name: "Repeat", exact: true }).click();
    const repeat: SongSection = { kind: "repeat", from: locationAt(score, "1"), to: locationAt(score, "2", 3), passes: 2 };
    await expect.poll(() => storedSections(admin, song.id)).toEqual([repeat]);
    await select(page, "3");
    await create.getByRole("button", { name: "Cut", exact: true }).click();
    const cut: SongSection = { kind: "cut", from: locationAt(score, "3"), to: locationAt(score, "3", 3) };
    await expect.poll(() => storedSections(admin, song.id)).toEqual([repeat, cut]);

    await undo.click();
    await expect.poll(() => storedSections(admin, song.id)).toEqual([repeat]);
    await expect(redo).toBeEnabled();

    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => storedSections(admin, song.id)).toEqual([]);
    await expect(undo).toBeDisabled();

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => storedSections(admin, song.id)).toEqual([repeat]);
    await redo.click();
    await expect.poll(() => storedSections(admin, song.id)).toEqual([repeat, cut]);
    await expect(redo).toBeDisabled();

    // A focused field keeps the keys for its own text.
    await select(page, "1");
    await create.getByRole("button", { name: "Select repeat 1 to 2" }).click();
    await panel.getByLabel("Passes").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(500);
    expect(await storedSections(admin, song.id)).toEqual([repeat, cut]);

    // Renaming a measure is a score edit, which undo covers like the arrangement.
    await select(page, "4");
    await panel.getByLabel("Number").fill("4a");
    await panel.getByLabel("Number").press("Enter");
    await expect.poll(() => storedLabels(admin, song.id)).toContain("4a");
    await undo.click();
    await expect.poll(() => storedLabels(admin, song.id)).not.toContain("4a");
    await expect(page.getByRole("button", { name: "Measure 4", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("leaving the editor clears the history", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    await select(page, "1");
    await page.getByRole("region", { name: "Section" }).getByRole("button", { name: "Cut", exact: true }).click();
    await expect.poll(() => storedSections(admin, song.id)).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
