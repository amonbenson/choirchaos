# Views — Agent Guide

Extends the root `AGENTS.md`, whose rules and UI design principles apply here too.

## Pages and Navigation

| Page | Route | Who | Owns |
|---|---|---|---|
| `HomeView` | `home` `/` | everyone | Picking and creating shows |
| `ShowEditView` | `show-edit` `/show/:showId/edit` | editors | Show title, cover, sharing, deletion, the song list, creating and importing songs |
| `WorkspaceView` | `show`, `song` `/show/:showId/song/:songId` | everyone | Rehearsing: transport, mixer, markers, score |
| `WorkspaceView` | `song-edit` `/show/:showId/song/:songId/edit` | editors | The inspector, the timeline, song details, deleting the song |

Every page starts with `HeaderBar`. Its start holds `ShowBreadcrumb`, modelled on GitHub's `owner / repo` header:

```
[logo] / Show title / #3 Song v   [Edit] [Details]     |<< > >|   measure  section  ...  (account)
```

- The show crumb leads editors to the show page, and viewers, who have no show page, to the first song. Show cards do the same.
- The song crumb is a picker. It replaces the route and keeps the page, so the player stays the player and the editor stays the editor.
- "Edit" (editors only) switches between player and editor with `router.replace`, so both share one history entry. `WorkspaceView` decides whether it edits from the route name, never from local state, and the router guard sends viewers who open an edit URL to the player.
- Pages without playback leave out `playback`. The transport then disappears and "Choir Chaos" is centered in the bar.
- Both views and the router guard get the show from `stores/show`, which keeps one instance while the route stays in that show. Never fetch the show per view, or the header loses it on every switch between the show page and a song.
- Songs are only created on the show page (`NewSongDialog` or importing files). Song rows open the player, and their setup status button opens the editor, with the details dialog open for missing files.
- Song details are a dialog (`?details=1`), opened by "Details" next to Edit. `NewSongDialog` and the editor's `SongDetailsDialog` share `SongDetailsForm`. The dialog keeps a draft and saves with "Save", because saving uploads files, and "Cancel" drops the draft.

## Song Editor

The editor has two canvases, the score (written order) and the timeline (played order), and the inspector (`SongEditorPanel`, files in `editor/inspector/`), which takes the place of the player's Markers panel. The player shows that panel only when the song has markers.

### Selection

