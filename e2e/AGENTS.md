# E2E Tests — Agent Guide

Extends the root `AGENTS.md`.

Playwright runs the built frontend in Chromium against a real PocketBase in Docker, covering what jsdom cannot: Web Audio, AudioWorklets, pdf.js workers, canvas.

```bash
npm run test:e2e -- e2e/tests/foo.spec.ts # one file
E2E_SKIP_BUILD=1 npm run test:e2e         # reuse the last build (only tests changed)
npm run e2e:scores [-- <presetId>]        # regenerate committed score PDFs (MuseScore 4)
npx playwright show-trace <trace.zip>     # inspect a failure
```

Needs Docker and, once, `npx playwright install chromium`.

## How a Run Works

- Each worker runs its own PocketBase container and `vite preview`. The frontend is built once with `VITE_PB_URL="/"` and each preview proxies to its backend.
- All app collections are truncated before each test; after each passing test the invariants in `harness/state.ts` check the whole database.
- The backend is built from `BACKEND_REPOSITORY` at `BACKEND_COMMIT` (`config.ts`): bump it when the frontend needs newer migrations or hooks. `E2E_BACKEND_SOURCE=../choirchaos-pb` tests an unpushed local checkout.

## Writing Tests

- Import `test` and `expect` from `harness/fixtures.ts`, never `@playwright/test`, or reset and invariants do not run. Fixtures: `admin` (superuser, arranges and asserts state), `factory` (creates records as a user, so rules apply), `loginAs(user)` (call before the first `page.goto()`), `snapshot()` (proves a failed operation changed nothing).
- New cross-record rules go into `DEFAULT_INVARIANTS`. The harness imports nothing from `src/`, so an app bug cannot hide in both; `harness.spec.ts` tests the harness.
- Assert backend state via `admin` rather than UI text, and references by ID, never label (`measureId()`, `locationAt()` in `generators/song.ts`).
- Find elements by role and name, never test ids or CSS; an element without a usable name gets one in the app. Scope to regions ("Editor panel", "Score", "Timeline") where names repeat, e.g. inspector section buttons share names with the header's section button. Timeline lanes only hold items in view.
- Upload with `chooseFiles()`: the app has no permanent `<input type=file>`.
- Vue reports render errors via `console.error`, not page errors: use `collectPageErrors()`.
- The "Position" slider's `aria-valuenow` is rounded to a thousandth of the song: compare exact times against stored data.

### Playback

`recordPlayback()` samples header, slider and highlighted box in one `page.evaluate()` until a condition holds, so samples never mix two moments; `sequenceOf()` collapses them into playing order. Bars of a second or more keep this reliable, so playback specs skip the PDF (`withPdf: false`) unless they check boxes.

## Test Data Generators

`buildTimeline()` expands a `ScoreSpec` (presets in `generators/score/presets.ts`) with a seeded RNG; MIDI, beat map, audio stems, PDF and the song's layers all derive from it, and `buildSongBundle()` assembles a song.
- Only PDFs are committed (they need MuseScore); everything else is generated in tests.
- `loadScoreAssets()` throws on a changed preset until `npm run e2e:scores -- <id>` is run and committed. Changing the timeline generator changes every preset, so regenerate all. Never reuse a preset's `seed`.

## Traps

- PocketBase renames uploads (`name_<random>.ext`): upload first, then write tracks with the stored names.
- `songs` has no list rule: read songs via `shows?expand=songs_via_show` or by id.
- The backend transcodes recordings: compare stored audio by duration, never content.
- MIDI playback downloads `webaudiofont` instruments at load: tests need network or a `page.route()` stub.
- MuseScore's `.mpos` coordinates scale with export resolution: `convertWithMuseScore()` pins `--image-resolution`, keep `MPOS_UNITS_PER_INCH` in sync.
- `e2e:serve` binds 8091 and 5174; right after a run, Testcontainers may hold the port a few seconds.
- `testcontainers` stays on 11.x (12.x needs Node 22.22+, the project supports Node 20); the `uuid` override in `package.json` patches its dockerode dependency.
