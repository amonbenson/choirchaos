# choirchaos — Agent Guide

Choir rehearsal web app: a PDF score synchronized with real-time MIDI or multi-track audio playback.

**Stack:** Vue 3, Vite, TypeScript, Pinia, PrimeVue, Tailwind v4, PocketBase, Web Audio API, `webaudiofont`, `rubberband-web`, `pdfjs-dist`, `measure-detection`.

Three nested guides cover their folders: `src/views/AGENTS.md` (pages and the song editor), `src/core/player/AGENTS.md` (playback engine) and `e2e/AGENTS.md` (end-to-end tests). Read the nested guide before working in its folder.

---

## Rules

- Never copy content from `tmp/exampleMidi/`. It is proprietary and serves as a format reference only.
- Never format code by hand. Run `npm run lint:fix`.
- No `_` prefixes. TypeScript access modifiers enforce privacy. `_` is only for ignored callback args.
- No TypeScript getters. Use `get*()`/`is*()` methods for public read access.
- Avoid comments. Prefer clear names and named constants/functions. When a comment is needed, explain why, not what, and use no special characters (emojis, arrows, decorative lines).
- Avoid nesting. Prefer early returns and extracted functions.
- After larger edits, re-read the whole file as one unit to make sure it reads coherently.
- Work on a branch and open a PR against `main`. PRs are squash-merged, and commit subjects are short and imperative ("Add global vamp enable/disable toggle"). Never push to `main` directly: every push to `main` deploys to production.

## Commands

```bash
npm run dev                  # dev server at http://localhost:5173
npm run lint:fix             # eslint with autofix
npm run typecheck            # vue-tsc --build
npx vitest run               # all unit tests
npx vitest run <path>        # single test file
npm run build                # typecheck + production build
npm run test:e2e             # end-to-end tests (needs Docker)
npm run e2e:serve            # seeded local backend + frontend for manual checks
```

Do not use `npm test`. It starts vitest in watch mode and never exits.

Before finishing a task, run `npm run lint:fix`, `npm run typecheck` and `npx vitest run`. If the change touches backend access, uploads, routing or another user flow, also run `npm run test:e2e`. CI runs all of these plus the build.

## Layout

| Path | Contents |
|---|---|
| `src/views/` | Routed pages |
| `src/components/` | UI components in the folder of the area they appear in (`header/`, `show/`, `song/`, `player/`, `editor/`, `score/`), plus generic `base/` and `icons/` |
| `src/composables/` | Reactive logic. `event.ts` bridges core events into Vue. `useMeasureEditor` holds the song editor's selection and tool, `useRecordingEditor` and `useSyncEditor` save recording and sync changes, `usePlayerSync` keeps the player in step with saved edits, `useSongHistory` binds undo and redo |
| `src/stores/` | Pinia stores. `settings/` holds persisted user settings, one file per category |
| `src/router/` | Routes and navigation guards |
| `src/theme/` | The PrimeVue preset, the single place for the accent and surface palettes |
| `src/core/models/` | Domain models (Show, Song, Track, Measure, markers, sections) and the pure logic around them: layer edits and their undo history, recording timeline, locations, setup status, measure editing, detection, review, score overlays and warp editing |
| `src/core/import/` | Groups dropped files into songs by the number in their names |
| `src/core/player/` | Playback engine with MIDI and audio backends |
| `src/core/midi/` | MIDI event types, beat map import and the `WarpMap` from timeline positions to recording time |
| `src/core/pdf/` | PDF rendering in a Web Worker, automatic measure detection |
| `src/core/utils/` | `Property`/`Emitter` events, song numbering, `Updater`, `ZoomLadder` and small helpers |
| `src/pocketbase/` | PocketBase client, auth, DB access |
| `src/test/` | Shared unit test setup, fixtures and helpers |
| `e2e/` | Playwright tests against a Dockerized backend, plus test data generators |

`src/core/` is framework-free TypeScript. Vue and Pinia code consumes core state through `useEvent()`, which needs an active Vue effect scope. Reactive core state uses `Property<T>` (fires `on*Change`; a `Property<void>` fires with `fire(undefined)`), fire-and-forget events use `Emitter<T>`. Both live in `src/core/utils/events.ts` and return a `Disposable` on subscription.

---

## Song Model

A song has three layers, each referencing the one below only by measure ID:

