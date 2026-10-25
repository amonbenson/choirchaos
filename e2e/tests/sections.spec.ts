import type PocketBase from "pocketbase";

import { MINIMAL } from "../generators/score/presets";
import type { ScoreSpec } from "../generators/score/types";
import { buildSongBundle, locationAt, recordedBarTimes, type SongSection } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { recordPlayback, sequenceOf, waitForPlayer } from "../harness/playback";

/** Eight one-second bars, room for three sections of two bars each. */
const EIGHT_BARS: ScoreSpec = { ...MINIMAL, id: "eight-bars", title: "Eight Bars", seed: 102, tempo: 240, sections: [{ measures: 8 }] };

const MS_PER_SECOND = 1000;

async function storedSections(admin: PocketBase, id: string): Promise<SongSection[]> {
  return (await admin.collection("songs").getOne(id)).arrangement.sections;
}

test.describe("sections", () => {
  test("an editor adds, edits and removes sections, and playback follows", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const editor = await factory.createUser();
    const show = await factory.createShow(owner, { editors: [editor] });
    const bundle = await buildSongBundle(EIGHT_BARS, { mode: "audio", withPdf: false });
    const song = await factory.createSong(owner, show, bundle);
    const { score } = bundle.fields;
    const errors = collectPageErrors(page);
    await loginAs(editor);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    await page.getByRole("tab", { name: "Sections" }).click();
    const panel = page.getByRole("tabpanel", { name: "Sections" });
    const list = panel.getByRole("list", { name: "Sections" });

    for (const kind of ["Vamp", "Repeat", "Cut"]) {
      await panel.getByRole("button", { name: "Add section" }).click();
      await page.getByRole("menuitem", { name: kind }).click();
    }

    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByRole("group", { name: "Vamp from 1 to 2" })).toBeVisible();
    await expect(list.getByRole("group", { name: "Repeat from 3 to 4" })).toContainText("Recorded once");
    await expect(list.getByRole("group", { name: "Cut from 5 to 6" })).toBeVisible();
    const vamp: SongSection = { kind: "vamp", from: locationAt(score, "1"), to: locationAt(score, "2", 3), passes: 0, out: "onEnd", vocals: "all" };
    const repeat: SongSection = { kind: "repeat", from: locationAt(score, "3"), to: locationAt(score, "4", 3), passes: 2 };
    const cut: SongSection = { kind: "cut", from: locationAt(score, "5"), to: locationAt(score, "6", 3) };
    await expect.poll(() => storedSections(admin, song.id)).toEqual([vamp, repeat, cut]);

    const passes = panel.getByLabel("Passes of repeat from 3 to 4");
    await passes.fill("3");
    await passes.press("Enter");
    await expect.poll(() => storedSections(admin, song.id)).toEqual([vamp, { ...repeat, passes: 3 }, cut]);

    const cutStart = panel.getByLabel("Measure of start of cut from 5 to 6");
    await cutStart.fill("4");
    await cutStart.press("Enter");
    await expect(cutStart).toHaveAttribute("aria-invalid", "true");
    await expect(cutStart).toHaveAccessibleDescription("Sections must not overlap.");
    expect(await storedSections(admin, song.id)).toEqual([vamp, { ...repeat, passes: 3 }, cut]);
    await cutStart.press("Escape");
    await expect(cutStart).toHaveValue("5");

    await panel.getByRole("button", { name: "Delete vamp from 1 to 2" }).click();
    await page.getByRole("button", { name: "Delete section" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect.poll(() => storedSections(admin, song.id)).toEqual([{ ...repeat, passes: 3 }, cut]);

    await page.getByRole("button", { name: "Play / Pause" }).click();
    const samples = await recordPlayback(page, sample => sample.measure === "7");
    const times = recordedBarTimes(bundle).map(seconds => seconds * MS_PER_SECOND);

    expect(sequenceOf(samples, "measure")).toEqual(["1", "2", "3", "4", "3", "4", "3", "4", "7"]);
    expect(sequenceOf(samples, "section")).toEqual(["Vamp", "Repeat 1/3", "Repeat 2/3", "Repeat 3/3", "Vamp"]);
    expect(samples.filter(sample => sample.position >= times[4]! && sample.position < times[6]!)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
