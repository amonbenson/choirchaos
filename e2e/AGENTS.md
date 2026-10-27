# E2E Tests — Agent Guide

Extends the root `AGENTS.md`, whose rules apply here too.

Playwright tests run the compiled frontend in Chromium against a real PocketBase backend in Docker. They cover what jsdom cannot run: Web Audio, AudioWorklets, pdf.js workers and canvas.

## Commands

```bash
npm run test:e2e                         # build frontend, start backends, run all e2e tests
npm run test:e2e -- e2e/tests/foo.spec.ts # single file
E2E_SKIP_BUILD=1 npm run test:e2e        # reuse the last frontend build (only test files changed)
npm run e2e:serve                        # seeded backend + Vite dev server for manual checks
npm run e2e:scores [-- <presetId>]       # regenerate committed score PDFs (needs MuseScore 4)
npx playwright show-trace <trace.zip>    # inspect a failed test
```

Requirements: Docker running, and Chromium installed once with `npx playwright install chromium`. CI runs the same command.

## How a Run Works

1. `globalSetup.ts` builds the frontend into `e2e/.cache/dist` and the backend image, once per run.
2. Each Playwright worker starts its own PocketBase container (Testcontainers, data in tmpfs) and its own `vite preview` server on a random port.
3. The frontend is built with `VITE_PB_URL="/"`. The preview server proxies `/api` and `/_` to its worker's backend, so one build serves any number of backends and parallel runs never collide.
4. Before every test, all app collections are truncated. After every passing test, the invariants in `harness/state.ts` check the whole database, so a test that leaves it inconsistent fails.

The backend is built from `BACKEND_REPOSITORY` at `BACKEND_COMMIT` (`config.ts`). Bump the commit whenever the frontend needs newer migrations or hooks. To test unpushed backend changes, set `E2E_BACKEND_SOURCE=../choirchaos-pb` (a local checkout, rebuilt on every run).

## Writing Tests

Import `test` and `expect` from `harness/fixtures.ts`, never from `@playwright/test`. Otherwise the reset and invariant fixtures do not run.

| Fixture | Use |
|---|---|
| `admin` | PocketBase SDK as superuser. Bypasses access rules. Use it to arrange and to assert state. |
| `factory` | `createUser`, `clientFor(user)`, `createShow(owner)`, `createSong(actor, show, bundle)`. Shows and songs are created as the given user, so access rules apply. |
| `loginAs(user)` | Seeds the SDK auth store in the page. Call before the first `page.goto()`. |
| `snapshot()` | All app records. Compare before and after a failed operation to prove nothing changed. |
| `invariants` | Option. Override with `test.use({ invariants: [...] })` only for tests that deliberately create broken data. |
| `page`, `baseURL` | Standard Playwright. `page.goto("/")` hits the worker's frontend. |

- When a feature adds a cross-record or cross-field rule, add it to `DEFAULT_INVARIANTS` in `harness/state.ts`, so every test checks it. It already checks every data invariant of the song layers (root guide, Song Model), plus that a MIDI song's recording plays as many measures as its beat map has bars. The harness keeps its own copy of these rules and imports nothing from `src/`, so an app bug cannot hide in both. `harness.spec.ts` checks the harness itself.
- Prefer asserting backend state through `admin` over asserting UI text. Assert stored references by measure ID, never by label: `measureId(score, "3")` and `locationAt(score, "3", beat, occurrence)` from `generators/song.ts` build them from a bundle's or record's `score`.
- To test review flows without running detection, arrange `layout.review` on measures and `score.unnumberedBoxes` through the bundle fields. `withoutBoxes(score)` removes every box.
- The app opens file dialogs from buttons without a permanent `<input type=file>`, so upload through `chooseFiles()` in `harness/page.ts`, which uses Playwright's file chooser event.
- Vue reports render errors through `console.error`, not as page errors. Use `collectPageErrors()`, which listens to both, to assert that a flow is error-free.

### Finding Elements

Locate elements by role and accessible name (`getByRole`, `getByLabel`), never by test ids or CSS. When an element has no usable name, give it one in the app instead of adding a test hook.

