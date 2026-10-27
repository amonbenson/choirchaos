import { CONDUCTOR } from "../generators/score/presets";
import { buildSongBundle, locationAt, type SongBundle } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { waitForPlayer } from "../harness/playback";

/** The conductor score with the vamp at 19 to 20 recorded four times, a repeat of 14 to 15 and a cut of 16 to 17. */
async function buildArrangedSong(): Promise<SongBundle> {
  const bundle = await buildSongBundle(CONDUCTOR, { mode: "audio", repeats: [{ from: "19", to: "20", passes: 4 }] });
  const { score, arrangement } = bundle.fields;
  arrangement.sections = [
    { kind: "repeat", from: locationAt(score, "14"), to: locationAt(score, "15", 2), passes: 3 },
    { kind: "cut", from: locationAt(score, "16"), to: locationAt(score, "17", 2) },
    ...arrangement.sections,
  ];
  return bundle;
}

test.describe("visible arrangement", () => {
  test("the player shows sections, recorded repeats and markers on the score", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const viewer = await factory.createUser();
    const show = await factory.createShow(owner, { viewers: [viewer] });
    const song = await factory.createSong(owner, show, await buildArrangedSong());
    const errors = collectPageErrors(page);
    await loginAs(viewer);

    await page.goto(`/show/${show.id}/song/${song.id}`);
    await waitForPlayer(page);
    const score = page.getByRole("region", { name: "Score" });

    await expect(score.getByRole("button", { name: "Repeat 14 to 15, 3 times" })).toHaveText("Repeat 3×");
    await expect(score.getByRole("button", { name: "Cut 16 to 17" })).toHaveText("Cut");
    await expect(score.getByRole("button", { name: "Vamp 19 to 20" })).toHaveText("Vamp");
    await expect(score.getByRole("img", { name: "Measures 19 to 20 recorded 4 times" })).toHaveText("×4");
    await expect(score.getByRole("button", { name: "Measure 19" }))
      .toHaveAccessibleDescription("Vamp 19 to 20. Recorded 4 times. Marker D, 1st time.");
    await expect(score.getByRole("button", { name: "Measure 13" })).toHaveAccessibleDescription("Marker C.");

    await score.getByRole("button", { name: "Measure 14" }).click();

    await expect(score.getByRole("button", { name: "Repeat 14 to 15, pass 1 of 3" })).toHaveText("Repeat 1/3");
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", "14, Repeat pass 1 of 3");

    await score.getByRole("button", { name: "Measure 20" }).click();

    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", "20, 1st time, Vamp pass 1");
    expect(errors).toEqual([]);
  });

  test("an editor selects a section or marker by its badge on the score", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildArrangedSong());
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const score = page.getByRole("region", { name: "Score" });
    const panel = page.getByRole("region", { name: "Editor panel" });

    await score.getByRole("button", { name: "Vamp 19 to 20" }).click();

    await expect(panel.getByRole("heading", { name: "Vamp 19 to 20" })).toBeVisible();
    await expect(score.getByRole("button", { name: "Vamp 19 to 20" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^19, 1st time/);

    await score.getByRole("button", { name: "Marker C" }).click();

    await expect(panel.getByRole("heading", { name: "Marker C" })).toBeVisible();
    await expect(score.getByRole("button", { name: "Vamp 19 to 20" })).toHaveAttribute("aria-pressed", "false");

    await score.getByRole("img", { name: "Measures 19 to 20 recorded 4 times" }).click();

    await expect(panel.getByRole("heading", { name: "Measure 20" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
