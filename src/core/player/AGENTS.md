# Player — Agent Guide

Extends the root `AGENTS.md`, whose rules apply here too.

Playback engine shared by both modes:
- **MIDI:** `.mid` plus an MTI `.json` beat map (`MTIMidiJson` in `../midi/mtiJson.ts`) that maps ticks to bars and beats. Ticks are MIDI ticks.
- **Audio:** one `.mp3`/`.wav` per track, pitch- and tempo-shifted with `rubberband-web`. Ticks are milliseconds of the recording, placed by warp markers, which the UI calls sync points.

## Files

| File | Role |
|---|---|
| `engine.ts` | `PlayerEngine`: transport, stepping loop, sections, segues, display state |
| `timeline.ts` | Times `song.getTimeline()` into `TimelinePosition[]` and looks up locations and ticks |
| `route.ts` | Pure section logic: recorded passes, pass mapping, jumps, vocal muting |
| `backend.ts` | Abstract backend interface |
| `midi/backend.ts` | `MidiBackend`: schedules notes through `webaudiofont` |
| `audio/backend.ts` | `AudioBackend`: decodes files, owns the `WarpMap`, mutes vocals |
| `audio/driver.ts` | `AudioDriver`: Web Audio graph, chunk scheduling, crossfade seeks |
| `audio/chunkDetector.ts` | `detectChunks()` strips silence, `AudioChunk` type |
| `../midi/warp.ts` | `WarpMap`: timeline position to recording time |
| `audio/mixdown.ts` | Sums all tracks into one mono buffer for the timeline's waveform |
| `src/stores/player.ts` | Pinia wrapper exposing engine state through `useEvent()` |

## Timeline

- A `TimelinePosition` is a timeline entry with `beats`, `beatTicks` and `endTick`. The timeline is the engine's only timing source: measures carry no ticks.
- MIDI: the beat map's k-th bar is position k. Bars come from `readBeatMapBars()` in `../midi/beatMap.ts`, the same reader the import uses: a bar starts where the `BEAT` label changes, and the terminal bar only ends the one before it. A count mismatch fails the load. A position takes its beats from its own bar, so a later occurrence can have more beats than `measure.beats` (a 1-beat `153-1` followed by a 2-beat `153-2`). Lookups clamp beats to the bar.
- Audio: `WarpMap` indices are positions. Warp markers resolve through `(measure, occurrence)`, and markers that no longer resolve are dropped. Beats are spread evenly over a position. The tempo comes from `buildAudioTempoEvents()`: between two warp markers (and before the first and after the last) a beat lasts their time span divided by the beats they span. `AudioBackend.step()` reports tempo changes like the MIDI backend, and `syncWarp()` updates the displayed tempo. Audio has no time signature, and the header shows none.
- `systemEvents.beat` holds one `BeatEvent { position, beat }` per beat. The current location is looked up in the timeline after every step, not reported by the backends.
- MIDI also collects the tracks that start a note in each position (`getActiveTrackIndices()`), which the score uses to highlight boxes.

## Sections

`Route` is rebuilt whenever the timeline, the sections or `setVampsEnabled` change. The engine owns the `RouteState { section, pass, released }`.
- A section's recorded passes come from `findRecordedPasses()`, each as a tick range from `from`'s beat to the end of `to`'s beat. Cuts play 0 passes, repeats `passes`, vamps until released. A disabled vamp is left out of the route, which plays it as recorded.
- Desired pass `i` plays the last recorded pass if it is the last pass, recorded pass `i` while `i` is below the recorded count, and otherwise the filler, the recorded pass before the last. With 4 recorded passes, a repeat of 2 passes plays P1 P4 and one of 6 plays P1 P2 P3 P3 P3 P4. A vamp loops P1 P2 P3 P3 ... and, once released, finishes in P4.
- When the last pass is decided while another recording plays (a release, or 1 pass of several), the route jumps at the first barline up to that pass's midpoint to the same measure offset, beat and beat fraction in the last pass (`mapTick()`). Past the midpoint the pass finishes and the last pass follows in full.
- A released vamp with `anyBar`/`anyBeat` jumps at the next barline or beat to the end of its last pass.
- A cut jumps from its start to the end of its last pass when playback reaches or starts there. Seeking strictly inside plays on.
- `stateAt(tick)` derives the state from the position, so seeking, stopping and `resetVamp()` need no bookkeeping. Recorded pass k is pass k. For a repeat with several recorded passes, the last one, and passes beyond the total, count as the last pass.
- `nextJump()` returns `{ at, to, next }`. `to === at` is a pass boundary that only changes the state.
- Vocal roles: `entering` in the first recorded pass, `exiting` in the last, `repeating` between. A single recorded pass is entering before its midpoint and exiting after it. Entering material outside desired pass 1 and exiting material outside the last pass count as repeating. Only vamps mute.

