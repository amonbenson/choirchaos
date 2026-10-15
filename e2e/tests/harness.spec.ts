import { CONDUCTOR, MINIMAL } from "../generators/score/presets";
import { buildSongBundle } from "../generators/song";
import { expect, test } from "../harness/fixtures";

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
});
