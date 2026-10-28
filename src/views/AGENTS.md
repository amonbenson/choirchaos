# Views — Agent Guide

Extends the root `AGENTS.md`.

## Routing

- `WorkspaceView` serves both the player (`song`) and the editor (`song-edit`) and decides from the route name, never local state. "Edit" toggles between them with `router.replace`, so both share one history entry. The guard sends viewers from edit URLs to the player and editors of an empty show to `show-edit`.
- Every page of a show reads it from `stores/show`, which keeps one instance while the route stays in the show. Never fetch it per view, or the header loses it on every switch.
- `WorkspaceView` unloads the global player on unmount.

## Song Editor

Score and timeline are the canvases; the inspector (`SongEditorPanel`, `components/editor/inspector/`) shows one panel per selection kind. Each panel exposes `remove()` for the Delete key.

- **Selection** (`core/models/selection.ts`, shared through `useEditorSelection`) holds IDs and locations, and `resolveSelection()` looks objects up after every save: vanished objects (undo, delete) resolve to nothing, and edits that change identity (renaming a marker, moving a section start) must reselect.
- **Passes:** measures are edited in the pass at or nearest the playhead, so selecting also seeks (`selectAndSeek()`). The timeline never selects measures; its cells only seek.
- **Saving:** `useMeasureEditor` takes down the planning form before saving (`placePendingBox()`, `resolveReview()`) and restores it if the save fails; a form that stayed mounted would replan against its own result and flash a conflict.
- **Recording changes** go through `useRecordingEditor` (previews and asks only when references would be dropped), sync point drags through `useSyncEditor`, section range handles on score and timeline through `useSectionRange()`.
- **Duplicate boxes** only migrate old songs that faked repeats with extra measures. All of it is `duplicateMigration.ts`, `DuplicateReviewCard.vue` (plus tests) and one line in `SetupOverview.vue`, so removal means deleting those.
- Keyboard shortcuts (undo, delete, review) only act without a focused text field, which keeps its own undo. Buttons that a keypress could repeat release focus after a click.

### Timeline

- `useTimelineAxis` owns zoom and scroll for every lane, the waveform, the playhead and `TimelineScrollbar`. Scale is whole units (samples or ticks) per pixel and offset whole pixels, matching how peaks.js draws, so everything lines up on the same pixel. Zoom steps follow `ZoomLadder` levels only, since peaks.js caches every resampled level.
- peaks.js only draws the waveform: no axis, points, playhead, pointer events, scrolling or zooming of its own. Rulers, sync point lines and the playhead are HTML on the shared axis. The scrollbar is our own, since a native one cannot be as wide as a song zoomed to single samples.
- peaks.js cannot start in a hidden container (an unshown phone tab), so `WaveformView` builds it once the container has a size. Its times are seconds, ours milliseconds.
- One pointer handler on the axis (`usePointerSwipe`): a drag on a sync point moves it, any other drag scrubs, and the click ending a drag is swallowed. Lanes render only items in view (`axis.toBlock()`).

### Score

- `usePanZoom` stays hand-written: the score is a canvas transform, not a scrolled element, and vueuse has no pinch. A drag pans (even from a box), a click selects; `usePanZoom` swallows the click ending a drag. Handles and drawing use `usePointerSwipe` and stop the event so the score does not pan.
- Shift-drag draws a marquee (`useMarqueeSelection`); the pointer is captured only once it moves, so shift-click still selects a range.
- All box work happens in the inspector; the score only selects and draws.

### Cursors

Elements set only their hover cursor. While a gesture runs or a held key changes what a press does, the canvas sets `data-cursor-lock` (rules in `main.css`), which forces that cursor over everything inside so it never flickers during drags. Elements marked `data-handle` keep their own.

## Layout

- Below `lg` one panel shows at a time behind tabs (a new panel needs a tab); hidden tabs stay mounted. From `lg`, panels sit beside the score.
- Panels and the timeline share a grid cell and both name `row-start-3 col-start-1`, since auto-placement would add implicit rows or columns.
- Below `lg` the inspector is a bottom sheet: one instance moved by CSS (inputs never exist twice). Its height reaches the score as `coveredBottom`.
- Header playback controls never collapse into a menu; they scroll sideways so the account stays visible.
- `App.vue` cancels browser page zoom on ctrl/cmd+wheel and pinch; score and timeline handle these on their own element first.
- PrimeVue `Panel` content sits in an `auto` grid column: panels that must shrink set `pt:content-wrapper="min-w-0"`.