## Stepping

`handleStep` plans with `planStep()`: the state-only boundaries up to the next real jump. The backend steps up to the jump, or up to a boundary where muting changes, so notes on a pass boundary get the new pass's vocals. At most four jumps happen per step.
- The `limit` passed to `backend.step()` is where the engine may jump. `MidiBackend` holds back notes within `AUDIO_CLOCK_OFFSET` before it and queues them in the next step unless a jump came first.
- MIDI consumes step time exactly, so the loop keeps stepping after a stop. Dropping that time would shrink the MIDI lookahead.
- After a jump, `restoreTempoAt()` re-anchors the MIDI clock when the jump crossed a tempo change.

## Engine Invariants

- `unload()` aborts an in-progress load and resets all `current*` Properties, the timeline, the route and `mode`. Do not rely on `load()` to clear stale state. `WorkspaceView` unloads on unmount, since the engine is global and would keep playing on other pages.
- In `syncStateAt`, call `backend.seek(pos)` BEFORE `backend.onTempoRestored(bpm)`.
- `syncWarp()` re-times the timeline (audio) and re-resolves the sections (both modes). `usePlayerSync` calls it after every saved layer change that keeps the timeline, and reloads the song instead when the timeline changed. It keeps the pass of the section being played, does NOT touch `currentSegue` and does NOT seek the backend.
- End-of-song fires in the same step as the overshoot (`pos >= duration`).
- Locations are `PlayerLocation { position, measure, occurrence, beat }`, beats 0-based. `currentLocation` and `finalLocation` are undefined while nothing is loaded.

## Warp Editing

- Warp markers are keyed by `(measure, occurrence)`. `warpEditing.ts` keeps them in timeline order: new markers only go between their neighbours, dragging and nudging are clamped between them, and `reassignWarpMarker()` only moves a marker to a free occurrence between them, since `WarpMap` requires strictly increasing marker times.
- The timeline's `WaveformView` draws `mixdownChunks()` with peaks.js. Audio positions are milliseconds, peaks.js works in seconds.
- peaks.js cannot start in a hidden container (a phone tab that is not shown), so `WaveformView` builds it once its container gets a size.
- peaks.js caches every zoom level it resamples, so zoom only moves along `ZoomLadder` levels to keep the cache bounded. The base waveform has one sample per pixel (coarser for very long recordings), which allows zooming to single samples.

## Audio

- `AudioDriver` takes `AudioChunk[][]`: one array of mono chunks per track. `sampleOffset` is the chunk's start in the original file, in samples.
- `scheduleSeek()` is a crossfade seek, used for route jumps. `seek()` is a hard cut, used for user seeks.
- `AUDIO_LOOKAHEAD` in `audio/driver.ts` must equal `AUDIO_CLOCK_OFFSET` in `midi/backend.ts`. The visual position leads audio by this margin in both modes.
- Decoding is memory-bounded for mobile by `MAX_CONCURRENT_DECODE_BYTES`. Do not replace it with an unbounded `Promise.all`.

## Testing

Fixtures (`src/test/fixtures.ts`) use 120 BPM, ppqn 480: position 0 is a 1-beat pickup, every later position a 4/4 bar of 1920 ticks, and the tempo changes to 140 BPM at position 3. `positionTick(p)` gives a position's start. Pair each MIDI song with the beat map of its layout: `makeMtiJson(BEAT_MAP_LABELS.plain | repeat | bakedVamp)`.
- Baked passes: `makeMidiSongWithBakedVamp()` and `makeAudioSongWithBakedVamp()` record measure "2" four times, `make*SongWithRepeat()` records "2" and "3" three times.
- Use `stepPast(updater, player, tick)` to play past a tick. It adds the extra step needed for end-of-song and segue to fire.
- Use `stepUntil(updater, () => condition)` for state-based waits. Record `onCurrentLocationChange` to assert the order positions play in.
- `route.test.ts` builds timelines directly with `makeTimeline()` and walks them with `playPositions()`.

**Audio mode tests** (`engine.audio.test.ts`) mock `AudioDriver` entirely:
- `makeMockAP()` makes `scheduleSeek` move the reported position, as jumps call it instead of `seek`. `loadSong()` clears the initial seek to 0.
- The audio fixtures place positions 0.25 s apart, so the repeat and baked vamp layouts need the 2 s test buffer.
- Where muting changes inside a step, the engine stops there, so crossing that point takes an extra step.

**Silent failure traps:**
- `setSegueEnabled()` does nothing if `load()` never ran, because the segue was never initialized. Spy on `song.hasSegue()` to test segues.
- `setGain(1, 0)` means the vocal track is muted. Clear the spy before the step you assert on.
