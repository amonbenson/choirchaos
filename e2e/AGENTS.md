# E2E Tests — Agent Guide

Extends the root `AGENTS.md`, whose rules apply here too. Keep this file current under the rules in its "Agent Guides" section.

End-to-end tests run the compiled frontend in Chromium against a real PocketBase backend in Docker. They use Playwright Test, separate from the Vitest unit tests. jsdom cannot run Web Audio, AudioWorklets, pdf.js workers or canvas.

## Commands

```bash
npm run test:e2e                         # build frontend, start backends, run all e2e tests
npm run test:e2e -- e2e/tests/foo.spec.ts # single file
E2E_SKIP_BUILD=1 npm run test:e2e        # reuse the last frontend build (only test files changed)
npm run e2e:serve                        # seeded backend + Vite dev server for manual checks
npm run e2e:scores [-- <presetId>]       # regenerate committed score PDFs (needs MuseScore 4)
npx playwright show-trace <trace.zip>    # inspect a failed test
```

Requirements: Docker running, and Chromium installed once with `npx playwright install chromium`. CI (`e2e` job in `.github/workflows/ci.yaml`) runs the same command on `ubuntu-latest`.

## How a Run Works

1. `globalSetup.ts` builds the frontend once into `e2e/.cache/dist` and builds the backend image. Both happen once per run.
2. Each Playwright worker starts its own PocketBase container (Testcontainers, data in tmpfs) and its own `vite preview` server on a random port.
3. The frontend is built with `VITE_PB_URL="/"`. The preview server proxies `/api` and `/_` to its worker's backend, so one build serves any number of backends and parallel runs never collide.
4. Before every test, all app collections are truncated. After every test that passed, the invariants in `harness/state.ts` run against the whole database. A test that leaves the backend inconsistent fails.

The backend comes from `BACKEND_REPOSITORY` at `BACKEND_COMMIT` (`config.ts`). Bump the commit when the frontend needs a newer schema. To test against unpushed backend changes, set `E2E_BACKEND_SOURCE=../choirchaos-pb` (path to a local checkout). It is rebuilt on every run.

The superuser is created with `pocketbase superuser upsert` before `serve`, so its credentials are always `SUPERUSER` in `config.ts`.

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

- When a feature adds a cross-record or cross-field rule, add it to `DEFAULT_INVARIANTS` in `harness/state.ts`. That protects every existing test, not just the new one.
- Prefer asserting backend state through `admin` over asserting UI text. Many UI elements have no accessible text.
- `harness/page.ts` has `collectPageErrors()`, `toUploadFile()` and `chooseFiles()`. The app opens file dialogs from buttons (vueuse `useFileDialog`) without a permanent `<input type=file>`, so upload through `chooseFiles()`, which uses Playwright's file chooser event.
- `WaveformView` exposes `data-zoom-scale` (samples per pixel) and `data-sample-rate`, so tests can convert marker times to pixels on the canvas.
- Vue reports errors thrown during render through `console.error`, not as uncaught page errors. To assert that a flow is error-free, listen to both `pageerror` and `console` (`collectPageErrors()` in `harness/page.ts` does both).
- `harness.spec.ts` checks the harness itself. Keep it passing when you change the harness.

## Test Data Generators

A `ScoreSpec` (`generators/score/types.ts`, presets in `presets.ts`) is expanded by `buildTimeline()` into bars and notes using a seeded RNG. Every artefact is derived from that one timeline, so they always agree:

| Output | Function | Notes |
|---|---|---|
| MusicXML, `.mscz`, PDF, measure layout | `scripts/generateScores.ts` | Needs MuseScore. Output is committed in `assets/scores/<id>/` |
| MIDI | `toMidiFile()` | One named track per part. The player matches song tracks by MIDI track name |
| MTI beat map JSON | `toMtiJson()` | Ends with beat 1 of a terminal bar, which gives the last bar its length |
| MP3 stems | `renderPartStem()` + `encodeMp3()` | Additive synth, deterministic. `renderClickTrack()` for sync checks |
| WAV | `encodeWav()` | The backend accepts only `audio/mpeg`. Use WAV for rejection tests |
| Song record fields and files | `buildSongBundle(spec, { mode })` | `mode`: `"midi"`, `"audio"` or `"none"`. `withPdf: false` skips the committed PDF |

- MIDI, JSON and audio are generated on the fly in tests. Only PDFs are committed, because generating them needs MuseScore.
- `layout.json` stores a hash of the MusicXML and `assets/conductor.mss`. `loadScoreAssets()` throws when a preset changed without regenerating. Run `npm run e2e:scores -- <id>` and commit the result.
- Do not reuse a preset's `seed` for a different preset. Changing `timeline.ts` changes every preset's notes, so it also requires regenerating all score assets.

## Traps

- PocketBase renames uploaded files (`name_<random>.ext`). `createSong()` uploads first and then writes tracks with the stored names, like the frontend does. Do the same in new helpers.
- `songs` has no list rule, so regular users can only read songs through `shows?expand=songs_via_show` or by id.
- Sharing depends on the members route in `choirchaos-pb/pb_hooks`, not only on the schema. Changes to backend hooks need a `BACKEND_COMMIT` bump just like migrations. Test them first with `E2E_BACKEND_SOURCE`.
- The MIDI player downloads instruments for `webaudiofont` from the internet at load time. MIDI playback tests need network access or a `page.route()` stub.
- MuseScore's `.mpos` coordinates scale with the image export resolution. `convertWithMuseScore()` pins `--image-resolution`. Keep `MPOS_UNITS_PER_INCH` in sync with it.
- `e2e:serve` binds fixed ports (8091, 5174). Right after a previous run stops, Testcontainers may need a few seconds to release 8091.
- `testcontainers` is pinned to 11.x because 12.x requires Node 22.22+, and the project still supports Node 20. The `uuid` override in `package.json` patches its dockerode dependency.
