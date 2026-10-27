import type { Page } from "@playwright/test";
import type PocketBase from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, locationAt, type SongSection } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { recordPlayback, sequenceOf, waitForPlayer } from "../harness/playback";

async function storedSections(admin: PocketBase, id: string): Promise<SongSection[]> {
  return (await admin.collection("songs").getOne(id)).arrangement.sections;
}

async function select(page: Page, first: string, last?: string): Promise<void> {
  await page.getByRole("button", { name: `Measure ${first}`, exact: true }).click();
  if (last) {
    await page.getByRole("button", { name: `Measure ${last}`, exact: true }).click({ modifiers: ["Shift"] });
  }
}

test.describe("sections", () => {
  test("an editor repeats, cuts and vamps selected measures, and playback follows", async ({ page, admin, factory, loginAs }) => {
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
    const panel = page.getByRole("region", { name: "Editor panel" });
    const create = panel.getByRole("region", { name: "Section" });

    await select(page, "1", "2");
    await create.getByRole("button", { name: "Repeat", exact: true }).click();
    const repeat: SongSection = { kind: "repeat", from: locationAt(score, "1"), to: locationAt(score, "2", 3), passes: 2 };
    await expect.poll(() => storedSections(admin, song.id)).toEqual([repeat]);
    await expect(panel.getByRole("heading", { name: "Repeat 1 to 2" })).toBeVisible();
    await panel.getByLabel("Passes").fill("3");
    await panel.getByLabel("Passes").press("Enter");
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }]);

    await select(page, "3");
    await create.getByRole("button", { name: "Cut", exact: true }).click();
    const cut: SongSection = { kind: "cut", from: locationAt(score, "3"), to: locationAt(score, "3", 3) };
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut]);

    await select(page, "4");
    await create.getByRole("button", { name: "Vamp", exact: true }).click();
    const vamp: SongSection = { kind: "vamp", from: locationAt(score, "4"), to: locationAt(score, "4", 3), out: "onEnd", vocals: "all" };
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut, vamp]);
    await expect(panel.getByLabel("Passes")).toHaveCount(0);
    await panel.getByRole("combobox", { name: "Out" }).click();
    await page.getByRole("option", { name: "Any measure" }).click();
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut, { ...vamp, out: "anyBar" }]);

    await select(page, "2", "3");
    await create.getByRole("button", { name: "Vamp", exact: true }).click();
    const replace = page.getByRole("alertdialog", { name: "Replace sections" });
    await expect(replace).toContainText("These measures overlap repeat 1 to 2 and cut 3. Replace them with a vamp?");
    await replace.getByRole("button", { name: "Cancel" }).click();
    expect(await storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut, { ...vamp, out: "anyBar" }]);

    await select(page, "4");
    await create.getByRole("button", { name: "Select vamp 4" }).click();
    await panel.getByRole("button", { name: "Remove section" }).click();
    await page.getByRole("alertdialog", { name: "Remove section" }).getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut]);

    await select(page, "1");
    await expect(create).toContainText("Part of Repeat 1 to 2");
    await create.getByRole("button", { name: "Select repeat 1 to 2" }).click();
    const last = page.getByRole("slider", { name: "Last measure of repeat 1 to 2" });
    await last.focus();
    await last.press("ArrowLeft");
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, to: locationAt(score, "1", 3), passes: 3 }, cut]);
    await page.getByRole("slider", { name: "Last measure of repeat 1" }).press("ArrowRight");
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut]);

    // The kind buttons share their names with the header's section button that the playback samples read.
    await select(page, "1");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Play / Pause" }).click();
    const samples = await recordPlayback(page, sample => sample.measure === "4");

    expect(sequenceOf(samples, "measure")).toEqual(["1", "2", "1", "2", "1", "2", "4"]);
    expect(sequenceOf(samples, "section").filter(section => section.startsWith("Repeat"))).toEqual(["Repeat 1/3", "Repeat 2/3", "Repeat 3/3"]);
    expect(errors).toEqual([]);
  });
});
