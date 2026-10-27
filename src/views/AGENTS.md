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

- The selection holds measure IDs only. `useMeasureEditor` derives the selected run: the stretch of the recording that plays exactly the selected measures, at or nearest to the playhead, so the playhead decides the occurrence. A selection that never plays back to back only gets the Boxes group.
- A click on a box seeks to its nearest occurrence and selects it. The inspector's "Time" chips seek to another occurrence. A click in the timeline selects the measures it shows (when they have boxes) and seeks there.

### Inspector

- With a selection, the inspector shows its properties in collapsible groups: Rehearsal, Marker, Recording, Audio sync (audio songs) and Box(es). Groups remember being collapsed in `workspace.inspectorCollapsed` and keep their content mounted, so keys on the score still reach the box forms.
- With nothing selected, it shows the setup checklist, setup hints, the duplicate-box proposals, the review queue, "Not on the score", Add and Detect, and the recording list.
- **Rehearsal** edits the section that holds the whole run: As recorded / Repeat / Vamp / Cut, passes, until released, how a vamp goes on, and vocals. Sections are measure-level and saved over whole measures (`withRun()`), followed by `syncWarp()`. A change that `validateSections()` rejects is not saved, and the reason is shown. A run that only overlaps sections names them and offers "Replace" once a kind is picked. "As recorded" removes the section after a confirmation. The edited section gets range handles on the score: sliders that move its first or last measure by one with the arrow keys, or snap to the box they are dropped on.
- **Marker** adds and edits the marker on beat 1 of the run's first occurrence.
- **Recording** sets "Recorded N times" on the run and the jump after its last occurrence. The recording is also edited through "Edit as text" under the recording list, the timeline's pass menus and the duplicate-box proposals. All of them save through `useRecordingEditor`, which previews the new length and the references a change would drop, asks for confirmation only when something would be dropped, and reloads the player afterwards, since the timeline changed. MIDI recordings come from the beat map and are shown read-only.
- **Duplicate boxes** (`findDuplicateRuns()`) are proposed as another pass of the measures they lie on, but never block "ready": the stored song has no place for "keep separate", so that choice lives in `sessionStorage` until the browser tab closes.
- **Audio sync** edits the sync point of the run's first occurrence: its start time (typed, or nudged with buttons or the up and down arrow keys, the keyboard alternative to dragging), "Sync to playhead", "Move to another measure" (keeps the time) and remove (confirmed). Sync points can only sit between their neighbours, so these controls are disabled or clamp otherwise. The sync status names passes without a sync point and stretches of more than `MAX_MEASURES_PER_SYNC_POINT` measures between them. In edit mode the score shows a pin under every synced box.

### Timeline

`editor/warp/TimelinePanel` shows the song in played order: lanes for markers, sections, recorded passes and played measures and, for audio songs, the waveform with its sync points. With a waveform the lanes follow its zoom and scroll, without one they scroll on their own. Each editable pass has a menu (move earlier or later, remove), and MIDI passes are read-only.

### Boxes and Tools

- All box work happens in the inspector. The score only selects and draws, never opens a popover. The inspector asks what a newly drawn box holds.
- The score's tools decide what a drag does, for mouse and touch alike: Select draws a marquee that may start beside the pages and reaches across them (ctrl/cmd adds to the selection), Move pans like the player, Draw adds a box. Move is the default, and holding Shift switches to Select while held, so the toolbar and cursor always show the active tool.
- With Select and Move: click selects, shift-click selects a range, ctrl/cmd-click toggles, and a click on empty space or Escape clears the selection. Touch long-press starts multi-select. Ctrl/cmd+A and "Select all" (touch devices only, since they have no shortcut) select every box. The middle button, the wheel and pinching pan or zoom with every tool. Resize handles appear on a single selected box only.
- While editing, the score's overlay takes every press and tracks it as one gesture with the tool it started with. Drags capture the pointer only once they move (here and in `usePanZoom`), because an earlier capture retargets the click of a tap away from the box under it.

### Detection Review

- While a detection result exists, the score shows it as dashed boxes (amber when unsure, red "?" without a number), dims existing boxes and cannot be edited until the result is applied or discarded.
- Applied leftovers stay marked the same way, and red "?" boxes are selectable like measures. A selection that holds them together with other boxes can only be removed, since they are numbered one at a time.
- The review bar steps through leftovers in reading order. Without a focused field, Enter confirms, typing starts correcting the number and Delete removes the selection. The review buttons release focus after a click, otherwise Enter would activate whatever button kept it.

## Layout Across Screen Sizes

- **Panels:** from `lg` up, `WorkspaceView` shows its side panels next to the score, and the timeline collapses to its header (`workspace.panelVisible.warp`). Below `lg` it shows one panel at a time behind a tab bar, so a new panel needs a tab there too. The timeline is then the "Timeline" tab and shares the panels' grid cell, so both name `row-start-3 col-start-1` explicitly: auto-placement would push one of them into an implicit row or column.
- **Bottom sheet:** below `lg` the inspector is a bottom sheet over at most half the score, collapsed to its title row until it is tapped or something is selected or drawn. It is a single instance moved by CSS, so its inputs never exist twice in the DOM. `WorkspaceView` passes its height to the score as `coveredBottom`, and the score counts that strip and the strip under its tool switcher as hidden, so it moves the box clicked last above the sheet whenever the sheet grows.
- **Header:** below `lg` the breadcrumb shares the first row with the account, and the transport and playback controls take the second. The playback controls never collapse into a menu: they scroll sideways in their own cell, and its edges fade where more controls lie outside, so the account always stays in the bar. Below `sm` "Edit" is an icon-only round button like the logo, decided by that viewport breakpoint alone, and the show crumb shrinks to "..." while a song is shown. The crumbs truncate instead of wrapping. The buttons at the start and end of the bar share one responsive gap (`BAR_GAP`), so new buttons there must not add their own margins.
- The header shows the same playback information in both modes. Only the time signature reads "-/-" for audio songs, since measures store beats but no beat unit. The section button shows a playing repeat's pass and is disabled then, releases or resets a playing vamp, and otherwise reads "Vamp", disabled.
- `App.vue` cancels the browser's page zoom on ctrl/cmd+wheel and trackpad pinch with one `window` listener. Components that zoom on these gestures (score, timeline) handle them on their own element first.
- The score's tool switcher keys its labels to the score's own width (a container query), since open side panels can make the score narrow on any screen.
- Both collapsible panels are built on `base/CollapsiblePanel`, so their border, corners and chevron stay identical. Do not restyle one by hand. PrimeVue's `Panel` lays out its content in a grid with an `auto` column, so a panel never gets narrower than its content's min-content width. Panels that must shrink set `pt:content-wrapper="min-w-0"`.
