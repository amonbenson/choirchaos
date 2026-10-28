# Views — Agent Guide

Extends the root `AGENTS.md`.

## Pages and Navigation

| Page | Route | Who | Owns |
|---|---|---|---|
| `HomeView` | `home` `/` | everyone | Picking and creating shows |
| `ShowEditView` | `show-edit` `/show/:showId/edit` | editors | Show title, cover, sharing, deletion, song list, creating and importing songs |
| `WorkspaceView` | `show`, `song` `/show/:showId/song/:songId` | everyone | Rehearsing: transport, mixer, markers, score |
| `WorkspaceView` | `song-edit` `/show/:showId/song/:songId/edit` | editors | Inspector, timeline, song details, deleting the song |

`HeaderBar` starts with `ShowBreadcrumb` (modelled on GitHub's `owner / repo`):

```
[logo] / Show title / #3 Song v   [Edit] [Details]     |<< > >|   measure  section  ...  (account)
```

- The show crumb (and show cards) leads editors to the show page and viewers, who have none, to the first song.
- The song crumb is a picker: it replaces the route and keeps player or editor.
- "Edit" (editors) toggles player and editor with `router.replace`, sharing one history entry. `WorkspaceView` decides from the route name, never local state; the guard sends viewers from edit URLs to the player.
- Pages without `playback` have no transport and center "Choir Chaos".
- Views and guard read the show from `stores/show`, one instance while the route stays in the show. Never fetch it per view, or the header loses it on every switch.
- Songs are only created on the show page (`NewSongDialog`, file import). Rows open the player; their setup status button opens the editor, with details open for missing files.
- Song details are a dialog (`?details=1`, button "Details"). `NewSongDialog` and `SongDetailsDialog` share `SongDetailsForm`, which keeps a draft and saves on "Save" (it uploads files).

## Song Editor

Two canvases, the score (written order) and the timeline (played order), plus the inspector (`SongEditorPanel`, `editor/inspector/`), which replaces the player's Markers panel (shown only for songs with markers).

### Selection

- `core/models/selection.ts`: one kind at a time, measures (by ID), boxes without a number (by position), a section (by start location; sections never overlap), a marker (location and name), a sync point (occurrence), a recording pass (index), or nothing. A section is never selected with its measures. `resolveSelection()` looks objects up after every save; vanished objects (undo, delete) resolve to nothing.
- `useEditorSelection` shares it between score, inspector and timeline. For measures it derives their runs (back-to-back plays) and picks the one at or nearest the playhead, which decides the pass the inspector edits. `selectAndSeek()` selects and moves the playhead, as timeline clicks do. Edits that change identity (renaming a marker, moving a section start) reselect the edited object.
- Clicking a box enters its measure's first pass, in player and editor. Other passes: the pass picker ("Pass, follows the playhead") or the timeline.
- Without a score PDF, `MeasureGrid` lists the measures in written order where the score would be, with the same gestures. `getSelectableMeasures()` decides what is selectable and the order ranges walk: boxes in reading order, or all measures in score order without a PDF.
- The timeline never selects measures (cells only seek); its sections, markers, passes and sync points select themselves. On the score, section and marker badges select their object, other badges their box.

### Inspector

One panel per selection kind: `MeasuresInspector`, `BoxesInspector`, `SectionInspector`, `MarkerInspector`, `SyncPointInspector`, `PassInspector`, or `SetupOverview`. Each exposes `remove()` for the Delete key (when no field has focus). All edits from inspector, score and timeline go through `Song.editLayers()`.

- **Measures:** number ("renumber from" for several), beats, pass picker, one "Delete" (audio: removes measures and boxes; MIDI: takes them off the score, listed under "Not on the score"; the confirmation says which). "Box" only names detection leftovers. When the measures play back to back, it adds:
  - **Section:** "Part of Vamp 19 to 20" linking to the section, or Repeat/Vamp/Cut creating a section over whole measures of the pass at the playhead (replacing overlapped sections asks first, then saves once).
  - **Markers:** links to markers on the pass's first measure, and "Add marker at ..." (beat 1, selected with its name focused).
  - **Recording** (audio): "Recorded N times" and the jump after the last measure.
  - **Audio sync** (audio): link to the pass's sync point, or "Sync to playhead".
- **Section:** kind, a repeat's passes, a vamp's Out and vocals (vamps always play until released), "Remove section" (confirmed). Saved over whole measures (`withRun()`); a change `validateSections()` rejects is explained, not saved. The selected section's range is shaded on the score with slider handles (arrows move one position, Home/End to the ends, drops snap to a box); the timeline has the same handles.
- **Marker:** name, location with "Move to playhead", delete.
- **Sync point:** start time (typed, nudge buttons, up/down keys as the drag alternative), "Sync to playhead", "Move to another measure" (keeps the time), remove (confirmed). Sync points stay between their neighbours, so controls clamp or disable. In edit mode synced boxes show a pin.
- **Recording pass:** move earlier/later, remove, "Edit as text". Moves and removals save normalized spans (`moveSpan()`, `removeSpan()`), so a pass can merge with its neighbour and the selection follows the merged pass. MIDI recordings are read-only. All recording changes go through `useRecordingEditor`, which previews the new length and dropped references and asks only when something would be dropped.
- **Nothing selected:** checklist and hints, duplicate-box proposals, review queue, "Add measures", "Detect", "Not on the score" with "Place", sync status (audio: passes without a sync point, stretches over `MAX_MEASURES_PER_SYNC_POINT` measures) and the recording list (passes select themselves).
- **Duplicate boxes** only migrate old songs that faked repeats with extra measures: all of it is `core/models/duplicateMigration.ts`, `DuplicateReviewCard.vue` (plus tests) and one line in `SetupOverview.vue`, so removal is deleting those. Proposals never block "ready"; "keep separate" has no stored place and lives in `sessionStorage`.

### Undo

Icon-only "Undo"/"Redo" sit in the inspector's title row, visible on phones with the sheet collapsed (the header has no room below `sm`). Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo, only without a focused text field (fields keep their own undo). Refusals and failures explain themselves in a toast.

### Timeline

`editor/timeline/TimelinePanel`: lanes for markers, sections and recording passes, then one measure lane: the measure ruler on top and, for audio songs, the waveform with sync point lines and the time ruler below (MIDI songs: the ruler alone).

- **One axis:** `useTimelineAxis` owns zoom and scroll for lanes, waveform, the single playhead element and `TimelineScrollbar`. Scale is whole units (samples or ticks) per pixel, offset whole pixels, matching how peaks.js draws and scrolls, so everything lines up on the same pixel. Ctrl or pinch wheel zooms around the pointer, sideways or shift wheel scrolls, and a playhead that leaves the view is scrolled back in (except while scrubbing).
- **peaks.js only draws** the waveform: no axis, points or playhead, no pointer events, no own scrolling or zooming. Rulers, sync point lines and the playhead are HTML on the shared axis. The scrollbar is our own, since a native one cannot be as wide as a song zoomed to single samples.
- **One pointer handler** on the axis (`usePointerSwipe`; peaks.js has no drag-to-seek and its drag scrolls): a drag starting on a sync point moves it (hit-tested by distance, saved on release through `useSyncEditor`), any other drag scrubs, and the click ending a drag is swallowed. A plain click selects a sync point under it or seeks; lane items handle their own clicks.
- **Lanes** are `TimelineLaneItem` lists of one height. Each renders only items in view (`axis.toBlock()` returns nothing outside), cut to the visible part so text stays readable.
- **Rulers** (`TimelineRuler`, steps in `rulerTicks.ts`) label every n-th tick so labels keep a minimum spacing, like the time ruler. The measure ruler takes its step from the median measure width of the whole song and counts by timeline position, so labels stay put while scrolling and follow the played order. Its measure cells are label-less `TimelineLaneItem` buttons under the ticks.
- **Section handles:** the selected section gets handles at both ends of its own range in the Sections lane (`TimelineSectionRange`), the score's `SectionRangeHandle` sliders driven by the same `useSectionRange()` (names, keys, validation, saving shared). Drags snap to the nearest measure boundary in playing order, so a handle reaches any pass; the moved section is shaded with its recorded passes until dropped. Handles stop the pointer event, so they never scrub.
- **Guessed passes:** in audio songs a pass that plays measures again without a sync point at its start (`findUnsyncedRepeatPasses()`) gets an attention icon in the Recording lane, and once synced the setup overview names them in a hint whose button selects the first such pass. It never blocks "ready".

### Score Gestures and Drawing

- `usePanZoom` pans and zooms the score's page transform with one set of pointer, touch and wheel listeners. It stays hand-written: the score is a canvas transform, not a scrolled element, and vueuse has no pinch. Handles (`BoxResizeHandle`, `SectionRangeHandle`) and drawing use `usePointerSwipe` and stop the event so the score does not pan.
- No toolbar. A drag pans (even from a box), a click selects, ctrl/cmd-click toggles, shift-click selects the range in reading order, a click on empty space or Escape clears. A drag never clears (`usePanZoom` swallows its click). Touch long-press starts multi-select. Ctrl/cmd+A, and "Select all" on touch devices, select all measures. Middle button, wheel and pinch always pan or zoom. Resize handles appear on a single selected measure.
- Drawing starts from "Add measures" or "Place" and ends with "Done", Escape or any selection. A layer over the score turns drags into boxes (`usePointerSwipe`) and the inspector asks what each holds; drawing continues so numbering carries on. Audio songs without a score add measures by number.
- `useMeasureEditor` leaves the planning form before saving (`placePendingBox()`, `resolveReview()`) and restores it if the save fails; a form that stayed mounted would replan against its own result and flash a conflict.
- All box work happens in the inspector; the score only selects and draws.

### Detection Review

- While a result exists, the score shows dashed boxes (`warn` when unsure, `danger` with "?" without a number), dims existing boxes and is not editable until applied or discarded. Applied leftovers stay marked the same way.
- Boxes without a number are their own selection kind: one is numbered or removed, several only removed.
- The review bar steps through leftovers in reading order. Without a focused field, Enter confirms, typing corrects the number, Delete removes. Review buttons release focus after a click, or Enter would hit them again.

## Layout Across Screen Sizes

- **Panels:** from `lg`, side panels sit next to the score and the timeline collapses to its header (`workspace.panelVisible.timeline`). Below `lg` one panel shows at a time behind tabs ("Markers", "Score", "Timeline", "Mixer"; a new panel needs a tab). Panels and the timeline share a grid cell and both name `row-start-3 col-start-1`, since auto-placement would add implicit rows or columns.
- **Bottom sheet:** below `lg` the inspector is a sheet over at most half the score, collapsed to its title row until tapped, selected or drawing. It is one instance moved by CSS (inputs never exist twice). Its height reaches the score as `coveredBottom`, so the last clicked box moves above the sheet when it grows.
- **Header:** below `lg` the breadcrumb shares row one with the account, transport and playback controls take row two. Playback controls never collapse into a menu: they scroll sideways with faded edges, so the account stays visible. Below `sm` (viewport breakpoint only) "Edit" is an icon-only round button like the logo and the show crumb shrinks to "..." while a song is shown. Crumbs truncate, never wrap. Start and end buttons share `BAR_GAP`; never add own margins.
- The header shows the same information in both modes; only the time signature reads "-/-" for audio (measures store beats, no beat unit). The section button shows the pass of a playing vamp, repeat section or written repeat (a recorded repeat outside any vamp or repeat section, labelled "Repeat"); it is enabled during all of them but only releases or resets a vamp (primary while it loops), and otherwise reads "Vamp", disabled. The score never shows playhead-dependent passes; the header is their only home.
- `App.vue` cancels browser page zoom on ctrl/cmd+wheel and pinch with one `window` listener; the score and timeline handle these on their own element first.
- Collapsible panels use `base/CollapsiblePanel` (never restyle one by hand). PrimeVue `Panel` content sits in an `auto` grid column, so panels that must shrink set `pt:content-wrapper="min-w-0"`.
