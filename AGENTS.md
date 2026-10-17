# choirchaos — Agent Guide

Choir rehearsal web app: a PDF score synchronized with real-time MIDI or multi-track audio playback.

**Stack:** Vue 3, Vite, TypeScript, Pinia, PrimeVue, Tailwind v4, PocketBase, Web Audio API, `webaudiofont`, `rubberband-web`, `pdfjs-dist`, `measure-detection`.

---

## Rules

- Never copy content from `tmp/exampleMidi/`. It is proprietary and serves as a format reference only.
- Never format code by hand. Run `npm run lint:fix`.
- No `_` prefixes. TypeScript access modifiers enforce privacy. `_` is only for ignored callback args.
- No TypeScript getters. Use `get*()`/`is*()` methods for public read access.
- Avoid comments. Prefer clear names and named constants/functions. When a comment is needed, explain why, not what, and use no special characters (emojis, arrows, decorative lines).
- Avoid nesting. Prefer early returns and extracted functions.
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

**Before finishing a task:** run `npm run lint:fix`, `npm run typecheck`, and `npx vitest run`. If the change touches backend access, uploads, routing, or other user flows, also run `npm run test:e2e`. CI runs all of these plus the build.

---

## Layout

| Path | Contents |
|---|---|
| `src/views/` | Routed pages. See `src/views/AGENTS.md` |
| `src/components/` | UI components in the folder of the area they appear in (`header/`, `show/`, `song/`, `player/`, `editor/`, `score/`), plus generic `base/` and `icons/` |
| `src/composables/` | Reactive logic. `event.ts` bridges core events into Vue. `useMeasureEditor` holds the song editor's selection and tool |
| `src/stores/` | Pinia stores. `settings/` holds persisted user settings, one file per category |
| `src/router/` | Routes and navigation guards |
| `src/core/models/` | Domain models (Show, Song, Track, Measure, MeasureEvent) and the pure logic around them: song dialog drafts, setup status, measure editing, detection and review |
| `src/core/import/` | Groups dropped files into songs by the number in their names |
| `src/core/player/` | Playback engine with MIDI and audio backends. See `src/core/player/AGENTS.md` |
| `src/core/midi/` | MIDI event types, beat maps and the tick/time `WarpMap` |
| `src/core/pdf/` | PDF rendering in a Web Worker, automatic measure detection |
| `src/core/utils/` | `Property`/`Emitter` events, measure numbering, `Updater`, `ZoomLadder` and small helpers |
| `src/pocketbase/` | PocketBase client, auth, DB access |
| `src/test/` | Shared test setup, fixtures, and helpers |
| `e2e/` | Playwright tests against a Dockerized backend, plus test data generators. See `e2e/AGENTS.md` |

`src/core/` is framework-free TypeScript. Vue and Pinia code consumes core state through `useEvent()`, which requires an active Vue effect scope.

---

## Core Conventions

- Reactive state uses `Property<T>` (fires `on*Change`, `Property<void>` fires with `fire(undefined)`). Fire-and-forget events use `Emitter<T>`. Both live in `src/core/utils/events.ts` and return a `Disposable` on subscription.
- Measures are identified by `Numbering` strings like `"1"` or `"2a"`, never by array indices, which change when measures are reordered.

---

## UI

Rehearsers (viewers) only play songs back. Editors (editors and owners) also set up shows, songs, measures and audio sync. Which page owns which action is mapped in `src/views/AGENTS.md`. Every page, the song editor included, must work on phones, tablets and desktops.

### Design Principles

