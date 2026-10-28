# choirchaos — Agent Guide

Choir rehearsal web app: a PDF score synchronized with MIDI or multi-track audio playback. Vue 3, Vite, TypeScript, Pinia, PrimeVue, Tailwind v4, PocketBase, Web Audio, `webaudiofont`, `rubberband-web`, `pdfjs-dist`, `measure-detection`.

Nested guides, read before working in their folder: `src/views/AGENTS.md` (pages, song editor), `src/core/player/AGENTS.md` (playback engine), `e2e/AGENTS.md` (end-to-end tests).

## Rules

- Never copy content from `tmp/exampleMidi/` (proprietary, format reference only).
- Never format by hand: `npm run lint:fix`, which also orders Tailwind classes and rewrites them to their canonical form (`shrink-2`, not `shrink-[2]`).
- No `_` prefixes (use access modifiers; `_` only for ignored callback args). No TypeScript getters: use `get*()`/`is*()`.
- Avoid comments. If needed, explain why, not what, without special characters (emojis, arrows, decorative lines).
- Prefer early returns and extracted functions over nesting.
- Changes are embedded into existing code, not bolted on. After larger edits, re-read the whole file.
- Work on a branch, PR against `main` (squash-merged, short imperative subjects). Never push to `main`: it deploys to production.

## Commands

```bash
npm run dev          # dev server, http://localhost:5173
npm run lint:fix     # eslint with autofix
npm run typecheck    # vue-tsc --build
npx vitest run       # unit tests (add a path for one file); never `npm test`, which watches forever
npm run build        # typecheck + production build
npm run test:e2e     # end-to-end tests (Docker)
npm run e2e:serve    # seeded backend + frontend for manual checks
```

Before finishing: `lint:fix`, `typecheck`, `vitest run`, plus `test:e2e` when backend access, uploads, routing or a user flow changed. CI also builds.

## Layout

| Path | Contents |
|---|---|
| `src/views/` | Routed pages |
| `src/components/` | Components by area (`header/`, `show/`, `song/`, `player/`, `editor/`, `score/`), plus generic `base/` and `icons/` |
| `src/composables/` | Reactive logic: `useEvent()` (core events into Vue), the editor's `useEditorSelection`, `useMeasureEditor` (drawing, placing, review; both set up by `provideSongEditor`), `useRecordingEditor`, `useSyncEditor`, `usePlayerSync`, `useSongHistory`, `useTimelineAxis` (zoom steps in `zoom.ts`), `usePanZoom`, `useMarqueeSelection`, `useConfirmDestructive` |
| `src/stores/` | Pinia stores, persisted settings in `settings/` (one file per category) |
| `src/router/` | Routes and guards |
| `src/theme/` | PrimeVue preset: the only place for accent and surface palettes |
| `src/core/models/` | Domain models and their pure logic: layers and undo, recording, locations, sections, selection, setup status, measure editing, detection, review, score overlays, warp editing |
| `src/core/import/` | Groups dropped files into songs by number |
| `src/core/player/` | Playback engine (MIDI and audio backends) |
| `src/core/midi/` | MIDI events, beat map import, `WarpMap` (timeline position to recording time) |
| `src/core/pdf/` | PDF rendering in a worker, measure detection |
| `src/core/utils/` | `Property`/`Emitter`, song `Numbering`, `Updater`, small helpers |
| `src/pocketbase/` | Client, auth, DB access |
| `src/test/` | Unit test setup, fixtures, helpers |
| `e2e/` | Playwright tests and test data generators |

`src/core/` is framework-free logic only: no UI helpers, sizes or styling values. Vue reads it through `useEvent()` (needs an effect scope). State is a `Property<T>` (`on*Change`; `Property<void>` fires with `fire(undefined)`), one-off events an `Emitter<T>`; both return a `Disposable`.

## Song Model

Three layers, each referencing the one below only by measure ID:
- **Score:** printed measures in written order, with their boxes on the PDF.
- **Recording:** inclusive measure ID spans in the order the backing track plays them, plus sync points: warp markers on measure occurrences and an optional `endSyncTime` where the last measure ends (warp map position `timeline.length`), which songs leave out until synced.
- **Arrangement:** markers, cut/repeat/vamp sections, segue.

