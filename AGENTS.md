# choirchaos — Agent Guide

Choir rehearsal web app: a PDF score synchronized with MIDI or multi-track audio playback. Vue 3, Vite, TypeScript, Pinia, PrimeVue, Tailwind v4, PocketBase, Web Audio, `webaudiofont`, `rubberband-web`, `pdfjs-dist`, `measure-detection`.

Nested guides, read before working in their folder: `src/views/AGENTS.md` (pages, song editor), `src/core/player/AGENTS.md` (playback engine), `e2e/AGENTS.md` (end-to-end tests).

## Rules

- Never copy content from `tmp/exampleMidi/` (proprietary, format reference only).
- Never format by hand: `npm run lint:fix` (also canonicalizes Tailwind classes).
- No `_` prefixes (use access modifiers; `_` only for ignored callback args). No TypeScript getters: use `get*()`/`is*()`.
- Avoid comments. If needed, explain why, not what, without emojis, arrows or decorative lines.
- Prefer early returns and extracted functions over nesting. Embed changes into existing code instead of bolting them on; after larger edits, re-read the whole file.
- Work on a branch, PR against `main` (squash-merged, short imperative subjects). Never push to `main`: it deploys to production.

## Commands

```bash
npm run dev          # dev server, http://localhost:5173
npm run dev:https    # LAN dev server over HTTPS for phones (AudioWorklet needs a secure context)
npm run lint:fix
npm run typecheck
npx vitest run       # unit tests; never `npm test`, which watches forever
npm run test:e2e     # end-to-end tests (Docker)
npm run e2e:serve    # seeded backend + frontend for manual checks
```

Before finishing: `lint:fix`, `typecheck`, `vitest run`, plus `test:e2e` when backend access, uploads, routing or a user flow changed.

## Architecture

- `src/core/` is framework-free: no Vue, UI helpers, sizes or styling. State is a `Property<T>`, one-off events an `Emitter<T>` (both return a `Disposable`); Vue reads them through `useEvent()`, which needs an effect scope.
- `src/theme/preset.ts` is the only place for accent and surface palettes; every other color is a token in `src/main.css`.

## Song Model

Three layers, each a PocketBase JSON field read and written whole through its serializer in `core/models/layers.ts` (no handling for older formats), each referencing the one below only by measure ID:
- **Score:** printed measures in written order with their boxes on the PDF. Measures have a stable `id` (`m1`, ...); `label` is free display text, so relabeling never touches references.
- **Recording:** inclusive measure ID spans in the order the backing track plays them, plus sync points: warp markers on measure occurrences and an optional `endSyncTime` where the last measure ends.
- **Arrangement:** markers, cut/repeat/vamp sections, segue.

`Song.getTimeline()` has one entry per measure played; its index is the timeline position. A location `{ measure, beat, occurrence }` is a 0-based beat of a measure's `occurrence`-th play.

Invariants:
- Every layer edit goes through `Song.editLayers()`. Callers compute the next lists with the pure `plan*`/`add*`/`replace*` functions in `core/models/` and never mutate the song. `editLayers()` validates, saves all changed layers in one atomic request (a failed save changes nothing) and fires `onLayersChange` with `timingChanged`. Only beat map uploads write layers otherwise.
- No unresolved references: every measure or recording change remaps references by timeline position (`remapReferences()`, `remapEndSync()`) and drops what has no surviving position. e2e invariants reject leftovers.
- UI never touches the player: `usePlayerSync` follows `onLayersChange` (reload when `timingChanged`, else `syncWarp()`).
- Undo (`songHistory.ts`) stores layer snapshot pairs and refuses (dropping the history) when the layers changed outside it or someone else saved.
- MIDI songs: score and recording come from the beat map (`jsonFile`, passes like `12-2`, `12R` read as measure `12`), which stays the timing source. MIDI recordings are read-only without sync points. Never store a MIDI file without its beat map.

## Score Editing

