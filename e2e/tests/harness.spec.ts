import type { RepeatLabels } from "../generators/recording";
import { CONDUCTOR, MINIMAL } from "../generators/score/presets";
import { buildSongBundle, locationAt } from "../generators/song";
import { expect, test } from "../harness/fixtures";
import { findInvariantViolations } from "../harness/state";

// Checks the harness itself, not app behaviour: the backend, the proxied frontend and the
// generators must work together before feature tests can rely on them.
test.describe("e2e harness", () => {
  test("backend starts empty with the known superuser", async ({ admin, snapshot }) => {
    expect(admin.authStore.isSuperuser).toBe(true);

    const { records } = await snapshot();
    expect(Object.keys(records).sort()).toEqual(["shows", "songs", "users"]);
    expect(Object.values(records).flat()).toEqual([]);
  });

  test("generated songs upload in every mode", async ({ factory }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);

    const midiSong = await factory.createSong(owner, show, await buildSongBundle(CONDUCTOR, { mode: "midi" }));
    const audioSong = await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
    await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "midi", repeats: [{ from: "2", to: "3", passes: 2 }] }));
    await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio", repeats: [{ from: "1", to: "2", passes: 3 }] }));

    expect(midiSong.midiFile).not.toBe("");
    expect(midiSong.pdfFile).not.toBe("");
    expect(audioSong.audioFiles).toHaveLength(MINIMAL.parts.length);
  });

  test("frontend reaches the backend through its proxy", async ({ page, factory, loginAs, baseURL }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    await loginAs(owner);

    const showsResponse = page.waitForResponse(response => response.url().includes("/api/collections/shows/records"));
    await page.goto("/");
    const response = await showsResponse;

    expect(new URL(response.url()).origin).toBe(new URL(baseURL!).origin);
    expect((await response.json()).items.map((item: { id: string }) => item.id)).toEqual([show.id]);
  });

  for (const [labels, expected] of [["dash", ["1", "2-1", "3-1", "2-2", "3-2", "4", "5"]], ["R", ["1", "2", "3", "2R", "3R", "4", "5"]]] as [RepeatLabels, string[]][]) {
    test(`recorded repeats with ${labels} labels end with a terminal bar in the beat map`, async () => {
      const bundle = await buildSongBundle(MINIMAL, { mode: "midi", withPdf: false, repeats: [{ from: "2", to: "3", passes: 2, labels }] });
      const beatMap = JSON.parse(await bundle.files.jsonFile!.text());
      const downbeats = beatMap.score.events.filter((e: { type: string; value: { beat: number } }) => e.type === "BEAT" && e.value.beat === 1);

      expect(downbeats.map((e: { value: { meas: string } }) => e.value.meas)).toEqual(expected);
    });
  }

  test("the invariants reject layers the frontend cannot load", async ({ admin, factory }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio", withPdf: false });
    const { score, recording, arrangement } = bundle.fields;
    const song = await factory.createSong(owner, show, bundle);

    await admin.collection("songs").update(song.id, {
      score: { ...score, measures: score.measures.map(m => m.label === "2" ? { ...m, label: "1" } : m) },
      recording: { ...recording, warpMarkers: [...recording.warpMarkers, { measure: recording.warpMarkers[0]!.measure, occurrence: 2, time: 99 }] },
      arrangement: {
        ...arrangement,
        markers: [{ at: locationAt(score, "3", 7), text: "Late" }],
        sections: [
          { kind: "repeat", from: locationAt(score, "1"), to: locationAt(score, "3"), passes: 2 },
          { kind: "cut", from: locationAt(score, "2"), to: locationAt(score, "4") },
        ],
      },
    });
    const violations = await findInvariantViolations(admin);
    await admin.collection("songs").delete(song.id);

    expect(violations).toEqual([
      expect.stringContaining("has an empty or duplicate label"),
      expect.stringContaining("is not in the recording"),
      expect.stringContaining("marker 'Late' at"),
      expect.stringContaining("overlaps another section"),
    ]);
  });

  test("the invariants accept an end sync point only after the last sync point", async ({ admin, factory }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    const bundle = await buildSongBundle(MINIMAL, { mode: "audio", withPdf: false });
    const { recording } = bundle.fields;
    const last = recording.warpMarkers.at(-1)!.time;
    const song = await factory.createSong(owner, show, bundle);

    await admin.collection("songs").update(song.id, { recording: { ...recording, endSyncTime: last + 1 } });
    const valid = await findInvariantViolations(admin);
    await admin.collection("songs").update(song.id, { recording: { ...recording, endSyncTime: last } });
    const early = await findInvariantViolations(admin);
    await admin.collection("songs").delete(song.id);

    expect(valid).toEqual([]);
    expect(early).toEqual([expect.stringContaining("do not strictly increase")]);
  });
});