1. **Rehearsers never see editing.** No edit control, hint or empty state that asks for editing is shown to someone who cannot edit.
2. **Each element type has one kind of job.** Links, list rows and breadcrumb items navigate. Pickers choose what the current page shows and keep the page. Buttons run an action or open a dialog or popover, and end their label with "..." when they open a dialog. Segmented controls and toggle buttons switch a tool, option or mode and look pressed while active. Never make a navigation look like a mode switch or the other way round.
3. **One meaning per icon, app-wide** (see the table below). Icon-only buttons are reserved for universally known controls (transport, close, overflow). Everything else carries a text label where the layout has room, and always an `aria-label`.
4. **State that matters lives in the URL.** Reloading or going back keeps the user where they were. Editing a song is a route, not a flag.
5. **Every action has one home.** Secondary entry points open the same dialog or page and keep its label. Only empty states and status hints may name the step instead, e.g. "Add playback...".
6. **Do not duplicate information.** A canvas (the score, the waveform) is the list of its objects. Side panels show the selection's properties or what the canvas cannot show.
7. **Select, then act.** The panel next to a canvas edits the whole selection at once and shows mixed values as empty.
8. **Automation proposes, the user decides, leftovers stay visible.** Automatic results are previewed where they will appear, and anything still to check stays marked on the object until resolved.
9. **Empty states and status hints name the next step** and contain the control that does it.
10. **The top bar always says where you are.** Every page starts with `HeaderBar`, whose breadcrumb leads to every parent, so no page needs a back button. Dialogs have one obvious exit ("Cancel"). Destructive actions are confirmed, everything else saves without asking.
11. **The account menu is for the account only** (preferences, signing out).
12. **Keep the canvas readable.** Score overlays are small, and handles appear only where the user is working.

| Icon | Meaning |
|---|---|
| App logo | Home |
| `pi-pencil` | The "Edit" toggle, or opening a song in the editor |
| `pi-check` | A confirmed or ready state |
| `pi-file-edit` | The song details (number, title, files, tracks) |
| `pi-play` | Play |
| `pi-sliders-v` | Personal preferences |
| `pi-ellipsis-v` | More actions for this item |
| `pi-sparkles` | Automatic measure detection |
| `pi-trash` | Delete or remove |
| `pi-arrow-up-left` | The score's Select tool |
| `pi-stop` | The score's Draw tool |

### Conventions

- Only components that know nothing about shows, songs or playback go into `base/`. A component shared by two areas lives with the one that owns the action.
- Use PrimeVue components styled with Tailwind utilities. For missing behaviour, prefer a library (vueuse, peaks.js) over hand-written pointer, scroll or drag handling.
- Reorderable lists use `useSortable` from `@vueuse/integrations` with a drag handle. In `onUpdate`, undo Sortable's DOM move and change the model instead, so Vue keeps owning the DOM. Every drag handle also needs a non-drag alternative (menu and arrow keys, see `SongDetailsForm`).
- No `prompt()`/`confirm()`. Destructive confirmations use PrimeVue's `useConfirm()`, errors use `useNotify()` toasts.
- Canvas components cannot use CSS variables. Resolve theme colors at runtime and rebuild when the `.dark` class changes (see `WaveformView`).
- Dark mode is class-based (`.dark`). Check every visual change in both modes.
- A MIDI track's title links it to its MIDI data by name, so MIDI tracks cannot be renamed.

---

## Measure Editing

- A box is a measure's layout on the score, and its number says which measure it shows. MIDI songs only have the measures of their beat map. Audio songs own their measures, so placing a box on a missing number creates the measure, or renames the box's old measure if that one would be left without a box.
- `measureEditing.ts` plans every action of the Measures tab as one `MeasureEdit`, and `Song.applyMeasureEdit()` saves it once. The player reloads only when `changesPlayback()`. Renames and deletions update warp markers, markers and vamps in the same save, since the e2e invariants reject references to missing measures.
- A box in the way is a conflict the user resolves (swap, or shift the following boxes). Planning never resolves one on its own.
- Reading order (page, row, left to right) decides range selection, renumbering and the default number of a new box. Boxes share a row when one's vertical center lies inside the other.
- The song hands out reactive proxies, but measures created by an edit are plain, so `useMeasureEditor` compares measures with `toRaw()`. Unnumbered boxes are compared by position (`isSameLayout()`).

