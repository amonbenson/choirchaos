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
| `WorkspaceView` | `song-edit` `/show/:showId/song/:songId/edit` | editors | Song details, markers, measures, audio sync, deleting the song |

- `WorkspaceView` decides whether it edits from the route name, never from local state. The router guard sends viewers who open an edit URL to the player.
- Songs are only created on the show page (`NewSongDialog` or importing files). `NewSongDialog` and the editor's Details tab share `SongDetailsForm`.
- Song rows open the player. Their setup status button opens the editor on the Details tab for missing files and on the Measures tab otherwise.

## Song Editor

- The player shows the Markers panel only when the song has markers. The editor puts its panel there, with the tabs Details, Markers and Measures. The tab is a persisted setting (`workspace.editorTab`), so other places point at a step by setting it. Selecting or drawing on the score, the Draw tool and detection switch to Measures.
- The Details tab keeps a draft and saves with "Save", because saving uploads files. "Revert" or switching songs drops the draft. Markers save on Enter or blur.
- All measure work happens in the Measures tab. The score only selects and draws, never opens a popover. Mouse: click selects, shift-click selects a range, ctrl/cmd-click toggles, dragging on empty space draws a marquee, middle button or wheel pans. Touch: tap selects, long-press starts multi-select, dragging pans except with the Draw tool. Resize handles appear on a single selected box only.
- The panel shows what is not placed when nothing is selected, the selection's properties otherwise, and asks what a newly drawn box holds.
- While a detection result exists, the score shows it as dashed boxes (amber when unsure, red "?" without a number), dims existing boxes and cannot be edited until the result is applied or discarded.
- Applied leftovers stay marked the same way, and red "?" boxes are selectable like measures. The review bar steps through them in reading order. Without a focused field, Enter confirms, typing starts correcting the number and Delete removes the selection. The review buttons release focus after a click, otherwise Enter would activate whatever button kept it.

## Layout Across Screen Sizes

- From `lg` up, `WorkspaceView` shows its side panels next to the score. Below `lg` it shows one panel at a time behind a tab bar, so any new panel needs a tab there too.
- Below `lg` the song editor's panel is a bottom sheet over the score, collapsed to its tab strip until a tab is tapped or something is selected or drawn. It is a single instance moved by CSS, so its inputs never exist twice in the DOM. All tabs stay mounted, so a Details draft survives switching tabs.
- Below `lg` the breadcrumb spans the full width and the transport wraps onto a second row. Where the row is tight, "Edit" drops its label and the crumbs truncate instead of wrapping.
- The buttons in the start and end of the bar share one responsive gap, so new buttons there must not add their own margins.
