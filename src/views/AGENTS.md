# Views — Agent Guide

Extends the root `AGENTS.md`, whose rules and UI design principles apply here too. Keep this file current under the rules in its "Agent Guides" section.

## Navigation Model

Every page starts with `HeaderBar`. Its start holds `ShowBreadcrumb`, modelled on GitHub's `owner / repo` header:

```
[logo] / Show title / #3 Song v   [Edit]     |<< > >|   measure  tempo  vamp ...  (account)
```

- The logo leads home. The show leads to the show page for editors and to the first song for viewers, who have no show page.
- The song is a picker. Choosing a song replaces the route and keeps the page, so the player stays the player and the editor stays the editor.
- Crumbs are text buttons: muted unless they are the last one, with the button underlay only on hover. They use the default button size, so they line up with the Tempo and Vamp buttons.
- "Edit" toggles a song between player and editor with `router.replace`, so both share one history entry and the browser back button leaves them together. It is only shown to editors.
- Pages without playback (home, show page, not found) leave out `playback`. The transport controls then disappear and "Choir Chaos" is centered in the bar instead.
- The account menu (`UserMenuButton`) only holds preferences and signing out. Signed-out visitors also get a "Sign in" button there.

| Page | Route | Who | Owns |
|---|---|---|---|
| `HomeView` | `home` `/` | everyone | Picking a show, creating a show |
| `ShowEditView` | `show-edit` `/show/:showId/edit` | editors | Show title, cover, sharing, deletion, the song list, adding and importing songs |
| `WorkspaceView` | `show`, `song` `/show/:showId/song/:songId` | everyone | Rehearsing: transport, mixer, markers, score |
| `WorkspaceView` | `song-edit` `/show/:showId/song/:songId/edit` | editors | Per-song work: details (number, title, files, tracks), markers, measures and their boxes on the score, audio sync, deleting the song |
| `NewSongDialog` | dialog | editors | Creating a song from the show page |

- A show card leads editors to the show page and viewers to the player.
- The song editor is the player with editing turned on, so the same `WorkspaceView` serves both routes. Whether it edits comes from the route name, never from local state. Viewers who open an edit URL are sent to the player by the router guard.
- Song rows on the show page open the song in the player. The setup status button opens the song editor on the Details tab for missing files and on the Measures tab otherwise. The row's overflow menu holds "Edit" and "Delete song".
- New songs are only created on the show page ("New song..." or importing files). The player and editor do not create songs. `NewSongDialog` and the editor's Details tab share `SongDetailsForm`, so both edit the same fields.
- The player shows the Markers panel only when the song has markers, since rehearsers cannot add any. In the song editor the same place holds the editor panel with the tabs Details, Markers and Measures (in that order). The tab is a persisted setting (`workspace.editorTab`), so other places point at a step by setting it, as "Add playback..." in the mixer does. Selecting or drawing on the score, the Draw tool and detection switch to Measures.
- The Details tab keeps a draft and saves with "Save", because saving uploads files. "Revert" drops the draft, switching songs drops it too. Markers save on Enter or blur, since they are a single field each.
- All measure work happens in the Measures tab. The score only selects and draws: a Select | Draw switch sits on it, boxes show their number as a corner chip, and resize handles appear on a single selected box only. Mouse: click selects, shift-click selects a range in reading order, ctrl/cmd-click toggles, dragging on empty page space draws a marquee, and the middle button or the wheel pans. Touch: tap selects, long-press starts multi-select after which taps toggle, and dragging pans except with the Draw tool.
- The panel shows what is not placed when nothing is selected, the selection's properties otherwise, and asks what a newly drawn box holds. Nothing about measures opens a popover on the score.
- "Detect..." runs detection inside the panel. While its result exists, the score shows it as dashed boxes (amber when unsure, red with "?" without a number), the existing boxes are dimmed and the score cannot be edited until the result is applied or discarded.
- Applied leftovers stay marked: amber boxes for measures to check and red "?" boxes without a number, which are selectable like measures. The panel's review bar steps through them in reading order. Without a focused field, Enter confirms the current one, typing a letter or digit starts correcting its number, and Delete removes the selected boxes. The review buttons release the focus after a click, otherwise Enter would activate whatever button kept it (such as the Edit toggle).
- The Details tab is the only place to edit an existing song's details. Empty states and setup hints elsewhere name the missing step ("Add playback...") and open that tab. A MIDI track's title links it to its MIDI data by name, so MIDI tracks cannot be renamed.

## Layout Across Screen Sizes

- `WorkspaceView` shows its side panels next to the score from `lg` up. Below `lg` it shows one panel at a time behind a tab bar. Any new panel needs a tab there too, except the song editor's panel: below `lg` it is a bottom sheet over the score, collapsed to its tab strip until a tab is tapped or something is selected or drawn. It is a single instance moved by CSS, so its inputs never exist twice in the DOM. All three tabs stay mounted (PrimeVue `TabPanel` only hides inactive ones), so a Details draft survives switching tabs.
- Below `lg` the breadcrumb row spans the full width and the transport wraps onto a second row. From `lg` up all three share one row. Wherever the row is tight, "Edit" drops its label so the breadcrumb keeps its room, and the crumbs truncate instead of wrapping.
- Spacing between the buttons in the start and end of the bar is the same responsive gap, so new buttons there must not add their own margins.
