# E2E Tests — Agent Guide

Extends the root `AGENTS.md`.

Playwright runs the built frontend in Chromium against a real PocketBase in Docker, covering what jsdom cannot: Web Audio, AudioWorklets, pdf.js workers, canvas.

```bash
npm run test:e2e                          # build, start backends, run all
npm run test:e2e -- e2e/tests/foo.spec.ts # one file
E2E_SKIP_BUILD=1 npm run test:e2e         # reuse the last build (only tests changed)
npm run e2e:serve                         # seeded backend + Vite dev server
npm run e2e:scores [-- <presetId>]        # regenerate committed score PDFs (MuseScore 4)
npx playwright show-trace <trace.zip>     # inspect a failure
```

Needs Docker and, once, `npx playwright install chromium`. CI runs the same.

## How a Run Works

1. `globalSetup.ts` builds the frontend (`e2e/.cache/dist`) and the backend image once per run.
2. Each worker starts its own PocketBase container (Testcontainers, tmpfs) and `vite preview` on a random port.
3. The frontend is built with `VITE_PB_URL="/"`; each preview proxies `/api` and `/_` to its backend, so one build serves parallel backends.
4. All app collections are truncated before each test; after each passing test the invariants in `harness/state.ts` check the whole database.

The backend is built from `BACKEND_REPOSITORY` at `BACKEND_COMMIT` (`config.ts`); bump it when the frontend needs newer migrations or hooks. `E2E_BACKEND_SOURCE=../choirchaos-pb` tests an unpushed local checkout.

## Writing Tests

Import `test` and `expect` from `harness/fixtures.ts`, never `@playwright/test`, or reset and invariants do not run.

| Fixture | Use |
|---|---|
| `admin` | Superuser SDK, bypasses rules; arrange and assert state |
| `factory` | `createUser`, `clientFor(user)`, `createShow(owner)`, `createSong(actor, show, bundle)`, created as that user so rules apply |
| `loginAs(user)` | Seeds the page's auth store; call before the first `page.goto()` |
| `snapshot()` | All app records, to prove a failed operation changed nothing |
| `invariants` | Override with `test.use({ invariants: [...] })` only for deliberately broken data |
| `page`, `baseURL` | Standard Playwright; `page.goto("/")` hits the worker's frontend |

- New cross-record or cross-field rules go into `DEFAULT_INVARIANTS` (`harness/state.ts`). It checks every song layer invariant (root guide, Song Model) and that a MIDI recording plays as many measures as its beat map has bars. The harness keeps its own copy of these rules and imports nothing from `src/`, so an app bug cannot hide in both; `harness.spec.ts` tests the harness.
- Prefer asserting backend state via `admin` over UI text, and references by ID, never label: `measureId(score, "3")`, `locationAt(score, "3", beat, occurrence)` (`generators/song.ts`).
- Arrange review flows through bundle fields (`layout.review`, `score.unnumberedBoxes`); `withoutBoxes(score)` removes all boxes.
- Upload with `chooseFiles()` (`harness/page.ts`, file chooser event); the app has no permanent `<input type=file>`.
- Vue reports render errors via `console.error`, not page errors: use `collectPageErrors()`.

### Finding Elements

By role and name (`getByRole`, `getByLabel`), never test ids or CSS. An element without a usable name gets one in the app.

