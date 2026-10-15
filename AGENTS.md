# choirchaos — Agent Guide

Choir rehearsal web app: a PDF score synchronized with real-time MIDI or multi-track audio playback.

**Stack:** Vue 3, Vite, TypeScript, Pinia, PrimeVue, Tailwind v4, PocketBase, Web Audio API, `webaudiofont`, `rubberband-web`, `pdfjs-dist`.

---

## Rules

- Never copy content from `tmp/exampleMidi/`. It is proprietary and serves as a format reference only.
- Never format code by hand. Run `npm run lint:fix`.
- No `_` prefixes. TypeScript access modifiers enforce privacy. `_` is only for ignored callback args.
- No TypeScript getters. Use `get*()`/`is*()` methods for public read access.
- Avoid comments. Prefer clear names and extracting expressions into named constants/functions. When a comment is needed, explain why, not what.
- No special characters in comments (no emojis, arrows, decorative lines).
- Avoid nesting. Prefer early returns and extracted functions over nested conditionals when that makes the code clearer.
- After larger edits, re-read the whole file as one unit to make sure it reads coherently.
- Never push to `main` directly. Every push to `main` deploys to production.

---

## Commands

```bash
npm run dev                  # dev server at http://localhost:5173
npm run lint:fix             # eslint with autofix
npm run typecheck            # vue-tsc --build
npx vitest run               # all tests
npx vitest run <path>        # single test file
npm run build                # typecheck + production build
npm run test:e2e             # end-to-end tests (needs Docker), see e2e/AGENTS.md
npm run e2e:serve            # seeded local backend + frontend for manual checks
```

Do not use `npm test`. It starts vitest in watch mode and never exits.

**Before finishing a task:** run `npm run lint:fix`, `npm run typecheck`, and `npx vitest run`. If the change touches backend access, uploads, routing, or other user flows, also run `npm run test:e2e`. CI runs lint, typecheck, unit tests, build, and the e2e tests.

---

## Layout

| Path | Contents |
|---|---|
| `src/views/` | Routed pages: `AuthView`, `HomeView`, `WorkspaceView` |
| `src/components/` | UI components (transport, mixer, PDF viewer, warp/marker panels, dialogs) |
| `src/composables/` | Reusable reactive logic. `event.ts` bridges core events into Vue |
| `src/stores/` | Pinia stores. `settings/` holds persisted user settings, one file per category |
| `src/core/models/` | Domain models: Show, Song, Track, Measure, MeasureEvent |
| `src/core/player/` | Playback engine with MIDI and audio backends. See `src/core/player/AGENTS.md` |
| `src/core/midi/` | MIDI event types and the tick/time `WarpMap` |
| `src/core/pdf/` | PDF rendering in a Web Worker with a job cache |
| `src/core/utils/` | `Property`/`Emitter` events, measure numbering, binary search, `Updater` |
| `src/pocketbase/` | PocketBase client, auth, DB access |
| `src/test/` | Shared test setup, fixtures, and helpers |
| `e2e/` | Playwright end-to-end tests against a Dockerized backend, plus score/MIDI/audio generators. See `e2e/AGENTS.md` |

`src/core/` is framework-free TypeScript. Vue and Pinia code lives outside it and consumes core state through `useEvent()`.

---

## Core Conventions

- Reactive state uses `Property<T>` (fires `on*Change`). Fire-and-forget events use `Emitter<T>`. Both are in `src/core/utils/events.ts` and return a `Disposable` on subscription.
- `Property<void>`: call `fire(undefined)`.
- `useEvent()` (`src/composables/event.ts`) requires an active Vue effect scope.
- Measures are identified by `Numbering` strings like `"1"` or `"2a"`, not by array indices. Indices change when measures are reordered.

---

## UI

- Use PrimeVue components first and style them with Tailwind utilities.
- Dark mode is class-based (`.dark` selector). Check every visual change in both light and dark mode.

---

## Backend

PocketBase is a separate repository (`choirchaos-pb`). The app reads its URL from `VITE_PB_URL` in `.env`. Unit tests do not need a running PocketBase. Mock `axios` and pass songs built from `src/test/fixtures.ts`. The e2e tests build the backend from a pinned `choirchaos-pb` commit (`e2e/config.ts`).

---

## Testing

- `src/test/setup.ts` globally mocks `rubberband-web` and `midi-json-parser` (neither runs in Node) and polyfills `AudioContext` and `WebAudioFontPlayer`. Do not re-mock them per file. The `AudioContext` polyfill renders to no output device because CI runners have none, so always use the global instead of importing `AudioContext` from `node-web-audio-api` directly. Override per test with `vi.mocked(parseArrayBuffer).mockResolvedValueOnce(...)`.
- In `afterEach`, use `vi.clearAllMocks()`, not `vi.resetAllMocks()`. Reset wipes the return values set in the global mock factories.
- Reuse `src/test/fixtures.ts` (song factories, `TICKS`, `PARSED_MIDI`) and `src/test/updater.ts` (`ManualUpdater`, `stepUntil`, `stepPast`) instead of writing new helpers.

---

## Agent Guides

Agent guidance is split by scope:
- `AGENTS.md` (this file): project-wide rules, commands, layout, and conventions.
- `src/core/player/AGENTS.md`: playback engine internals, invariants, and player test patterns.
- `e2e/AGENTS.md`: end-to-end harness, backend fixtures and invariants, and test data generators.

`AGENTS.md` is the only agent instruction format in this repo. Do not add tool-specific copies or pointer files such as `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, or `.github/copilot-instructions.md`. A root `CLAUDE.md` would make Claude Code ignore every nested `AGENTS.md`. Tools that need configuration to read `AGENTS.md` get a settings entry, not a copy of the content.

Read the nested guide before working in its folder. When a subsystem collects enough non-obvious knowledge, give it its own `AGENTS.md` in that folder and link it here and in the Layout table.

Keep the guides current as part of every change:
- Update the matching guide in the same change when you add, rename, or remove something it references, or when you discover a trap, invariant, or convention that is not obvious from the code.
- Put knowledge in the most specific guide that fits. Only project-wide information belongs in this file.
- Write what an agent cannot easily learn from reading the code: why, invariants, traps. Do not copy values or type shapes that already live in code, since they go stale.
- Delete statements that are no longer true instead of adding corrections next to them.

---

## Git

- Work on a branch and open a PR against `main`. PRs are squash-merged.
- Commit subjects are short and imperative, e.g. "Add global vamp enable/disable toggle".