- A box is a measure's layout; its typed label says which measure it shows. MIDI songs only have beat map measures, so editing moves boxes; audio songs create or relabel measures from boxes.
- Reading order (page, row, left to right; boxes share a row when one's vertical center lies inside the other) decides ranges, renumbering, default labels and where new measures go.
- Planning (`measureEditing.ts`) never resolves conflicts: a box in the way is resolved by the user. Automation (detection, migrations) only proposes: results are previewed until applied, unsure ones stay marked (`layout.review`, `score.unnumberedBoxes`) and keep the song from "ready".
- `measure-detection`, its ONNX models and the onnxruntime WASM are tens of MB: import them only through the dynamic import in `measureDetector.ts`. `vite.config.ts` excludes them from pre-bundling (it breaks their worker and WASM loading). `pdfjs-dist` must satisfy `measure-detection`'s peer range.

## Backend

PocketBase lives in the separate repo `choirchaos-pb`; the URL is `VITE_PB_URL` in `.env`.
- Writing a multi-file field (`audioFiles`) by its plain name replaces all files: use `audioFiles+` / `audioFiles-`.
- `pb_hooks/audio.pb.js` converts uploads to MP3: map stored files to uploads by order, never by extension.
- Users only read their own user record: member names and lookups go through `pb_hooks/members.pb.js`.

## UI

Rehearsers (viewers) only play songs and never see editing controls, hints or empty states. Editors also set up shows and songs. Every page, the editor included, works on phones, tablets and desktops.

Design principles:
- One job per element type: links, rows and crumbs navigate; pickers choose what the page shows; buttons act or open a dialog (labels never end in "..."); toggles switch a mode and look pressed.
- State that matters lives in the URL. Every action has one home; secondary entry points open the same dialog under the same label.
- A canvas (score in written order, timeline in played order) is the list of its objects; panels show only the selection or what the canvas cannot. Select, then act: one kind of object selected at a time.
- Every page starts with `HeaderBar`, whose breadcrumb reaches every parent (no back buttons). Dialogs exit with "Cancel". Destructive actions are confirmed (`useConfirmDestructive()`), everything else saves immediately. Errors are `useNotify()` toasts; never `prompt()`/`confirm()`.
- Empty states and hints name the next step and contain its control.

Icons have one meaning each. Icon-only buttons only for universally known controls; always an `aria-label`.

| Icon | Meaning |
|---|---|
| `pi-pencil` | The "Edit" toggle, or opening a song in the editor |
| `pi-check` | Confirmed or ready |
| `pi-file-edit` | Song details |
| `pi-sliders-v` | Personal preferences |
| `pi-ellipsis-v` | More actions for this item |
| `pi-sparkles` | Automatic measure detection |
| `pi-bookmark`, `pi-map-marker` | Marker, sync point |
| `pi-trash` | Delete an object of the show or song |
| `pi-times` | Close, cancel, clear the selection, or take an item out of a list |
| `pi-plus` | Create or add |
| `pi-file-pdf`, `pi-sliders-h`, `pi-map`, `pi-volume-up` | Score PDF, MIDI file, beat map, audio recording |
| `pi-undo` | Undo; mirrored (`-scale-x-100`) Redo |

Conventions:
- **Performance:** playback must stay smooth on low-end phones. The player store changes `position` every step, `currentLocation` every beat, `currentTimelinePosition` every measure: read the slowest that suffices, and only in small leaf components, so pages never re-render per step. Computeds following playback return primitives. Hidden phone tabs stay mounted, so this holds for every panel.
- **Reuse:** `base/` knows nothing of shows, songs or playback. Reuse `FieldRow`, `StepperInput`, `CollapsiblePanel`, `RemoveButton` before writing markup another file already has.
- **Styling:** PrimeVue styled with Tailwind. Never `px` sizes. Never a Tailwind palette color or hex value: colored surfaces use a token's 400 shade (`bg-warn` with `text-warn-contrast`), colored text its `-text` token (`text-primary-text`, never `text-primary`). Overlays use `scrim`. Dark mode is the `.dark` class: check both modes. Canvases resolve colors through `useCanvasColors()`.
- **Interaction:** prefer a library (vueuse, peaks.js) over hand-written pointer, scroll or drag code. Reorderable lists use `useSortable` with a drag handle; in `onUpdate` undo Sortable's DOM move and change the model. Every drag has a non-drag alternative.
- **Score overlays:** `ScoreViewer` draws from the pure geometry in `scoreOverlays.ts`. Box states are outlines, never borders, so corner badges never move. Only badges take pointer events.
- Locations are formatted through `locationFormat.ts` only.

Accessibility: prefer native elements and PrimeVue over ARIA (no ARIA beats wrong ARIA). Every control has a name (visible text, label, `aria-labelledby`, else `aria-label`; never on a plain `div`/`span`), repeated controls name their target ("Remove Solo"). Expose state (`aria-pressed`, `aria-expanded`, `aria-live`), name regions and lists. Tests find elements by role and name: if a test cannot, fix the app.

## Testing

- Unit tests need no PocketBase: mock `axios`, build songs with `src/test/fixtures.ts`.
- `src/test/setup.ts` globally mocks `rubberband-web` and `midi-json-parser` and polyfills `AudioContext` and `WebAudioFontPlayer`. Never re-mock them; override per test with `vi.mocked(...).mockResolvedValueOnce(...)`.
- In `afterEach` use `vi.clearAllMocks()`, never `vi.resetAllMocks()` (it wipes the global mocks).

## Keeping the Guides Current

`AGENTS.md` is the only agent instruction format; never add `CLAUDE.md` (a root one makes Claude Code ignore the nested guides). Guides hold what the code does not show: why, invariants, traps. Describe the current state, keep it short, put knowledge in the most specific guide, never copy values or types from code.
