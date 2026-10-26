# Views — Agent Guide

Extends the root `AGENTS.md`, whose rules and UI design principles apply here too.

## Navigation Model

Every page starts with `HeaderBar`. Its start holds `ShowBreadcrumb`, modelled on GitHub's `owner / repo` header:

```
[logo] / Show title / #3 Song v   [Edit]     |<< > >|   measure  tempo  vamp ...  (account)
```

- The show crumb leads editors to the show page and viewers, who have no show page, to the first song. Show cards do the same.
- The song crumb is a picker. It replaces the route and keeps the page, so the player stays the player and the editor stays the editor.
- "Edit" is shown to editors only and switches between player and editor with `router.replace`, so both share one history entry.
- Pages without playback leave out `playback`. The transport then disappears and "Choir Chaos" is centered in the bar instead.

| Page | Route | Who | Owns |
|---|---|---|---|
| `HomeView` | `home` `/` | everyone | Picking and creating shows |
| `ShowEditView` | `show-edit` `/show/:showId/edit` | editors | Show title, cover, sharing, deletion, the song list, creating and importing songs |
| `WorkspaceView` | `show`, `song` `/show/:showId/song/:songId` | everyone | Rehearsing: transport, mixer, markers, score |
| `WorkspaceView` | `song-edit` `/show/:showId/song/:songId/edit` | editors | The inspector (sections, markers, measures), song details, audio sync, deleting the song |

- Both views and the router guard get the show from `stores/show`, which keeps one instance while the route stays in that show and drops it when the route leaves. Never fetch the show per view, or the header loses it on every switch between the show page and a song.
- `WorkspaceView` decides whether it edits from the route name, never from local state. The router guard sends viewers who open an edit URL to the player.
- Songs are only created on the show page (`NewSongDialog` or importing files). `NewSongDialog` and the editor's `SongDetailsDialog` share `SongDetailsForm`.
- Song rows open the player. Their setup status button opens the editor, with the details dialog open (`?details=1`) for missing files.

## Song Editor

- The player shows the Markers panel only when the song has markers. The editor puts the inspector (`SongEditorPanel`, files in `editor/inspector/`) there. It shows the selection's properties in collapsible groups (Rehearsal, Marker, Recording, Box(es)), and with nothing selected the setup checklist, setup hints, the duplicate-box proposals, the review queue, "Not on the score", Add/Detect and the recording list. Groups remember being collapsed in `workspace.inspectorCollapsed`, and keep their content mounted, so keys on the score still reach the box forms.
- The selection holds measure IDs only. `useMeasureEditor` derives the selected run, the stretch of the recording that plays exactly the selected measures, at or nearest to the playhead, so the playhead decides the occurrence. A click on a box seeks to its nearest occurrence, and the inspector's "Time" chips seek to another one. A selection that never plays back to back only has the Boxes group.
- Sections are measure-level: the Rehearsal group (As recorded / Repeat / Vamp / Cut, passes, until released, how a vamp goes on, vocals) edits the section that holds the whole run, saves it over whole measures (`withRun()`) and calls `syncWarp()`. A change that `validateSections()` rejects is not saved, and the reason is shown. A run that only overlaps sections names them and offers "Replace" after a kind is picked. "As recorded" removes the section. The section the inspector edits gets range handles on the score: sliders that move its first or last measure by one with the arrow keys, or snap to the box they are dropped on.
- The recording is edited in three places, all saved through `useRecordingEditor`: the Recording group ("Recorded N times" on the run, and the jump picker after its last occurrence), "Edit as text" under the recording list, and the duplicate-box proposals. Each previews the new length and the references it would drop, asks for confirmation only when something would be dropped, and reloads the player afterwards, since the timeline changed. MIDI recordings come from the beat map and are shown read-only.
- Duplicate boxes (`findDuplicateRuns()`) are proposed as another pass of the measures they lie on, but never block "ready": the stored song has no place for "keep separate", so that choice lives in `sessionStorage` until the tab closes.
- Markers go on beat 1 of the run's first occurrence. Song details are a dialog (`?details=1` in the URL), opened by "Details" next to Edit. It keeps a draft and saves with "Save", because saving uploads files, and "Cancel" drops the draft.
- All box work happens in the inspector. The score only selects and draws, never opens a popover. Its tools decide what a drag does, for mouse and touch alike: Select draws a marquee that may start beside the pages and reaches across them (with ctrl/cmd it adds to the selection), Move pans like the player, Draw adds a box. Move is the default, and holding Shift switches to Select while it is held, so the toolbar and cursor always show the active tool. With Select and Move, click selects, shift-click selects a range, ctrl/cmd-click toggles, a click on empty space or Escape clears the selection and touch long-press starts multi-select. Ctrl/cmd+A selects every box, and so does "Select all", which only touch devices show since they have no shortcut. The middle button, the wheel and pinching pan or zoom with every tool. Resize handles appear on a single selected box only, so multi-select ends once one box or none is left.
- While editing, the score's overlay takes every press and tracks it as one gesture with the tool it started with. Drags capture the pointer only once they move (here and in `usePanZoom`), because an earlier capture retargets the click of a tap away from the box under it.
- The inspector asks what a newly drawn box holds.
- While a detection result exists, the score shows it as dashed boxes (amber when unsure, red "?" without a number), dims existing boxes and cannot be edited until the result is applied or discarded.
- Applied leftovers stay marked the same way, and red "?" boxes are selectable like measures. A selection that holds them together with other boxes can only be removed, since they are numbered one at a time. The review bar steps through them in reading order. Without a focused field, Enter confirms, typing starts correcting the number and Delete removes the selection. The review buttons release focus after a click, otherwise Enter would activate whatever button kept it.

## Layout Across Screen Sizes

- From `lg` up, `WorkspaceView` shows its side panels next to the score. Below `lg` it shows one panel at a time behind a tab bar, so any new panel needs a tab there too.
- Below `lg` the inspector is a bottom sheet over the score, collapsed to its title row until it is tapped or something is selected or drawn. It is a single instance moved by CSS, so its inputs never exist twice in the DOM.
- Below `lg` the breadcrumb spans the full width and the transport wraps onto a second row. Where the row is tight, "Edit" drops its label and the crumbs truncate instead of wrapping. Below `sm` the show crumb shrinks to "..." while a song is shown, because the song title matters most.
- The score's tool switcher keys its labels to the score's own width (a container query), since open side panels can make the score narrow on any screen.
- PrimeVue's `Panel` lays out its content in a grid with an `auto` column, so a panel never gets narrower than its content's min-content width (nowrap and truncated text included). Panels that must shrink set `pt:content-wrapper="min-w-0"`.
- The audio sync panel collapses to its header (`workspace.panelVisible.warp`) to leave room for the score.
- Both collapsible panels are built on `base/CollapsiblePanel`, so their border, corners and chevron stay identical. Do not restyle one of them by hand.
- The buttons in the start and end of the bar share one responsive gap, so new buttons there must not add their own margins.
