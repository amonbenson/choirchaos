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
| `src/composables/` | Reactive logic. `event.ts` bridges core events into Vue. `useMeasureEditor` holds the song editor's selection, the selected run and the tool. `useRecordingEditor` saves recording changes after previewing them |
| `src/stores/` | Pinia stores. `settings/` holds persisted user settings, one file per category |
| `src/router/` | Routes and navigation guards |
| `src/core/models/` | Domain models (Show, Song, Track, Measure, markers, sections) and the pure logic around them: the recording timeline, location formatting, song dialog drafts, setup status, measure editing, detection, review and warp editing |
| `src/core/import/` | Groups dropped files into songs by the number in their names |
| `src/core/player/` | Playback engine with MIDI and audio backends. See `src/core/player/AGENTS.md` |
| `src/core/midi/` | MIDI event types, beat map import and the `WarpMap` from timeline positions to recording time |
| `src/core/pdf/` | PDF rendering in a Web Worker, automatic measure detection |
| `src/core/utils/` | `Property`/`Emitter` events, song numbering, `Updater`, `ZoomLadder` and small helpers |
| `src/pocketbase/` | PocketBase client, auth, DB access |
| `src/test/` | Shared test setup, fixtures, and helpers |
| `e2e/` | Playwright tests against a Dockerized backend, plus test data generators. See `e2e/AGENTS.md` |

`src/core/` is framework-free TypeScript. Vue and Pinia code consumes core state through `useEvent()`, which requires an active Vue effect scope.

---

## Core Conventions

- Reactive state uses `Property<T>` (fires `on*Change`, `Property<void>` fires with `fire(undefined)`). Fire-and-forget events use `Emitter<T>`. Both live in `src/core/utils/events.ts` and return a `Disposable` on subscription.
- A song has three layers, each referencing the one below only by measure ID:
  - **Score:** the printed measures in written order and where each box is on the PDF.
  - **Recording:** the order the backing track plays score measures in, as inclusive measure ID spans, plus audio warp markers.
  - **Arrangement:** markers, cut, repeat and vamp sections, and the segue.
- Measures are identified by their stable `id` (`"m1"`, `"m2"`, ...), never by label or array index. The `label` is the printed number, free text and display only, so relabeling never touches a reference. `measureLabel.ts` parses labels only to suggest a new box's label.
- A location is `{ measure, beat, occurrence }`: a 0-based beat of the `occurrence`-th time the measure plays. `Song.getTimeline()` expands the recording into one entry per measure played, and its index is the timeline position.
- `Numbering` (`src/core/utils/numbering.ts`) is only for song numbers within a show.

---

## UI

Rehearsers (viewers) only play songs back. Editors (editors and owners) also set up shows, songs, measures, markers, sections and audio sync. Which page owns which action is mapped in `src/views/AGENTS.md`. Every page, the song editor included, must work on phones, tablets and desktops.

### Design Principles

1. **Rehearsers never see editing.** No edit control, hint or empty state that asks for editing is shown to someone who cannot edit.
2. **Each element type has one kind of job.** Links, list rows and breadcrumb items navigate. Pickers choose what the current page shows and keep the page. Buttons run an action or open a dialog or popover. Their labels never end with "...", which only adds noise next to other buttons. Segmented controls and toggle buttons switch a tool, option or mode and look pressed while active. Never make a navigation look like a mode switch or the other way round. A click on the score always moves the playhead, and in the editor it also selects.
3. **One meaning per icon, app-wide** (see the table below). Icon-only buttons are reserved for universally known controls (transport, close, overflow). Everything else carries a text label where the layout has room, and always an `aria-label`.
4. **State that matters lives in the URL.** Reloading or going back keeps the user where they were. Editing a song is a route, not a flag.
5. **Every action has one home.** Secondary entry points open the same dialog or page and keep its label. Only empty states and status hints may name the step instead, e.g. "Add playback".
6. **Do not duplicate information.** A canvas (the score, the waveform) is the list of its objects. Side panels show the selection's properties or what the canvas cannot show.
7. **Select, then act.** The panel next to a canvas edits the whole selection at once and shows mixed values as empty. The selected occurrence is the one at the playhead.
8. **Automation proposes, the user decides, leftovers stay visible.** Automatic results are previewed where they will appear, and anything still to check stays marked on the object until resolved.
9. **Empty states and status hints name the next step** and contain the control that does it.
10. **The top bar always says where you are.** Every page starts with `HeaderBar`, whose breadcrumb leads to every parent, so no page needs a back button. Dialogs have one obvious exit ("Cancel"). Destructive actions are confirmed, everything else saves without asking.
11. **The account menu is for the account only** (preferences, signing out).
12. **Keep the canvas readable.** Score overlays are small, and handles appear only where the user is working. Every object of the arrangement is visible where it lives (section bars and chips, recorded repeats, markers), never only in a list. Color is never the only carrier: a chip or the box description always names the kind.

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
| `pi-bookmark` | A marker |
| `pi-trash` | Delete or remove |
| `pi-arrow-up-left` | The score's Select tool |
| `pi-arrows-alt` | The score's Move tool |
| `pi-stop` | The score's Draw tool |