- **Score:** the printed measures in written order, with their boxes on the PDF.
- **Recording:** the order the backing track plays the score's measures in, as inclusive measure ID spans, plus the audio sync points (warp markers).
- **Arrangement:** markers, cut, repeat and vamp sections, and the segue.

Rules that hold everywhere:

- A measure is identified by its stable `id` (`"m1"`, `"m2"`, ...), never by label or array index. Its `label` is the printed number, free text and display only, so relabeling never touches a reference.
- `Song.getTimeline()` expands the recording into one entry per measure played. Its index is the timeline position. A location `{ measure, beat, occurrence }` is a 0-based beat of the `occurrence`-th time a measure plays.
- Each layer is one JSON field in PocketBase (`score`, `recording`, `arrangement`), always read and written whole through one serializer per layer in `layers.ts`. The app has no handling for older formats.
- Every edit of the layers goes through `Song.editLayers()`. Callers compute the next lists with pure functions (`planMeasureEdit()` and `planRecordingChange()` in `layers.ts`, `replaceSections()`, `addMarker()`, `addWarpMarker()` and their siblings) and never mutate the song. `editLayers()` puts references in timeline order, validates the fields that changed (every reference once the timeline changed, so data stored before a rule only blocks edits of its own field), saves every changed layer in one request, which PocketBase applies atomically, and then fires `onLayersChange` with both snapshots and `timingChanged`. A failed save changes nothing in memory. Only file uploads with a beat map write the layers another way.
- A song with measures always has recording spans. Every measure or recording change removes the references it leaves unresolved (markers, sections, sync points), since the e2e invariants reject them.
- Recording changes (`planRecordingChange()`, used by `setRecordingSpans()` and the duplicate migration) first move references by timeline position through `remapReferences()`, keeping sync point times, and drop only what has no surviving position. The span helpers in `recording.ts` return normalized spans (`spansFromSequence()`), and the UI previews every change with `previewRecordingSpans()` before saving.
- The player follows `onLayersChange` through `usePlayerSync`: it reloads at the same time when `timingChanged` (measure order, beats or recording), and otherwise only calls `syncWarp()`. Callers never reload the player, so UI state never waits for audio to load.
- Undo (`songHistory.ts`) records every change as a pair of snapshots for the song open in the editor and writes one back through `restoreLayers()`, which is `editLayers()` marked as coming from the history. It covers the three layers and the segue, not files, details or tracks, and starts over when the song changes or the editor closes. It refuses, and drops the history, when the layers changed without it (a beat map upload) or the record's `updated` timestamp differs from the one `Song` remembers from its own last save, which means someone else saved. A failed save keeps the history.
- A MIDI song's score and recording come from its beat map (`jsonFile`) through `scoreFromBeatMap()`, which reads repeated passes (`12-2`, `12R`) as the written measure `12`. The beat map stays the timing source, so MIDI recordings are read-only and a MIDI song never has sync points. Never store a MIDI file without its beat map.
- `Numbering` (`src/core/utils/numbering.ts`) is only for song numbers within a show. `measureLabel.ts` parses measure labels only to suggest the label of a new box.

## Score Editing

- A box is a measure's layout on the score, and the label typed for it says which measure it shows. MIDI songs only have the measures of their beat map, so editing them only moves boxes. Audio songs own their measures: placing a box on a label nobody has creates the measure at the box's reading-order position, or relabels the box's old measure (keeping its ID and references) if that one would be left without a box.
- `measureEditing.ts` plans every box action as a `PlannedEdit`: one `MeasureEdit` for `Song.applyMeasureEdit()`, plus the boxes it places as `BoxTarget`s (an existing ID, or the index of an addition, since new measures get their ID only when saved). An addition's `index` is its score index after the edit. `useMeasureEditor.apply()` saves the edit and selects those boxes. Removal cleanup and span maintenance happen in `planMeasureEdit()`, never in `measureEditing.ts`.
- Reading order (page, row, left to right) decides range selection, renumbering, a new box's default label and where a new measure goes in the score. Boxes share a row when one's vertical center lies inside the other. Consecutive labels follow `suggestLabel()`: the next measure of the score in MIDI songs, the next whole number in audio songs.
- A box in the way is a conflict the user resolves (swap, or shift the following boxes). Planning never resolves one on its own.
- Measures are selected and compared by ID. Unnumbered boxes are compared by position (`isSameLayout()`), and an edit that resolves some sends the whole remaining list.