Invariants:
- Measures are identified by stable `id` (`m1`, `m2`, ...). `label` is free display text, so relabeling never touches references.
- `Song.getTimeline()` has one entry per measure played; its index is the timeline position. A location `{ measure, beat, occurrence }` is a 0-based beat of a measure's `occurrence`-th play.
- Each layer is one PocketBase JSON field (`score`, `recording`, `arrangement`), always read and written whole through its serializer in `layers.ts`. No handling for older formats.
- Every layer edit goes through `Song.editLayers()`. Callers compute the next lists with pure functions (`planMeasureEdit()`, `planRecordingChange()`, `replaceSections()`, `addMarker()`, `addWarpMarker()`, ...) and never mutate the song. `editLayers()` orders references, validates the changed fields (all references once the timeline changed, so older stored data only blocks edits of its own field), saves all changed layers in one atomic request and fires `onLayersChange` with both snapshots and `timingChanged`. A failed save changes nothing. Only uploads with a beat map write layers otherwise.
- A song with measures has recording spans. Every measure or recording change drops the references it leaves unresolved (e2e invariants reject them).
- Recording changes (`planRecordingChange()`, used by `setRecordingSpans()` and the duplicate migration) move references by timeline position through `remapReferences()`, keeping sync point times, and drop only what has no surviving position. The end sync point belongs to the old last measure: it stays while that measure still ends the recording, becomes the warp marker of the measure now following it, and is dropped with it (`remapEndSync()`, also for measure edits). Span helpers return normalized spans (`spansFromSequence()`); the UI previews with `previewRecordingSpans()`.
- `usePlayerSync` follows `onLayersChange`: reload at the same time when `timingChanged`, otherwise `syncWarp()`. Callers never touch the player, so UI never waits for audio.
- Undo (`songHistory.ts`) stores snapshot pairs for the song open in the editor and restores through `restoreLayers()`. It covers the three layers and the segue (not files, details, tracks) and resets when the song changes or the editor closes. It refuses and drops the history when the layers changed outside it (beat map upload) or the record's `updated` differs from `Song`'s last save (someone else saved). A failed save keeps it.
- A MIDI song's score and recording come from its beat map (`jsonFile`) via `scoreFromBeatMap()`, which reads passes `12-2`, `12R` as measure `12`. The beat map stays the timing source: MIDI recordings are read-only and have no sync points. Never store a MIDI file without its beat map.
- `Numbering` is only for song numbers; `measureLabel.ts` only suggests labels for new boxes.

## Score Editing