## Measure Detection

- `measure-detection` layouts use the same page fractions and 0-based pages as `MeasureLayout` and are stored unchanged.
- The package, its ONNX models and the onnxruntime WASM binaries are tens of megabytes. Keep every import of them behind the dynamic import in `measureDetector.ts`.
- `vite.config.ts` excludes `measure-detection` and `onnxruntime-web` from dependency pre-bundling, which would break their relative worker and WASM loading in the dev server.
- `pdfjs-dist` must satisfy the `measure-detection` peer range, since the app passes its own `PDFDocumentProxy` in.
- Detection never writes directly. `planMeasureDetection()` builds a plan that is previewed until the user applies or discards it. In MIDI mode it never adds measures.
- Applying keeps what detection was unsure about: low-confidence boxes get `review: true` in their layout, and boxes without a usable number go into the song's `unnumberedBoxes`. Leftovers on top of an existing box are dropped, so detecting twice does not pile them up.
- Confirming or renumbering a box clears its review flag (boxes only shifted out of the way keep it), and numbering an unnumbered box makes it that measure's layout. While any review item is open, `songSetup` does not report the song as ready.

---

## Backend

PocketBase lives in a separate repository (`choirchaos-pb`). The app reads its URL from `VITE_PB_URL` in `.env`.

- Updating a multi-file field (such as `audioFiles`) under its plain name replaces every stored file. Use `audioFiles+` to append and `audioFiles-` to remove.
- `pb_hooks/audio.pb.js` converts every uploaded recording to MP3, so stored names keep the upload's base name but always end in `.mp3`. Never match stored files to uploads by extension: `Song.uploadAudioFiles()` maps them by upload order. A file that cannot be decoded fails the whole request.
- Users can only read their own user record, so member names and email lookups go through `pb_hooks/members.pb.js` (`Show.getMembers()`/`addMember()`). Role changes and removals use the regular show update, which only the owner may do.
- A MIDI song is only playable together with its beat map (`jsonFile`). Never store one without the other.

---

## Testing

- Unit tests need no PocketBase. Mock `axios` and build songs with `src/test/fixtures.ts`.
- `src/test/setup.ts` globally mocks `rubberband-web` and `midi-json-parser` and polyfills `AudioContext` (without an output device, since CI has none) and `WebAudioFontPlayer`. Do not re-mock them per file or import `AudioContext` from `node-web-audio-api`. Override per test with `vi.mocked(parseArrayBuffer).mockResolvedValueOnce(...)`.
- In `afterEach`, use `vi.clearAllMocks()`, not `vi.resetAllMocks()`, which wipes the return values of the global mock factories.
- Reuse `src/test/fixtures.ts` and `src/test/updater.ts` instead of writing new helpers.

---

## Agent Guides

Besides this file, `src/core/player/AGENTS.md`, `src/views/AGENTS.md` and `e2e/AGENTS.md` cover their folders. Read the nested guide before working in its folder.

`AGENTS.md` is the only agent instruction format in this repo. Do not add `CLAUDE.md`, `GEMINI.md`, `.cursorrules` or similar copies. A root `CLAUDE.md` would make Claude Code ignore the nested guides.

Keep the guides current in every change:
- They describe the current state, not its history. Rewrite or delete outdated statements instead of adding to them, and prefer making a guide shorter over making it longer.
- Put knowledge in the most specific guide that fits. Give a subsystem its own `AGENTS.md` once it collects enough non-obvious knowledge, and link it here.
- Write what an agent cannot easily learn from the code: why, invariants, traps. Do not copy values or type shapes that live in code.

---

## Git

- Work on a branch and open a PR against `main`. PRs are squash-merged.
- Commit subjects are short and imperative, e.g. "Add global vamp enable/disable toggle".