### Conventions

- Only components that know nothing about shows, songs or playback go into `base/`. A component shared by two areas lives with the one that owns the action.
- Use PrimeVue components styled with Tailwind utilities. For missing behaviour, prefer a library (vueuse, peaks.js) over hand-written pointer, scroll or drag handling.
- Reorderable lists use `useSortable` from `@vueuse/integrations` with a drag handle. In `onUpdate`, undo Sortable's DOM move and change the model instead, so Vue keeps owning the DOM. Every drag handle also needs a non-drag alternative (menu and arrow keys, see `SongDetailsForm`).
- No `prompt()`/`confirm()`. Destructive confirmations use PrimeVue's `useConfirm()`, errors use `useNotify()` toasts.
- Canvas components cannot use CSS variables. Resolve theme colors at runtime and rebuild when the `.dark` class changes (see `WaveformView`).
- Dark mode is class-based (`.dark`). Check every visual change in both modes.
- Section kinds have one color each, defined once as theme tokens (`--color-section-repeat`, `-vamp`, `-cut` and `--color-section-contrast` for text on them) in `src/main.css` with `.dark` overrides. Components get the classes and variable names from `score/sectionColors.ts` and never spell out a section color.
- Score overlays are drawn by `ScoreViewer` from the pure geometry in `core/models/scoreOverlays.ts`. They take no pointer events. Each box's `aria-describedby` names its overlays, so only a section's first chip and the recorded repeat glyph are images of their own.
- A MIDI track's title links it to its MIDI data by name, so MIDI tracks cannot be renamed.
- Locations are shown through `locationFormat.ts`. Markers and location inputs name every occurrence of a measure that plays more than once ("12, 1st time"), while warp markers and section names only add it from the second time on, since there the first occurrence is the obvious one.

### Accessibility

Every change keeps the app usable with a screen reader and keyboard. Prefer native elements and PrimeVue components over ARIA, since no ARIA is better than wrong ARIA.

- Every control has an accessible name: its visible text, a `<label for>`/`input-id`, `aria-labelledby` pointing at a visible heading, or `aria-label` when nothing visible fits. Names say what the control acts on when the same control repeats ("Remove Solo", not "Remove") and contain the visible text.
- Decorative icons and graphics get `aria-hidden="true"` (`<i class="pi ...">`, SVGs in `icons/`, canvases). PrimeVue's own icon props are hidden globally in `main.ts`. An icon that is the only carrier of a meaning gets `role="img"` and an `aria-label` instead.
- Never put `aria-label` on a plain `div` or `span`. Give it a role first, or label something else.
- Pass PrimeVue labels as `aria-label`/`aria-labelledby` on the component. `Select`, `InputNumber`, `Slider`, `ToggleSwitch` and `SelectButton` forward them to the focusable element.
- Expose state: `aria-pressed` on toggle buttons, `aria-expanded` on disclosures, `aria-current="page"` on the current breadcrumb, `aria-live` or `role="status"` on text that changes without focus moving.
- Group repeated items as lists or tables, and name regions and lists (`aria-labelledby` on a visible title), so tests and screen readers can scope to them.
- Use Tailwind's `sr-only` for text only screen readers need, e.g. labels hidden on narrow layouts.
- Tests find elements the way users do (`getByRole` with a name). An element a test cannot reach that way lacks a name, so fix the app, not the test.

---

## Measure Editing

