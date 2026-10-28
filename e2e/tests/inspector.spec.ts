import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, locationAt, type SongBundleOptions } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { waitForPlayer } from "../harness/playback";

/** Measures 1 to 2 are recorded twice, so the recording plays 1, 2, 1, 2, 3, 4. */
const REPEATED: SongBundleOptions = { mode: "audio", repeats: [{ from: "1", to: "2", passes: 2 }] };

test.describe("inspector", () => {
  test("a click on the score selects the measure at its first pass, and the pass picker moves to another", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, REPEATED);
    const song = await factory.createSong(owner, show, bundle);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const panel = page.getByRole("region", { name: "Editor panel" });
    const position = page.getByRole("slider", { name: "Position" });
    await expect(panel.getByRole("heading", { name: "Song setup" })).toBeVisible();

    await page.getByRole("button", { name: "Measure 2", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Measure 2" })).toBeVisible();
    await expect(panel).toContainText("The recording plays it 2 times");
    await expect(page.getByRole("button", { name: "Measure 2", exact: true })).toHaveAttribute("aria-current", "location");
    await expect(position).toHaveAttribute("aria-valuetext", /^2, 1st time/);
    const times = panel.getByRole("group", { name: "Pass, follows the playhead" });
    await expect(times.getByRole("button", { name: "1st time" })).toHaveAttribute("aria-pressed", "true");

    await times.getByRole("button", { name: "2nd time" }).click();
    await expect(position).toHaveAttribute("aria-valuetext", /^2, 2nd time/);
    await expect(times.getByRole("button", { name: "2nd time" })).toHaveAttribute("aria-pressed", "true");

    await panel.getByRole("region", { name: "Markers" }).getByRole("button", { name: "Add marker at 2, 2nd time" }).click();
    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).arrangement.markers)
      .toEqual([{ at: locationAt(bundle.fields.score, "2", 0, 2), text: "A" }]);
    await expect(panel.getByRole("heading", { name: "Marker A" })).toBeVisible();

    // Wherever the playhead is, a click enters a repeated measure at its first pass.
    await page.getByRole("button", { name: "Measure 4", exact: true }).click();
    await page.getByRole("button", { name: "Measure 1", exact: true }).click();
    await expect(position).toHaveAttribute("aria-valuetext", /^1, 1st time/);

    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(panel.getByRole("heading", { name: "Song setup" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("song details open as a dialog from the editor", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Song details" });
    await expect(page).toHaveURL(/\?details=1$/);
    await dialog.getByLabel("Title").fill("Renamed");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/details/);
    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).title).toBe("Renamed");
  });

  test("rehearsers seek with a click and see no editing", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const viewer = await factory.createUser();
    const show = await factory.createShow(owner, { viewers: [viewer] });
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, REPEATED));
    await loginAs(viewer);

    await page.goto(`/show/${show.id}/song/${song.id}`);
    await waitForPlayer(page);
    await page.getByRole("button", { name: "Measure 3", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^3/);
    await page.getByRole("button", { name: "Measure 2", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^2, 1st time/);

    await expect(page.getByRole("button", { name: "Measure 3", exact: true })).not.toHaveAttribute("aria-pressed");
    await expect(page.getByRole("region", { name: "Editor panel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);
    await expect(page.getByRole("slider", { name: /measure of/ })).toHaveCount(0);
  });
});