- A box is a measure's layout; its typed label says which measure it shows. MIDI songs only have beat map measures, so editing moves boxes. Audio songs own their measures: a box on an unused label creates the measure at its reading-order position, or relabels its old measure (keeping ID and references) if that would be left without a box.
- `measureEditing.ts` plans each box action as a `PlannedEdit`: one `MeasureEdit` for `Song.applyMeasureEdit()` plus the placed boxes as `BoxTarget`s (an existing ID, or an addition's index in the score after the edit, since IDs are assigned on save). `useMeasureEditor.apply()` saves and selects them. Removal cleanup and span maintenance live in `planMeasureEdit()`.
- Reading order (page, row, left to right; boxes share a row when one's vertical center lies inside the other) decides range selection, renumbering, default labels and where new measures go. `suggestLabel()`: next score measure in MIDI songs, next whole number in audio songs.
- A box in the way is a conflict the user resolves (swap or shift); planning never resolves it.
- Measures compare by ID, unnumbered boxes by position (`isSameLayout()`); an edit resolving some sends the whole remaining list.

### Measure Detection

- Detection never writes: `planMeasureDetection()` is previewed until applied (`toMeasureEdit()`) or discarded. Numbers match labels case-insensitively. Only parseable measure numbers create measures, never in MIDI songs.
- Unsure results stay marked: low confidence sets `layout.review`, boxes without a usable number go to `score.unnumberedBoxes`, leftovers on an existing box are dropped (detecting twice adds nothing). Confirming or renumbering clears `review` (boxes only shifted aside keep it); numbering an unnumbered box makes it that measure's layout. Open review items keep `songSetup` from "ready".
- Detection layouts share `MeasureLayout`'s page fractions and 0-based pages.
- `measure-detection`, its ONNX models and the onnxruntime WASM are tens of MB: import them only through the dynamic import in `measureDetector.ts`. `vite.config.ts` excludes both from pre-bundling (it breaks their worker and WASM loading). `pdfjs-dist` must satisfy `measure-detection`'s peer range, since the app passes its own `PDFDocumentProxy`.

## Backend

PocketBase lives in `choirchaos-pb`; the URL is `VITE_PB_URL` in `.env`.
- Writing a multi-file field (`audioFiles`) by its plain name replaces all files. Use `audioFiles+` / `audioFiles-`.
- `pb_hooks/audio.pb.js` converts uploads to MP3 (same base name, `.mp3`). Map stored files to uploads by order (`Song.uploadAudioFiles()`), never by extension. An undecodable file fails the request.
- Users only read their own user record: member names and email lookups use `pb_hooks/members.pb.js` (`Show.getMembers()`/`addMember()`). Role changes and removals are regular show updates (owner only).

## UI

Rehearsers (viewers) only play songs. Editors (editors, owners) also set up shows, songs, measures, markers, sections and audio sync. Every page, the editor included, works on phones, tablets and desktops.

### Design Principles

1. **Rehearsers never see editing**: no edit control, hint or editing empty state.
2. **One job per element type.** Links, list rows and crumbs navigate; pickers choose what the page shows; buttons act or open a dialog/popover (labels never end in "..."); segmented controls and toggles switch a mode and look pressed. A click on the score always moves the playhead and in the editor also selects.
3. **One meaning per icon** (table below). Icon-only buttons only for universally known controls (transport, close, overflow); everything else has a text label where room allows, always an `aria-label`.
4. **State that matters lives in the URL**, so reload and back keep the place. Editing a song is a route.
5. **Every action has one home.** Secondary entry points open the same dialog or page under the same label; only empty states and hints may name the step ("Add playback").
6. **No duplicated information.** A canvas (score in written order, timeline in played order) is the list of its objects; panels show the selection or what the canvas cannot.
7. **Select, then act.** One kind of object is selected at a time (measures, boxes without a number, a section, a marker, a sync point, a recording pass); the panel shows only what applies, edits the whole selection and shows mixed values as empty. Measures are edited in the pass at the playhead.
8. **Automation proposes, the user decides**: results are previewed in place, leftovers stay marked until resolved.
9. **Empty states and hints name the next step** and contain its control.
10. **The top bar says where you are**: every page starts with `HeaderBar`, whose breadcrumb reaches every parent (no back buttons). Dialogs exit with "Cancel". Destructive actions are confirmed, everything else saves immediately.
11. **The account menu is for the account only** (preferences, sign out).
12. **Keep the canvas readable**: small overlays, handles only where the user works, every arrangement object visible where it lives (never only in a list), color never the only carrier.

| Icon | Meaning |
|---|---|
| App logo | Home |
| `pi-pencil` | The "Edit" toggle, or opening a song in the editor |
| `pi-check` | Confirmed or ready |
| `pi-file-edit` | Song details (number, title, files, tracks) |
| `pi-play` | Play |
| `pi-sliders-v` | Personal preferences |
| `pi-ellipsis-v` | More actions for this item |
| `pi-sparkles` | Automatic measure detection |
| `pi-bookmark` | Marker |
| `pi-map-marker` | Sync point |
| `pi-trash` | Delete an object of the show or song (song, measure, section, marker, sync point, recording pass, boxes without a number) |
| `pi-times` | Close, cancel, clear the selection, or take an item out of a list (file, track, member, shortcut, cover) |
| `pi-plus` | Create or add |
| `pi-file-pdf`, `pi-sliders-h`, `pi-map`, `pi-volume-up` | Score PDF, MIDI file, beat map, audio recording |
| `pi-home` | Home where the logo is not at hand (404 page) |
| `pi-undo` | Undo; mirrored (`-scale-x-100`) Redo |

### Conventions

- `base/` only holds components that know nothing of shows, songs or playback. A component shared by two areas lives with the area that owns the action.
- Repeated UI is one component: `base/FieldRow` (label and control), `base/StepperInput`, `RemoveButton` (inspector delete). Reuse before writing markup another file already has.
- PrimeVue components styled with Tailwind. Never `px` sizes: Tailwind classes, else `rem` in the style. For missing behaviour prefer a library (vueuse, peaks.js) over hand-written pointer, scroll or drag code.
- Reorderable lists: `useSortable` (`@vueuse/integrations`) with a drag handle; in `onUpdate` undo Sortable's DOM move and change the model. Every drag has a non-drag alternative (menu, arrow keys; see `SongDetailsForm`).
- No `prompt()`/`confirm()`: destructive confirmations use `useConfirmDestructive()`, errors `useNotify()` toasts.
- Dark mode is the `.dark` class (Tailwind `dark:` follows it); check both modes. Canvases resolve colors through `useCanvasColors()`, which also triggers redraws on theme change.
- Every color is defined once. Accent (`primary`) and surface palettes come from `src/theme/preset.ts`; every other meaningful color is a token in `src/main.css`, grouped as PrimeVue overwrites, fixed app colors (section kinds, sync points, highlighted tracks, scrims) and theme colors (markers, severities `info`, `success`, `warn`, `help`, `danger`). Never a Tailwind palette color or hex value. Colored surfaces use a token's 400 shade in both modes (`bg-warn`, with `text-warn-contrast` on it); colored text uses its `-text` token (600 light, 400 dark; `text-primary-text`, never `text-primary`). Review marks are `warn`, boxes without a number `danger`. Every full page overlay, PrimeVue's dialog masks included, uses `scrim`. `score/sectionColors.ts` (sections and markers) and `editor/timeline/syncColors.ts` map kinds to token classes.
- `ScoreViewer` draws from the pure geometry and texts in `scoreOverlays.ts`. Every box is a `ScoreBox` (badges in its corners at one inset) and every short label a `ScoreBadge`. Box states are outlines, never borders, so badges never move. Badges above boxes stack in `ScoreLane`s. Score overlays are static like the timeline's (no playing pass, no recorded repeat badge); jump chips are editing information and only show in the editor.
- Badges are the only overlays taking pointer events: section and marker badges are buttons that select in the editor and seek while rehearsing; others pass the click to their box. Each box's `aria-describedby` names all its overlays.
- Locations are shown through `locationFormat.ts`: markers and location inputs name every occurrence of a repeated measure ("12, 1st time"); sync points and section names only from the second.
- MIDI track titles link to their MIDI data by name, so MIDI tracks cannot be renamed.

### Accessibility

Keep everything usable by screen reader and keyboard. Prefer native elements and PrimeVue over ARIA (no ARIA beats wrong ARIA).
- Every control has a name: visible text, `<label for>`/`input-id`, `aria-labelledby` to a visible heading, else `aria-label`. Repeated controls name their target ("Remove Solo") and contain the visible text.
- Decorative icons and canvases get `aria-hidden="true"` (PrimeVue icon props are hidden globally in `main.ts`). An icon that alone carries meaning gets `role="img"` and a label. Never `aria-label` a plain `div`/`span`.
- Pass labels to PrimeVue components as `aria-label`/`aria-labelledby`; `Select`, `InputNumber`, `Slider`, `ToggleSwitch` and `SelectButton` forward them.
- Expose state: `aria-pressed` on toggles, `aria-expanded` on disclosures, `aria-current="page"` on the current crumb, `aria-live`/`role="status"` on text that changes without focus.
- Group repeated items as lists or tables and name regions and lists, so tests and screen readers can scope. `sr-only` for screen-reader-only text.
- Tests find elements by role and name. If a test cannot, fix the app.

## Testing

- Unit tests need no PocketBase: mock `axios`, build songs with `src/test/fixtures.ts`, reuse it and `src/test/updater.ts`.
- `src/test/setup.ts` globally mocks `rubberband-web` and `midi-json-parser` and polyfills `AudioContext` (no output device; CI has none) and `WebAudioFontPlayer`. Never re-mock them or import `AudioContext` from `node-web-audio-api`; override per test with `vi.mocked(...).mockResolvedValueOnce(...)`.
- In `afterEach` use `vi.clearAllMocks()`, never `vi.resetAllMocks()` (it wipes the global mock factories' return values).

## Keeping the Guides Current

`AGENTS.md` is the only agent instruction format. Never add `CLAUDE.md` or similar copies: a root `CLAUDE.md` makes Claude Code ignore the nested guides.
- Describe the current state, not history. Rewrite or delete outdated text; shorter is better.
- Put knowledge in the most specific guide; give a subsystem its own guide once it collects enough, and link it at the top.
- Write what the code does not show: why, invariants, traps. Never copy values or types that live in code.