- A box is a measure's layout on the score, and the label typed for it says which measure it shows. MIDI songs only have the measures of their beat map, so editing them only moves boxes. Audio songs own their measures: placing a box on a label nobody has creates the measure at the box's reading-order position, or relabels the box's old measure (keeping its ID and references) if that one would be left without a box.
- `measureEditing.ts` plans every box action of the inspector as a `PlannedEdit`: one `MeasureEdit` for `Song.applyMeasureEdit()`, plus the boxes it places as `BoxTarget`s (an existing ID or the index of an addition, since new measures get their ID only when saved). `useMeasureEditor.apply()` saves it, selects those boxes and reloads the player only when `changesPlayback()`. Removal cleanup and recording span maintenance happen in `Song`, never in planning.
- An addition's `index` is its score index after the edit. Planning builds the planned score with placeholder measures and reads the indices from it.
- Consecutive labels follow `suggestLabel()`: the next measure of the score in MIDI songs, the next whole number in audio songs.
- A box in the way is a conflict the user resolves (swap, or shift the following boxes). Planning never resolves one on its own.
- Reading order (page, row, left to right) decides range selection, renumbering, the default label of a new box and where a new measure goes in the score. Boxes share a row when one's vertical center lies inside the other.
- Measures are selected and compared by ID. Unnumbered boxes are compared by position (`isSameLayout()`), and an edit that resolves some sends the whole remaining list.

## Measure Detection

- `measure-detection` layouts use the same page fractions and 0-based pages as `MeasureLayout` and are stored unchanged.
- The package, its ONNX models and the onnxruntime WASM binaries are tens of megabytes. Keep every import of them behind the dynamic import in `measureDetector.ts`.
- `vite.config.ts` excludes `measure-detection` and `onnxruntime-web` from dependency pre-bundling, which would break their relative worker and WASM loading in the dev server.
- `pdfjs-dist` must satisfy the `measure-detection` peer range, since the app passes its own `PDFDocumentProxy` in.
- Detection never writes directly. `planMeasureDetection()` builds a plan that is previewed until the user applies or discards it, and `toMeasureEdit()` turns it into one `MeasureEdit`. Detected numbers are matched to labels without regard to case. Only text that parses as a measure number creates a measure, at its box's reading-order position, and in MIDI mode it never adds measures.
- Applying keeps what detection was unsure about: low-confidence boxes get `review: true` in their layout, and boxes without a usable number go into `score.unnumberedBoxes`. Leftovers on top of an existing box are dropped, so detecting twice does not pile them up.
- Confirming or renumbering a box clears its review flag (boxes only shifted out of the way keep it), and numbering an unnumbered box makes it that measure's layout. While any review item is open, `songSetup` does not report the song as ready.

---

## Backend

PocketBase lives in a separate repository (`choirchaos-pb`). The app reads its URL from `VITE_PB_URL` in `.env`.

- Updating a multi-file field (such as `audioFiles`) under its plain name replaces every stored file. Use `audioFiles+` to append and `audioFiles-` to remove.
- `pb_hooks/audio.pb.js` converts every uploaded recording to MP3, so stored names keep the upload's base name but always end in `.mp3`. Never match stored files to uploads by extension: `Song.uploadAudioFiles()` maps them by upload order. A file that cannot be decoded fails the whole request.
- Users can only read their own user record, so member names and email lookups go through `pb_hooks/members.pb.js` (`Show.getMembers()`/`addMember()`). Role changes and removals use the regular show update, which only the owner may do.
- A MIDI song is only playable together with its beat map (`jsonFile`). Never store one without the other.
- A song stores its layers in the JSON fields `score`, `recording` and `arrangement`. Each is always read and written whole, through one serializer per layer in `Song`, and the app has no handling for older formats. A change that touches several layers (removing measures, replacing the beat map) sends them in one request, which PocketBase applies atomically.
- A song with measures always has recording spans. A MIDI song's score and recording come from its beat map through `scoreFromBeatMap()`, which reads repeated passes (`12-2`, `12R`) as the written measure `12`. The beat map stays the timing source, and a MIDI song never has warp markers.
- Every mutation removes the references it leaves unresolved (markers, sections, warp markers), since the e2e invariants reject them.
- Recording changes (`setRecordingSpans()`, `playDuplicatesAsRepeat()`) first move references by timeline position through `remapReferences()` in `recording.ts`, keeping warp marker times, and drop only what has no surviving position. The span editing helpers there return normalized spans (`spansFromSequence()`), and the UI previews every change with `previewRecordingSpans()` before saving. MIDI recordings are read-only.

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