| Area | Roles and names |
|---|---|
| Show page | Song rows are `row`s named by their cells. Members are `listitem`s of the list "People with access". |
| Score | Each page is a `group` "Page N". Boxes are buttons "Measure <label>" or "Box without a number", and the playing box has `aria-current="location"`. Detection previews are images "Detected measure <label>" or "Detected box without a number". The default Move tool pans on a drag, Draw draws, and Select or a held Shift marquee-selects. |
| Score overlays | A section's first chip is an image named after it ("Repeat 14 to 15, 3 times", while playing "Repeat 14 to 15, pass 1 of 3"). A recorded repeat is an image "Measures 19 to 20 recorded 4 times", a jump an image "After 2, the recording continues at 4" (text "to 4"). Each box's accessible description lists its overlays, including "Sync point" (`toHaveAccessibleDescription`). |
| Header | The "Position" slider's `aria-valuetext` names the measure and playing section ("20, 1st time, Vamp pass 1"). The section button shows "Vamp 2/4" or "Repeat 1/3". Song details are the dialog "Song details", opened by the button "Details". |
| Inspector | The region "Editor panel", titled by a heading ("Measure 2", "Measures 2 to 3", "Song setup"). Its groups are regions "Rehearsal", "Marker", "Recording", "Audio sync" and "Box"/"Boxes". Kind buttons "As recorded", "Repeat", "Vamp", "Cut"; "As recorded" on a section asks in the alertdialog "Remove section". Occurrence chips are buttons ("2nd time") in the group "Time (follows the playhead)". Section range handles are sliders ("Last measure of repeat 1 to 2"). |
| Recording | The spinbutton "Recorded" and a `role="status"` line naming the new length. With nothing selected: the list "The order the backing track plays the measures in", "Edit as text" (textbox "Recording as text") and the list "Duplicate boxes" ("Play as 2nd time of 1 to 2"). A change that drops references opens the alertdialog "Change the recording". |
| Audio sync | Textbox "Starts at", "Nudge earlier"/"Nudge later", "Sync to playhead", "Move to another measure" (combobox "Which measure starts at ..."), "Remove sync point at 3". |
| Timeline | The region "Timeline" (editors only), with lane lists "Markers", "Sections", "Recording" and "Measures". Measure cells are buttons named by label and occurrence ("2, 2nd time", never "Measure ...", which score boxes use). Editable passes have a "More actions for ..." button. The waveform is an image "Waveform" exposing `data-zoom-scale` (samples per pixel) and `data-sample-rate`, so tests can convert sync point times to pixels. |

The inspector's kind buttons share names with the header's section button, so clear the selection (Escape) before reading playback.

### Playback Tests

`recordPlayback()` in `harness/playback.ts` reads the player the way a user sees it. Until a condition holds, it samples the header's "Current measure" and section button, the "Position" slider (recording milliseconds in audio mode, MIDI ticks in MIDI mode) and the highlighted box in one `page.evaluate()`, so a sample never mixes two moments of playback. `sequenceOf()` collapses the samples into the measures or passes in playing order. Bars of a second or more keep this reliable, so playback specs use fast specs without a PDF (`withPdf: false`) unless they check boxes.

## Test Data Generators

A `ScoreSpec` (`generators/score/types.ts`, presets in `presets.ts`) is expanded by `buildTimeline()` into bars and notes using a seeded RNG. Every artefact is derived from that one timeline, so they always agree:

| Output | Function | Notes |
|---|---|---|
| MusicXML, `.mscz`, PDF, measure layout | `scripts/generateScores.ts` | Needs MuseScore. Output is committed in `assets/scores/<id>/` |
| MIDI | `toMidiFile()` | One named track per part. The player matches song tracks by MIDI track name |
| Recording | `recordTimeline()` | The printed timeline played with `RecordedRepeat`s (written repeats, baked vamps). MIDI, beat map and audio are rendered from it |
| MTI beat map JSON | `toMtiJson()` | Names repeated passes `N-k` or with `R` suffixes (`repeats[].labels`). Ends with beat 1 of a terminal bar, which gives the last bar its length |
| MP3 stems | `renderPartStem()` + `encodeMp3()` | Additive synth, deterministic. `renderClickTrack()` for sync checks |
| WAV | `encodeWav()` | Converted to MP3 by the backend like any other recording |
| Song record fields and files | `buildSongBundle(spec, { mode, repeats })` | `mode`: `"midi"`, `"audio"` or `"none"`. `withPdf: false` skips the committed PDF. Writes `score` (IDs `m1..mn` in score order), `recording` (spans compressed like the app's beat map import, a warp marker per recorded bar in audio mode) and `arrangement` (rehearsal marks as markers, spec vamps as vamp sections) |

- MIDI, JSON and audio are generated on the fly in tests. Only PDFs are committed, because generating them needs MuseScore.
- `layout.json` stores a hash of the MusicXML and `assets/conductor.mss`. `loadScoreAssets()` throws when a preset changed without regenerating. Run `npm run e2e:scores -- <id>` and commit the result.
- Do not reuse a preset's `seed` for a different preset. Changing `timeline.ts` changes every preset's notes, so it also requires regenerating all score assets.

## Traps

- PocketBase renames uploaded files (`name_<random>.ext`). `createSong()` uploads first and then writes tracks with the stored names, like the frontend does. Do the same in new helpers.
- `songs` has no list rule, so regular users can only read songs through `shows?expand=songs_via_show` or by id.
- The backend transcodes every recording, so compare stored audio by duration, never by content.
- The MIDI player downloads instruments for `webaudiofont` from the internet at load time. MIDI playback tests need network access or a `page.route()` stub.
- MuseScore's `.mpos` coordinates scale with the image export resolution. `convertWithMuseScore()` pins `--image-resolution`. Keep `MPOS_UNITS_PER_INCH` in sync with it.
- `e2e:serve` binds ports 8091 and 5174 unless `E2E_SERVE_BACKEND_PORT` and `E2E_SERVE_FRONTEND_PORT` say otherwise. Right after a previous run stops, Testcontainers may need a few seconds to release the backend port.
- `testcontainers` is pinned to 11.x because 12.x requires Node 22.22+, and the project still supports Node 20. The `uuid` override in `package.json` patches its dockerode dependency.
