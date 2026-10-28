# Player — Agent Guide

Extends the root `AGENTS.md`.

Both modes share the engine:
- **MIDI:** `.mid` plus an MTI beat map (`MTIMidiJson`, `../midi/mtiJson.ts`) mapping ticks to bars and beats. Ticks are MIDI ticks.
- **Audio:** one `.mp3`/`.wav` per track, pitch- and tempo-shifted by `rubberband-web`. Ticks are recording milliseconds, placed by warp markers (the UI's sync points).

| File | Role |
|---|---|
| `engine.ts` | `PlayerEngine`: transport, stepping loop, sections, segues, display state |
| `timeline.ts` | Times `song.getTimeline()` into `TimelinePosition[]`, location and tick lookups |
| `route.ts` | Pure section logic: passes, jumps, vocal muting |
| `backend.ts` | Backend interface |
| `midi/backend.ts` | `MidiBackend`: schedules notes through `webaudiofont` |
| `audio/backend.ts` | `AudioBackend`: decodes, owns the `WarpMap`, mutes vocals |
| `audio/driver.ts` | `AudioDriver`: Web Audio graph, chunk scheduling, crossfade seeks |
| `audio/chunkDetector.ts` | `detectChunks()` strips silence |
| `audio/mixdown.ts` | Mono mix of all tracks for the waveform |
| `src/stores/player.ts` | Pinia wrapper exposing engine state via `useEvent()` |

## Timeline

- A `TimelinePosition` adds `beats`, `beatTicks` and `endTick` to a timeline entry; it is the only timing source.
- MIDI: beat map bar k is position k, read by `readBeatMapBars()` (`../midi/beatMap.ts`, shared with the import): a bar starts where the `BEAT` label changes; the terminal bar only ends the one before. A count mismatch fails the load. Beats come from each bar, so a later occurrence may have more beats than `measure.beats`; lookups clamp to the bar.
- Audio: `WarpMap` indices are positions; markers resolve through `(measure, occurrence)` and unresolvable ones are dropped. Beats are spread evenly over a position. `buildAudioTempoEvents()`: between markers (and outside the first and last) a beat lasts the span's time over its beats. `AudioBackend.step()` reports tempo changes like MIDI; `syncWarp()` updates the shown tempo. Audio has no time signature.
- `systemEvents.beat` holds one `BeatEvent { position, beat }` per beat. The current location is looked up after every step.
- MIDI collects the tracks starting notes per position (`getActiveTrackIndices()`) for box highlighting.

## Sections

`Route` is rebuilt when timeline, sections or `setVampsEnabled` change; the engine owns `RouteState { section, pass, released }`.
- `getSectionPasses()` (`../models/sections.ts`) is the one rule for a section's recorded passes, shared by route, `getSectionExtent()`, `validateSections()` and all overlays. A pass is a tick range from `from`'s beat to the end of `to`'s beat. A cut covers exactly its range (possibly several passes). A repeat or vamp starts at its own pass and takes in directly following repetitions up to where another section starts, so sections can sit on different passes of one recorded repeat. Two sections on one pass are invalid.
- Cuts play 0 passes, repeats `passes`, vamps until released. Disabled vamps are left out of the route (played as recorded) but still bound the passes of the section before them.
- Desired pass `i` plays the last recorded pass if it is the last pass, recorded pass `i` while below the recorded count, else the filler (the pass before the last, recorded to lead back into the repeat, while the last leads out). With 4 recorded passes: repeat of 2 plays P1 P4, of 6 plays P1 P2 P3 P3 P3 P4; a vamp loops P1 P2 P3 P3 ... and finishes in P4.
- When the last pass is decided while another recording plays (a release, or 1 pass of several), the pass playing becomes the last: no further pass follows. At its next barline (at once on a barline), else its next beat, the route jumps to the same offset, beat and beat fraction in the last recorded pass (`mapTick()`), whose ending leads on. A release in its last beat leaves at its end.
- A released `anyBar`/`anyBeat` vamp jumps at the next barline/beat to the end of its last pass.
- A cut jumps from its start to its end when playback reaches or starts there; seeking strictly inside plays on, and `currentSection` reports the cut (it has no route state). Jumps landing on a cut start go straight past it (and neighbouring cuts), so audio seeks once.
- `stateAt(tick)` derives the state from the position, so seeking, stopping and `resetVamp()` need no bookkeeping. Recorded pass k is pass k; for a repeat the last recorded pass and passes beyond the total count as the last pass.
- `nextJump()` returns `{ at, to, next }`; `to === at` only changes the state.
- Vocal roles: `entering` in the first recorded pass, `exiting` in the last, `repeating` between; a single pass splits at its midpoint. Entering material outside desired pass 1 and exiting material outside the last pass count as repeating. Only vamps mute.

## Stepping

`handleStep` plans with `planStep()` (state-only boundaries up to the next jump). The backend steps up to the jump or to a boundary where muting changes, so notes on a pass boundary get the new pass's vocals. At most four jumps per step.
- `backend.step()`'s `limit` is where the engine may jump. `MidiBackend` holds back notes within `AUDIO_CLOCK_OFFSET` before it and queues them next step unless a jump came first.
- MIDI consumes step time exactly, so the loop keeps stepping after a stop (dropping it would shrink the lookahead).
- After a jump, `restoreTempoAt()` re-anchors the MIDI clock across tempo changes.

## Engine Invariants

- `unload()` aborts loading and resets all `current*` Properties, timeline, route and `mode`; never rely on `load()` to clear state. `WorkspaceView` unloads on unmount (the engine is global).
- In `syncStateAt`, call `backend.seek(pos)` BEFORE `backend.onTempoRestored(bpm)`.
- `syncWarp()` re-times the audio timeline and re-resolves sections, keeping the playing section's pass, without touching `currentSegue` or seeking the backend.
- End-of-song fires in the step that overshoots (`pos >= duration`).
- `PlayerLocation { position, measure, occurrence, beat }` (beats 0-based); `currentLocation`/`finalLocation` are undefined while unloaded.

## Warp Editing

- Warp markers (keyed by `(measure, occurrence)`) stay in timeline order through `warpEditing.ts`: new markers go between neighbours, drags and nudges clamp between them, `reassignWarpMarker()` only targets free occurrences between them, since `WarpMap` needs strictly increasing times.
- `WaveformView` draws `mixdownChunks()` with peaks.js at the timeline axis's scale and offset. Positions are milliseconds, peaks.js uses seconds.
- peaks.js cannot start in a hidden container (an unshown phone tab), so it is built once the container has a size.
- peaks.js caches every resampled zoom level, so the axis zooms along `ZoomLadder` levels only. The base waveform has one sample per pixel (`getWaveformBaseScale()`, coarser for very long recordings).

## Audio

- `AudioDriver` takes one array of mono `AudioChunk`s per track; `sampleOffset` is the chunk's start in the file.
- `scheduleSeek()` crossfades (route jumps), `seek()` cuts hard (user seeks).
- `AUDIO_LOOKAHEAD` (`audio/driver.ts`) must equal `AUDIO_CLOCK_OFFSET` (`midi/backend.ts`); the visual position leads audio by it.
- `MAX_CONCURRENT_DECODE_BYTES` bounds decoding memory for mobile; never replace it with an unbounded `Promise.all`.

## Testing

Fixtures (`src/test/fixtures.ts`): 120 BPM, ppqn 480, position 0 a 1-beat pickup, then 4/4 bars of 1920 ticks, 140 BPM from position 3; `positionTick(p)` gives a start. Pair MIDI songs with `makeMtiJson(BEAT_MAP_LABELS.plain | repeat | bakedVamp)`.
- `make*SongWithBakedVamp()` record "2" four times, `make*SongWithRepeat()` "2" and "3" three times.
- `stepPast(updater, player, tick)` adds the extra step end-of-song and segue need; `stepUntil(updater, condition)` waits for state; record `onCurrentLocationChange` for play order.
- Route tests use `src/test/route.ts`: `makeTimeline()`, the section builders (`vamp`, `repeat`, `cut`, `at`), `playPositions()` and `followJumps()`. `route.passes.test.ts` covers sections on single passes, `route.bakedRepeat.test.ts` a real recording with an incomplete last pass.

**Audio tests** (`engine.audio.test.ts`) mock `AudioDriver`: `makeMockAP()` lets `scheduleSeek` move the position; `loadSong()` clears the initial seek. Positions are 0.25 s apart, so repeat and baked vamp layouts need the 2 s buffer. Where muting changes inside a step the engine stops there, costing an extra step.

**Silent traps:** `setSegueEnabled()` does nothing before `load()` (spy on `song.hasSegue()`). `setGain(1, 0)` means vocals muted; clear the spy before the asserted step.
