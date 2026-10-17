# Views — Agent Guide

Extends the root `AGENTS.md`, whose rules and UI design principles apply here too. Keep this file current under the rules in its "Agent Guides" section.

## Navigation Map

```
Viewer:  Home --card--> Player
Editor:  Home --card--> Show page --song row--> Song editor <--"Edit song" / "Done"--> Player
                           ^                                                        |
                           +------------------------ back arrow --------------------+
```

| Page | Route | Who | Owns |
|---|---|---|---|
| `HomeView` | `home` `/` | everyone | Picking a show, creating a show |
| `ShowEditView` | `show-edit` `/show/:showId/edit` | editors | Show title, cover, sharing, deletion, the song list, adding and importing songs |
| `WorkspaceView` | `show`, `song` `/show/:showId/song/:songId` | everyone | Rehearsing: transport, mixer, markers, score |
| `WorkspaceView` | `song-edit` `/show/:showId/song/:songId/edit` | editors | Per-song work: measures, their boxes on the score, audio sync |
| `SongDetailsDialog` | dialog | editors | Song number, title, score, playback files and tracks |

- A show card leads editors to the show page and viewers to the player. The show page is the editors' hub for a show.
- The song editor is the player with editing turned on, so the same `WorkspaceView` serves both routes. Whether it edits comes from the route name, never from local state. Viewers who open an edit URL are sent to the player.
- "Edit song" in the player replaces the history entry, so player and editor share one entry and the browser back button goes up to the page before them. "Done" goes back when the editor was opened from the show page and otherwise replaces the editor with the player.
- The player's back arrow goes to the show page for editors and home for viewers.
- Switching songs inside the player or editor replaces the route and keeps the page (player stays player, editor stays editor).
- Song rows on the show page navigate to the song editor. Their overflow menu holds "Rehearse", "Details..." and "Delete song". The setup status button opens the details dialog for missing files and the song editor otherwise.
- New songs are only created on the show page ("New song..." or importing files). The player and editor do not create songs.
- `SongDetailsDialog` is the same dialog everywhere it opens. Plain entries are labelled "Details...", empty states and setup hints name the missing step ("Add playback..."). It is never split into panels on other pages. A MIDI track's title links it to its MIDI data by name, so MIDI tracks cannot be renamed.

## Layout Across Screen Sizes

- `WorkspaceView` shows its side panels next to the score from `lg` up. Below `lg` it shows one panel at a time behind a tab bar. Any new panel needs a tab there too.
- The top bar wraps onto two rows below `lg`. Keep the song picker and the navigation buttons (back, "Edit song", "Done", "Details...") in its first row so they are always reachable on phones.