- `core/models/selection.ts` defines the selection: exactly one kind at a time, either measures (by ID), boxes without a number (by position), one section (by its start location, since sections never overlap), one marker (by location and name), one sync point (by occurrence), one recording pass (by index) or nothing. Selecting one kind replaces the others, so a section is never selected together with its measures. `resolveSelection()` looks the objects up after every save, and a selection whose objects are gone (undo, delete) resolves to nothing.
- `useEditorSelection` holds it for the score, the inspector and the timeline. For selected measures it derives their runs (where the recording plays them back to back) and picks the one at or nearest to the playhead, so the playhead decides which pass the inspector edits. `selectAndSeek()` selects an object and moves the playhead to it, as clicks in the timeline do. An edit that changes how an object is identified (renaming a marker, moving a section's start) selects the edited object again.
- A click on a box enters the measure at its first pass, in the player and in the editor. Other passes are reached through the inspector's pass picker ("Pass, follows the playhead") or the timeline.
- The timeline never selects measures: a click on a measure cell only seeks. Its sections, markers, recording passes and sync points select themselves. On the score, section and marker badges select their object the same way, and a click on any other badge selects its box.

### Inspector

- `SongEditorPanel` shows one panel per selection kind and nothing that does not apply: `MeasuresInspector`, `BoxesInspector`, `SectionInspector`, `MarkerInspector`, `SyncPointInspector`, `PassInspector`, and `SetupOverview` with nothing selected. Each panel exposes `remove()`, which the Delete key calls while no field has the focus.
- Every inspector, score and timeline edit saves through `Song.editLayers()` and never touches the player, which follows on its own (root guide, Song Model).
- **Measures:** number (renumber from, for several) and beats, the pass picker, and one "Delete". In audio songs Delete removes the measures with their boxes, in MIDI songs it only takes them off the score, where they show under "Not on the score"; the confirmation says which. Users never see boxes and measures as two things, so "box" only names detection leftovers. When the measures play back to back, the panel adds:
  - **Section:** "Part of Vamp 19 to 20" with a link that selects the section, or Repeat, Vamp and Cut, which create a section over whole measures of the pass at the playhead and select it. A new section that overlaps others asks before replacing them in one save.
  - **Markers:** links to the markers on the pass's first measure, and "Add marker at ...", which adds one on beat 1 and selects it with its name focused.
  - **Recording** (audio songs): "Recorded N times" and the jump after the last measure.
  - **Audio sync** (audio songs): a link to the pass's sync point, or "Sync to playhead", which adds one and selects it.
- **Section:** kind (Repeat, Vamp, Cut), a repeat's passes, a vamp's Out and vocals, and "Remove section" (confirmed). A vamp has no pass count: it always plays until released. Sections are saved over whole measures (`withRun()`), and a change that `validateSections()` rejects is not saved but explained. The selected section's first pass is outlined on the score with range handles: sliders that move its first or last measure by one with the arrow keys, or snap to the box they are dropped on.
- **Marker:** name, location with "Move to playhead", and delete.
- **Sync point:** its start time (typed, or nudged with buttons or the up and down arrow keys, the keyboard alternative to dragging), "Sync to playhead", "Move to another measure" (keeps the time, and the selection follows) and remove (confirmed). Sync points can only sit between their neighbours, so these controls are disabled or clamp otherwise. In edit mode the score shows a pin under every synced box.
- **Recording pass:** move earlier or later, remove, and "Edit as text". MIDI recordings come from the beat map and are shown read-only. Every recording change saves through `useRecordingEditor`, which previews the new length and the references a change would drop, and asks only when something would be dropped.
- **Nothing selected:** the setup checklist and hints, the duplicate-box proposals, the review queue, "Add measures" and "Detect", "Not on the score" with "Place", the sync status (audio songs: passes without a sync point and stretches of more than `MAX_MEASURES_PER_SYNC_POINT` measures between them) and the recording list, whose passes select themselves.
- **Duplicate boxes** only exist to migrate old songs that faked a repeat with extra measures. `core/models/duplicateMigration.ts` and `DuplicateReviewCard.vue` hold all of it, and one line in `SetupOverview.vue` shows the card, so the feature goes away by deleting those two files (and their tests) and that line. The proposals never block "ready": the stored song has no place for "keep separate", so that choice lives in `sessionStorage` until the browser tab closes.

### Undo

"Undo" and "Redo" are icon-only buttons in the inspector's title row, which stays visible on phones while the bottom sheet is collapsed. The header has no room for them below `sm` without squeezing the song crumb. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo, but only while no text field has focus, so fields keep their own text undo. A refused or failed undo explains itself in a toast.

### Timeline

`editor/warp/TimelinePanel` shows the song in played order: lanes for markers, sections, recorded passes and played measures and, for audio songs, the waveform with its sync points. With a waveform the lanes follow its zoom and scroll, without one they scroll on their own. Measure cells only seek. Everything else selects itself and is edited in the inspector.

### Score Gestures and Drawing

- The score has no toolbar. Selecting is the default: a drag pans, even when it starts on a box, a click selects, ctrl/cmd-click toggles, shift-click selects the range in reading order, and a click on empty space or Escape clears the selection. A drag never clears it, since `usePanZoom` swallows the click that ends a pan. Touch long-press starts multi-select. Ctrl/cmd+A and "Select all" (touch devices only, since they have no shortcut) select every measure. The middle button, the wheel and pinching always pan or zoom. Resize handles appear on a single selected measure only.
- Drawing starts from "Add measures" in the setup overview or "Place" under "Not on the score", and ends with "Done", Escape or any selection. While drawing, a layer over the score turns drags into boxes with vueuse's `usePointerSwipe`, and the inspector asks what a drawn box holds. Placing keeps drawing, so the next box continues the numbering. Audio songs without a score add measures by number instead.
- `useMeasureEditor` leaves the form that planned an edit before saving it (`placePendingBox()`, `resolveReview()`) and brings it back if the save fails. A form that stayed mounted would plan again against its own saved result and briefly show its new measures as a conflict.
- All box work happens in the inspector. The score only selects and draws, never opens a popover.

### Detection Review

- While a detection result exists, the score shows it as dashed boxes (amber when unsure, red "?" without a number), dims existing boxes and cannot be edited until the result is applied or discarded.
- Applied leftovers stay marked the same way. Red "?" boxes are their own selection kind: one is numbered or removed, several can only be removed.
- The review bar steps through leftovers in reading order. Without a focused field, Enter confirms, typing starts correcting the number and Delete removes the measure or box. The review buttons release focus after a click, otherwise Enter would activate whatever button kept it.

## Layout Across Screen Sizes

- **Panels:** from `lg` up, `WorkspaceView` shows its side panels next to the score, and the timeline collapses to its header (`workspace.panelVisible.warp`). Below `lg` it shows one panel at a time behind a tab bar, so a new panel needs a tab there too. The timeline is then the "Timeline" tab and shares the panels' grid cell, so both name `row-start-3 col-start-1` explicitly: auto-placement would push one of them into an implicit row or column.
- **Bottom sheet:** below `lg` the inspector is a bottom sheet over at most half the score, collapsed to its title row until it is tapped or something is selected or drawn. It is a single instance moved by CSS, so its inputs never exist twice in the DOM. `WorkspaceView` passes its height to the score as `coveredBottom`, and the score counts that strip as hidden, so it moves the box clicked last above the sheet whenever the sheet grows.
- **Header:** below `lg` the breadcrumb shares the first row with the account, and the transport and playback controls take the second. The playback controls never collapse into a menu: they scroll sideways in their own cell, and its edges fade where more controls lie outside, so the account always stays in the bar. Below `sm` "Edit" is an icon-only round button like the logo, decided by that viewport breakpoint alone, and the show crumb shrinks to "..." while a song is shown. The crumbs truncate instead of wrapping. The buttons at the start and end of the bar share one responsive gap (`BAR_GAP`), so new buttons there must not add their own margins.
- The header shows the same playback information in both modes. Only the time signature reads "-/-" for audio songs, since measures store beats but no beat unit. The section button shows a playing repeat's pass and is disabled then, releases or resets a playing vamp, and otherwise reads "Vamp", disabled.
- `App.vue` cancels the browser's page zoom on ctrl/cmd+wheel and trackpad pinch with one `window` listener. Components that zoom on these gestures (score, timeline) handle them on their own element first.
- Both collapsible panels are built on `base/CollapsiblePanel`, so their border, corners and chevron stay identical. Do not restyle one by hand. PrimeVue's `Panel` lays out its content in a grid with an `auto` column, so a panel never gets narrower than its content's min-content width. Panels that must shrink set `pt:content-wrapper="min-w-0"`.