| Area | Roles and names |
|---|---|
| Show page | Song rows are `row`s named by their cells. Members are `listitem`s of "People with access". |
| Score | Pages are `group`s "Page N". Boxes are buttons "Measure <label>" or "Box without a number" (`aria-pressed` when selected; the playing one `aria-current="location"`). Detection previews are images "Detected measure <label>" / "Detected box without a number". A drag pans, a click on empty space clears; while drawing a drag on a page draws. Without a PDF, the list "Measures" holds buttons "Measure <label>" that select and seek like boxes. |
| Score overlays | A section's first chip is a button named after it ("Repeat 14 to 15, 3 times"; playing: "..., pass 1 of 3"), marker chips buttons "Marker C" ("Marker D, 1st time" for repeated measures); both select in the editor (`aria-pressed`) and seek while rehearsing. Recorded repeats are images "Measures 19 to 20 recorded 4 times", jumps images "After 2, the recording continues at 4" (text "to 4"); clicks on them reach the box. Box descriptions list their overlays, including "Sync point" (`toHaveAccessibleDescription`). |
| Header | Slider "Position" with `aria-valuetext` naming measure and section ("20, 1st time, Vamp pass 1"). Section button "Vamp 2" / "Repeat 1/3". Button "Details" opens dialog "Song details". |
| Inspector | Region "Editor panel", headed by the selection ("Measure 2", "Measures 2 to 3", "Repeat 1 to 2", "Marker A", "Sync point at 3", "Recording pass 1 to 4, 1st time", "Add measures", "Song setup"), with "Undo", "Redo", "Clear selection". Measures: regions "Section" ("Repeat", "Vamp", "Cut" or "Select repeat 1 to 2"), "Markers" ("Add marker at 3"), "Recording", "Audio sync"; pass buttons ("2nd time") in group "Pass, follows the playhead"; "Delete measure 2" (alertdialog "Delete measure(s)"); overlap asks in alertdialog "Replace sections". Section: segmented "Kind", "Passes", comboboxes "Out" and "Vocals", "Remove section" (alertdialog). Marker: textbox "Name", "Move to playhead", "Delete marker A". Range handles are sliders ("Last measure of repeat 1 to 2", across passes "... of vamp 1, 1st time to 2, 2nd time") on the score and in the timeline: scope to region "Score" or "Timeline". Drawing ends with "Done"; a drawn box asks "How many measures" and "First number". |
| Recording | Selected measures: spinbutton "Recorded", `role="status"` with the new length. Nothing selected: list "The order the backing track plays the measures in" (buttons select passes), list "Duplicate boxes" ("Play as 2nd time of 1 to 2"). A pass: "Move earlier", "Move later", "Remove pass", "Edit as text" (textbox "Recording as text"). Dropping references opens alertdialog "Change the recording". |
| Audio sync | Selected measures: "Select sync point at 3" or "Sync to playhead". A sync point: textbox "Starts at", "Nudge earlier"/"Nudge later", "Sync to playhead", "Move to another measure" (combobox "Which measure starts at ..."), "Remove sync point at 3". Nothing selected: region "Audio sync" with the status ("every pass covered"). |
| Timeline | Region "Timeline" (editors; match `exact`, the panel content is also a region named "Collapse timeline ..."), lane lists "Markers", "Sections", "Recording", "Measures" holding only items in view. Measure cells are buttons "2, 2nd time" (never "Measure ...") that only seek; markers, sections, passes select. A pass without a sync point at its start adds ", no sync point at its start" to its name, and the checklist then has a button "Go to 1, 2nd time". A drag scrubs, one on a sync point moves it. "Zoom in", "Zoom out", "Fit to view" sit in the panel header, outside the region. The waveform is image "Waveform" with `data-zoom-scale` (samples per pixel) and `data-sample-rate` for converting sync point times to pixels from its left edge while the song fits. |

Inspector section buttons share names with the header's section button: scope to the editor panel and clear the selection (Escape) before reading playback.

### Playback Tests

`recordPlayback()` (`harness/playback.ts`) samples, in one `page.evaluate()` until a condition holds, the header's "Current measure" and section button, the "Position" slider (ms in audio, ticks in MIDI) and the highlighted box, so samples never mix two moments. `sequenceOf()` collapses them into measures or passes in playing order. Bars of a second or more keep this reliable, so playback specs use fast specs without a PDF (`withPdf: false`) unless they check boxes.

## Test Data Generators

`buildTimeline()` expands a `ScoreSpec` (`generators/score/types.ts`, presets in `presets.ts`) into bars and notes with a seeded RNG; every artefact derives from that timeline:

| Output | Function | Notes |
|---|---|---|
| MusicXML, `.mscz`, PDF, layout | `scripts/generateScores.ts` | Needs MuseScore; committed in `assets/scores/<id>/` |
| MIDI | `toMidiFile()` | One named track per part; the player matches tracks by name |
| Recording | `recordTimeline()` | The timeline played with `RecordedRepeat`s (written repeats, baked vamps); MIDI, beat map and audio render from it |
| MTI beat map | `toMtiJson()` | Passes named `N-k` or with `R` suffixes; ends with beat 1 of a terminal bar |
| MP3 stems | `renderPartStem()` + `encodeMp3()` | Deterministic additive synth |
| WAV | `encodeWav()` | Converted to MP3 by the backend |
| Song fields and files | `buildSongBundle(spec, { mode, repeats })` | `mode` `"midi"`, `"audio"` or `"none"`; `withPdf: false` skips the PDF. Writes `score` (`m1..mn`), `recording` (compressed like the beat map import, one warp marker per recorded bar in audio) and `arrangement` (rehearsal marks as markers, spec vamps as vamps) |

- Only PDFs are committed (they need MuseScore); MIDI, JSON and audio are generated in tests.
- `layout.json` hashes the MusicXML and `assets/conductor.mss`; `loadScoreAssets()` throws on a changed preset until `npm run e2e:scores -- <id>` is run and committed.
- Never reuse a preset's `seed`. Changing `timeline.ts` changes every preset, so regenerate all assets.

## Traps

- PocketBase renames uploads (`name_<random>.ext`): `createSong()` uploads first, then writes tracks with stored names. Do the same in new helpers.
- `songs` has no list rule: users read songs via `shows?expand=songs_via_show` or by id.
- The backend transcodes recordings: compare stored audio by duration, never content.
- MIDI playback downloads `webaudiofont` instruments at load: tests need network or a `page.route()` stub.
- MuseScore's `.mpos` coordinates scale with export resolution: `convertWithMuseScore()` pins `--image-resolution`, keep `MPOS_UNITS_PER_INCH` in sync.
- `e2e:serve` binds 8091 and 5174 (`E2E_SERVE_BACKEND_PORT`, `E2E_SERVE_FRONTEND_PORT`); right after a run, Testcontainers may hold the port a few seconds.
- `testcontainers` stays on 11.x (12.x needs Node 22.22+, the project supports Node 20); the `uuid` override in `package.json` patches its dockerode dependency.
