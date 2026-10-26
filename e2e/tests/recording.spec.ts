import { MINIMAL } from "../generators/score/presets";
import { buildSongBundle, type SongBundle, type SongMeasure } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";
import { waitForPlayer } from "../harness/playback";

/** IDs of the two measures that fake the second pass, inserted into the score after measure "2". */
const DUPLICATES = ["m5", "m6"];

/**
 * The minimal song recorded as 1, 2, 1, 2, 3, 4, stored the way old songs faked the repeat (as in
 * "Durchs Loch und mittendrin"): two extra measures whose boxes lie exactly on 1 and 2, one span over
 * everything, and a warp marker on every played measure. `labels` names the measures in score order.
 */
async function buildFakedRepeatSong(labels: string[]): Promise<SongBundle> {
  const bundle = await buildSongBundle(MINIMAL, { mode: "audio", repeats: [{ from: "1", to: "2", passes: 2 }] });
  const { score, recording } = bundle.fields;
  const [first, second, third, fourth] = score.measures as [SongMeasure, SongMeasure, SongMeasure, SongMeasure];
  const copies: SongMeasure[] = [first, second].map((original, i) => ({ ...original, id: DUPLICATES[i]! }));
  score.measures = [first, second, ...copies, third, fourth].map((measure, i) => ({ ...measure, label: labels[i]! }));

  const played = score.measures.map(measure => measure.id);
  recording.spans = [{ from: played[0]!, to: played.at(-1)! }];
  recording.warpMarkers = recording.warpMarkers.map((marker, position) => ({ measure: played[position]!, occurrence: 1, time: marker.time }));
  return bundle;
}

test.describe("recording editing", () => {
  test("duplicate boxes become the second time of the measures they lie on", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildFakedRepeatSong(["1", "2", "2a", "2b", "3", "4"]);
    const song = await factory.createSong(owner, show, bundle);
    const times = bundle.fields.recording.warpMarkers.map(marker => marker.time);
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const panel = page.getByRole("region", { name: "Editor panel" });
    const proposals = panel.getByRole("list", { name: "Duplicate boxes" });
    await expect(proposals).toContainText("Measures 2a to 2b lie exactly on top of 1 to 2");
    await expect(proposals).toContainText("Recording becomes 1-2 x2, 3-4.");

    await proposals.getByRole("button", { name: "Play as 2nd time of 1 to 2" }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).recording).toEqual({
      spans: [{ from: "m1", to: "m2" }, { from: "m1", to: "m2" }, { from: "m3", to: "m4" }],
      warpMarkers: [
        { measure: "m1", occurrence: 1, time: times[0] },
        { measure: "m2", occurrence: 1, time: times[1] },
        { measure: "m1", occurrence: 2, time: times[2] },
        { measure: "m2", occurrence: 2, time: times[3] },
        { measure: "m3", occurrence: 1, time: times[4] },
        { measure: "m4", occurrence: 1, time: times[5] },
      ],
    });
    const stored = await admin.collection("songs").getOne(song.id);
    expect(stored.score.measures.map((measure: SongMeasure) => measure.label)).toEqual(["1", "2", "3", "4"]);
    await expect(proposals).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Score" }).getByRole("img", { name: "Measures 1 to 2 recorded 2 times" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "The order the backing track plays the measures in" }).getByRole("listitem"))
      .toHaveText([/^1 to 2\s*1st time$/, /^1 to 2\s*2nd time\s*after 2$/, /^3 to 4\s*after 2, 2nd time$/]);
    expect(errors).toEqual([]);
  });

  test("a warp marker, marker and vamp on the duplicates move to the second time", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    // As in "It's A Privilege To Pee (Reprise)", the duplicates carry plain numbers and the arrangement.
    const bundle = await buildFakedRepeatSong(["1", "2", "3", "4", "5", "6"]);
    bundle.fields.arrangement.markers = [{ at: { measure: "m6", beat: 2 }, text: "Breath" }];
    bundle.fields.arrangement.sections = [{
      kind: "vamp",
      from: { measure: "m5", beat: 0 },
      to: { measure: "m6", beat: 1 },
      passes: 0,
      out: "onEnd",
      vocals: "all",
    }];
    const song = await factory.createSong(owner, show, bundle);
    const vampTime = bundle.fields.recording.warpMarkers[2]!.time;
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const proposals = page.getByRole("region", { name: "Editor panel" }).getByRole("list", { name: "Duplicate boxes" });
    await expect(proposals).toContainText("Measures 3 to 4 lie exactly on top of 1 to 2");

    await proposals.getByRole("button", { name: "Play as 2nd time of 1 to 2" }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).arrangement).toEqual({
      markers: [{ at: { measure: "m2", beat: 2, occurrence: 2 }, text: "Breath" }],
      sections: [{
        kind: "vamp",
        from: { measure: "m1", beat: 0, occurrence: 2 },
        to: { measure: "m2", beat: 1, occurrence: 2 },
        passes: 0,
        out: "onEnd",
        vocals: "all",
      }],
      segue: false,
    });
    const stored = await admin.collection("songs").getOne(song.id);
    expect(stored.recording.warpMarkers[2]).toEqual({ measure: "m1", occurrence: 2, time: vampTime });
    expect(stored.score.measures.map((measure: SongMeasure) => measure.label)).toEqual(["1", "2", "5", "6"]);
  });

  test("editors record measures more than once and edit the recording as text", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const song = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    const errors = collectPageErrors(page);
    await loginAs(owner);

    await page.goto(`/show/${show.id}/song/${song.id}/edit`);
    await waitForPlayer(page);
    const panel = page.getByRole("region", { name: "Editor panel" });
    const score = page.getByRole("region", { name: "Score" });

    await score.getByRole("button", { name: "Measure 3", exact: true }).click();
    await score.getByRole("button", { name: "Measure 4", exact: true }).click({ modifiers: ["Shift"] });
    await expect(panel.getByRole("heading", { name: "Measures 3 to 4" })).toBeVisible();
    const recording = panel.getByRole("region", { name: "Recording" });
    await recording.getByRole("spinbutton", { name: "Recorded" }).press("ArrowUp");

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).recording.spans)
      .toEqual([{ from: "m1", to: "m4" }, { from: "m3", to: "m4" }]);
    await expect(recording.getByRole("status")).toHaveText("The recording now plays 6 measures.");
    await expect(score.getByRole("img", { name: "Measures 3 to 4 recorded 2 times" })).toBeVisible();

    await page.getByRole("button", { name: "Clear selection" }).click();
    await panel.getByRole("button", { name: "Edit as text" }).click();
    const text = panel.getByRole("textbox", { name: "Recording as text" });
    await expect(text).toHaveValue("1-4, 3-4");
    await text.fill("1-2, 9");
    await expect(panel).toContainText("There is no measure \"9\".");
    await text.fill("1-2, 1-4");
    await expect(panel).toContainText("The recording keeps playing 6 measures.");
    await text.fill("1-2, 4");
    await expect(panel).toContainText("The recording will play 3 measures instead of 6.");
    await panel.getByRole("button", { name: "Save" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Change the recording" });
    await expect(dialog).toContainText("the sync point at 3");
    await dialog.getByRole("button", { name: "Change recording" }).click();

    await expect.poll(async () => (await admin.collection("songs").getOne(song.id)).recording.spans)
      .toEqual([{ from: "m1", to: "m2" }, { from: "m4", to: "m4" }]);
    await expect(score.getByRole("img", { name: "After 2, the recording continues at 4" })).toHaveText("to 4");
    expect(errors).toEqual([]);
  });
});
