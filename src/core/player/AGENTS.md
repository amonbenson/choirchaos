# Player — Agent Guide

Extends the root `AGENTS.md`, whose rules apply here too. Keep this file current under the rules in its "Agent Guides" section.

Playback engine shared by both modes:
- **MIDI:** `.mid` plus an MTIMidiJson `.json` that maps ticks to measures and beats.
- **Audio:** one `.mp3`/`.wav` per track, pitch- and tempo-shifted with `rubberband-web`.

## Files

| File | Role |
|---|---|
| `engine.ts` | `PlayerEngine`: transport, seeking, vamps, segues, display state |
| `backend.ts` | Abstract backend interface |
| `midi/backend.ts` | `MidiBackend`: schedules notes through `webaudiofont` |
| `audio/backend.ts` | `AudioBackend`: decodes files, builds warp events, mutes vocals |
| `audio/driver.ts` | `AudioDriver`: Web Audio graph, chunk scheduling, crossfade seeks |
| `audio/chunkDetector.ts` | `detectChunks()` strips silence, `AudioChunk` type |
| `../midi/warp.ts` | `WarpMap`: tick to time mapping |
| `src/stores/player.ts` | Pinia wrapper. Exposes engine state through `useEvent()`. `loading`/`ready` are plain `computed()` from `status` |
| `audio/mixdown.ts` | Sums all track chunks into one mono buffer for the warp panel waveform |

## Engine Invariants

- `unload()` resets all `current*` Properties, `vamps`, and `mode`. Do not rely on `load()` to clear stale state.
- In `syncStateAt`, call `backend.seek(pos)` BEFORE `backend.onTempoRestored(bpm)`.
- `syncWarp()` (audio mode) re-resolves warp and vamp ticks and resyncs display Properties. It does NOT touch `currentSegue` and does NOT seek the backend.
- End-of-song fires in the same step as the overshoot (`pos >= duration`).
- `MeasureReference` is `[MeasureNumber, BeatNumber]`. `BeatNumber` is 0-based.
- `Measure.$beatTicks` and `$tickLength` are populated by `AudioBackend.buildWarpEvents()`. Code that reads them before that sees `undefined`.

## WarpMap vs SongWarpMarker

- `WarpMap` takes integer array indices.
- `SongWarpMarker` (`models/song.ts`) stores `{ measure: Numbering, time: number }`, which stays stable when measures are reordered.
- `AudioBackend` converts markers to indices with `findIndex`. Markers whose measure no longer exists are silently dropped.
- `Song.deserialize()` migrates legacy integer-index markers to Numbering strings.

## Warp Editing

- The warp panel draws `mixdownChunks()` of the decoded chunks with peaks.js through `WaveformView`. Audio mode positions are milliseconds, peaks.js works in seconds.
- `warpEditing.ts` keeps markers in measure order: new markers only go to measures between the neighbouring markers, and dragging is clamped between them. The backend invariant requires strictly increasing marker times.
- peaks.js resamples every zoom level from the closest finer level it has cached. Zoom only moves along `ZoomLadder` levels, so the cache stays bounded. The base waveform is built at one sample per pixel (coarser only for very long recordings), which is what allows zooming to single samples.

## Vamps

- `exitVamp()`, `resetVamp()`, `toggleVamp()` manipulate `manualExit`/`currentIteration` on the current vamp.
- `setVampsEnabled(enabled)` is a global toggle. Disabling force-exits an active vamp and makes `vampAt()` return `undefined`.
- `VampOut` and `VampVocals` are defined in `src/core/models/measureEvent.ts` and re-exported from `types.ts`.
- `VampPhase` (`"entering" | "repeating" | "exiting"`) is internal to `PlayerEngine`. The 4th argument to `backend.step()` is `muteVocals`, derived from the current phase and the vamp's vocals setting. `AudioBackend` mutes Vocal tracks when it is true.

## Audio

- `AudioDriver` takes `AudioChunk[][]`: one array of mono chunks per track. `sampleOffset` is the chunk's start in the original file, in samples.
- `scheduleSeek()` is a crossfade seek, used for vamp jumps. `seek()` is a hard cut, used only for initial seeks.
- `AUDIO_LOOKAHEAD` in `audio/driver.ts` must equal `AUDIO_CLOCK_OFFSET` in `midi/backend.ts`. The visual position leads audio by this margin in both modes.
- Decoding is memory-bounded for mobile: files are decoded in parallel only while the in-flight bytes stay under `MAX_CONCURRENT_DECODE_BYTES`. Do not replace this with an unbounded `Promise.all`.

## Testing

Fixture tick layout (120 BPM, ppqn 480), exported as `TICKS`:

```
Measure "0" (pickup, 1 beat): tick    0
Measure "1" (4/4):            tick  480
Measure "2" (4/4):            tick 2400
Measure "3" (4/4, 140 BPM):   tick 4320
Measure "4" (4/4):            tick 6240
Measure "5" (terminal):       tick 8160 = duration
```

- Use `stepPast(updater, player, tick)` to play past a tick. It adds the extra step needed for end-of-song and segue to fire.
- Use `stepUntil(updater, () => condition)` for state-based waits. `getCurrentVamp()` is `undefined` until the playhead enters the vamp region, so wait for entry before waiting for exit.

**Audio mode tests** (`engine.audio.test.ts`) mock `AudioDriver` entirely:
- The mock must include `scheduleSeek`, since vamp jumps call it instead of `seek`.
- Keep the position in sync: `ap.scheduleSeek.mockImplementation(pos => ap.getPosition.mockReturnValue(pos))`.
- Clear `seek`/`scheduleSeek` after `load()`. The initial seek to 0 pollutes call counts.
- Entering a vamp takes two steps: one to enter the region, one to hit the end and trigger the jump.
- Fixtures: `makeAudioSong()`, `makeAudioSongWithVamp()`, `makeAudioSongWithVocalVamp(vocals?)`, `makeAudioSongWithVampOut(out)`. Vamp fixtures use markers `[{measure:"1", time:0}, {measure:"3", time:0.5}]` (0.25 s per measure).

**Silent failure traps:**
- `setSegueEnabled()` does nothing if `load()` never ran, because the segue was never initialized.
- JSON mocks without `$beatTicks` silently break vamp and duration logic.
- `setGain(1, 0)` means the vocal track is muted. Clear the spy before the step you assert on.