### Measure Detection

- Detection never writes directly. `planMeasureDetection()` builds a plan that is previewed until the user applies or discards it, and `toMeasureEdit()` turns it into one `MeasureEdit`. Detected numbers match labels without regard to case. Only text that parses as a measure number creates a measure, and in MIDI songs detection never adds measures.
- Applying keeps what detection was unsure about: low-confidence boxes get `review: true` in their layout, and boxes without a usable number go into `score.unnumberedBoxes`. Leftovers on top of an existing box are dropped, so detecting twice does not pile them up. Confirming or renumbering a box clears its review flag (boxes only shifted out of the way keep it), and numbering an unnumbered box makes it that measure's layout. While any review item is open, `songSetup` does not report the song as ready.
- Detection layouts use the same page fractions and 0-based pages as `MeasureLayout` and are stored unchanged.
- The `measure-detection` package, its ONNX models and the onnxruntime WASM binaries are tens of megabytes. Keep every import of them behind the dynamic import in `measureDetector.ts`. `vite.config.ts` excludes both packages from dependency pre-bundling, which would break their worker and WASM loading in the dev server. `pdfjs-dist` must satisfy the `measure-detection` peer range, since the app passes its own `PDFDocumentProxy` in.

## Backend

PocketBase lives in the separate repository `choirchaos-pb`. The app reads its URL from `VITE_PB_URL` in `.env`.

- Updating a multi-file field (such as `audioFiles`) under its plain name replaces every stored file. Use `audioFiles+` to append and `audioFiles-` to remove.
- `pb_hooks/audio.pb.js` converts every uploaded recording to MP3, so stored names keep the upload's base name but always end in `.mp3`. Never match stored files to uploads by extension: `Song.uploadAudioFiles()` maps them by upload order. A file that cannot be decoded fails the whole request.
- Users can only read their own user record, so member names and email lookups go through `pb_hooks/members.pb.js` (`Show.getMembers()`/`addMember()`). Role changes and removals use the regular show update, which only the owner may do.

---

## UI

Rehearsers (viewers) only play songs back. Editors (editors and owners) also set up shows, songs, measures, markers, sections and audio sync. Every page, the song editor included, must work on phones, tablets and desktops.

### Design Principles

1. **Rehearsers never see editing.** No edit control, hint or empty state that asks for editing is shown to someone who cannot edit.
2. **Each element type has one kind of job.** Links, list rows and breadcrumb items navigate. Pickers choose what the current page shows and keep the page. Buttons run an action or open a dialog or popover, and their labels never end with "...". Segmented controls and toggle buttons switch a tool, option or mode and look pressed while active. Never make a navigation look like a mode switch or the other way round. A click on the score always moves the playhead, and in the editor it also selects.
3. **One meaning per icon, app-wide** (see the table below). Icon-only buttons are reserved for universally known controls (transport, close, overflow). Everything else carries a text label where the layout has room, and always an `aria-label`.
4. **State that matters lives in the URL.** Reloading or going back keeps the user where they were. Editing a song is a route, not a flag.
5. **Every action has one home.** Secondary entry points open the same dialog or page and keep its label. Only empty states and status hints may name the step instead, e.g. "Add playback".
6. **Do not duplicate information.** A canvas (the score in written order, the timeline in played order) is the list of its objects. Side panels show the selection's properties or what the canvas cannot show.
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
| `pi-map-marker` | A sync point |
| `pi-trash` | Delete or remove |
| `pi-undo` | Undo, and mirrored (`-scale-x-100`) Redo |
| `pi-arrow-up-left` | The score's Select tool |
| `pi-arrows-alt` | The score's Move tool |
| `pi-stop` | The score's Draw tool |

### Conventions

- Only components that know nothing about shows, songs or playback go into `base/`. A component shared by two areas lives with the one that owns the action.
- Use PrimeVue components styled with Tailwind utilities. For missing behaviour, prefer a library (vueuse, peaks.js) over hand-written pointer, scroll or drag handling.
- Reorderable lists use `useSortable` from `@vueuse/integrations` with a drag handle. In `onUpdate`, undo Sortable's DOM move and change the model instead, so Vue keeps owning the DOM. Every drag handle needs a non-drag alternative (menu and arrow keys, see `SongDetailsForm`).
- No `prompt()`/`confirm()`. Destructive confirmations use PrimeVue's `useConfirm()`, errors use `useNotify()` toasts.
- Dark mode is class-based (`.dark`), and Tailwind's `dark:` variant follows that class. Check every visual change in both modes. Canvases cannot read CSS variables, so they resolve colors through `useCanvasColors()`, which also tells them to redraw when the theme changes.
- Every color is defined once, so a new theme or accent only swaps definitions. The accent (`primary`) and surface palettes come from the PrimeVue preset in `src/theme/preset.ts`. Every other color with a meaning (section kinds, sync points, review, boxes without a number, highlighted tracks, score chips, scrims, attention and danger text) is a semantic token in `src/main.css` with its `.dark` override next to it. Components use `primary`, `surface-*`, PrimeVue's tokens and component severities, or these tokens, never a Tailwind palette color or hex value. Tokens drawn on the score have no dark override, since the score page stays white.
- Section and sync point colors come from `score/sectionColors.ts` and `editor/warp/syncColors.ts`, which map kinds to token classes and variables.
- `ScoreViewer` draws the score overlays from the pure geometry in `core/models/scoreOverlays.ts`. They take no pointer events. Each box's `aria-describedby` names its overlays, so only a section's first chip, the recorded repeat glyph and jump chips are images of their own.
- Locations are shown through `locationFormat.ts`. Markers and location inputs name every occurrence of a measure that plays more than once ("12, 1st time"), while sync points and section names add it only from the second time on, where the first occurrence is the obvious one.
- A MIDI track's title links it to its MIDI data by name, so MIDI tracks cannot be renamed.

### Accessibility

Every change keeps the app usable with a screen reader and keyboard. Prefer native elements and PrimeVue components over ARIA, since no ARIA is better than wrong ARIA.

- Every control has an accessible name: its visible text, a `<label for>`/`input-id`, `aria-labelledby` pointing at a visible heading, or `aria-label` when nothing visible fits. Names say what the control acts on when the same control repeats ("Remove Solo", not "Remove") and contain the visible text.
- Decorative icons and graphics get `aria-hidden="true"` (`<i class="pi ...">`, SVGs in `icons/`, canvases). PrimeVue's own icon props are hidden globally in `main.ts`. An icon that is the only carrier of a meaning gets `role="img"` and an `aria-label` instead.
- Never put `aria-label` on a plain `div` or `span`. Give it a role first, or label something else.
- Pass PrimeVue labels as `aria-label`/`aria-labelledby` on the component. `Select`, `InputNumber`, `Slider`, `ToggleSwitch` and `SelectButton` forward them to the focusable element.
- Expose state: `aria-pressed` on toggle buttons, `aria-expanded` on disclosures, `aria-current="page"` on the current breadcrumb, `aria-live` or `role="status"` on text that changes without focus moving.
- Group repeated items as lists or tables, and name regions and lists (`aria-labelledby` on a visible title), so tests and screen readers can scope to them. Use Tailwind's `sr-only` for text only screen readers need.
- Tests find elements the way users do (`getByRole` with a name). An element a test cannot reach that way lacks a name, so fix the app, not the test.

---

## Testing

- Unit tests need no PocketBase. Mock `axios` and build songs with `src/test/fixtures.ts`. Reuse it and `src/test/updater.ts` instead of writing new helpers.
- `src/test/setup.ts` globally mocks `rubberband-web` and `midi-json-parser` and polyfills `AudioContext` (without an output device, since CI has none) and `WebAudioFontPlayer`. Do not re-mock them per file or import `AudioContext` from `node-web-audio-api`. Override per test with `vi.mocked(parseArrayBuffer).mockResolvedValueOnce(...)`.
- In `afterEach`, use `vi.clearAllMocks()`, not `vi.resetAllMocks()`, which wipes the return values of the global mock factories.

## Keeping the Guides Current

`AGENTS.md` is the only agent instruction format in this repo. Do not add `CLAUDE.md`, `GEMINI.md`, `.cursorrules` or similar copies: a root `CLAUDE.md` would make Claude Code ignore the nested guides.

- The guides describe the current state, not its history. Rewrite or delete outdated statements instead of adding to them, and prefer a shorter guide over a longer one.
- Put knowledge in the most specific guide that fits. Give a subsystem its own `AGENTS.md` once it collects enough non-obvious knowledge, and link it at the top of this file.
- Write what an agent cannot easily learn from the code: why, invariants, traps. Do not copy values or type shapes that live in code.
