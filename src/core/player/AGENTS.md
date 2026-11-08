# Player — Agent Guide

Extends the root `AGENTS.md`.

`PlayerEngine` (`engine.ts`) drives one of two backends; `stores/player.ts` exposes it to Vue. Both count in ticks:
- **MIDI** (`midi/backend.ts`): MIDI ticks, timed by the MTI beat map; notes play through `webaudiofont`.
- **Audio** (`audio/`): recording milliseconds, placed by the `WarpMap` built from sync points; stretched by `rubberband-web`.

`timeline.ts` turns `song.getTimeline()` into `TimelinePosition`s, the only timing source. MIDI: beat map bar k is position k (`readBeatMapBars()`, shared with the import), and a count mismatch fails the load. Audio: beats are spread evenly between sync points; unresolvable warp markers are dropped. Audio has no time signature.

## Sections and Route

`route.ts` is pure section logic, rebuilt whenever timeline, sections or vamp enabling change.
- `getSectionPasses()` (`models/sections.ts`) is the one rule for which recorded passes a section covers, shared by route, validation and all overlays. Never compute passes elsewhere.
- Desired passes map onto recorded ones (`getRecordedPassIndex()`): the last desired pass always plays the last recorded pass (it leads out), extra passes repeat the one before it (it leads back in). With 4 recorded passes a repeat of 6 plays P1 P2 P3 P3 P3 P4.
- When the last pass is decided mid-pass (a vamp release), the route jumps at the next barline or beat to the same offset in the last recorded pass (`mapTick()`).
- `stateAt(tick)` derives the state from the position alone, so seeking, stopping and resetting need no bookkeeping. A cut has no state: it only plays after a seek into it.
- Vocal roles (entering, repeating, exiting) decide muting; only vamps mute.

## Stepping

- Time comes from the engine's one `AudioClock`, never `context.currentTime`: Firefox on Android advances it only every ~0.1 s and Firefox rounds it, which would make steps leap and notes land late. Test changes in Chrome, Firefox and Safari, desktop and mobile.
- The engine plans each step up to the next jump or muting change and passes it as `limit`; a backend never steps past it. `MidiBackend` holds back notes within `AUDIO_CLOCK_OFFSET` of the limit. After every step the engine announces the next jump through `prepareJump()`, so audio can schedule its crossfade in advance.
- MIDI consumes step time exactly, so the loop keeps stepping after a stop (dropping it would shrink the lookahead). End of song fires in the step that overshoots.
- A section on the last measure jumps back exactly at the song's end, so a due jump wins over finishing. The segue is `due` only when no jump is left; the "Segueing" card waits for it.
- In `syncStateAt`, `backend.seek()` must come before `backend.onTempoRestored()`.
- `unload()` aborts loading and resets all state; never rely on `load()` to clear it. `syncWarp()` re-times audio and re-resolves sections without seeking.

## Audio

Recordings stream: the backend stores each as mono Ogg Opus plus a seek index per song (`audioIndex`, one entry per file). `BlockStore` loads 5 s blocks per track by HTTP range request, decodes them in a Web Worker (`opus-decoder`, WASM, identical on every browser) and holds only the blocks around the playhead and the jump targets, so memory stays bounded however long the song is. A whole recording is never decoded at once: that is what crashed phones.
- After a decoder reset Opus needs a 400 ms lead-in to match a continuous decode (80 ms, as RFC 7845 suggests, is audibly off). Packets are timed forward from the first fetched page: the last page's granule position is cut to the recording's end.
- Blocks overlap by 5 ms and crossfade. Sources started back to back click on every browser at tempos other than 1 or at 44.1 kHz. An envelope must be 0 before its source starts, or its first frame plays at full volume.
- The driver schedules blocks a second ahead instead of chaining them in `onended`, which fires late. Where a block is missing it reports the position, and the backend waits there (`buffering`) until enough is loaded.
- The engine announces every place playback may jump to (`prefetch()`), a vamp's release target included: a release jumps within a beat, too soon to fetch.
- Downloaded bytes live in `sharedCompressedCache`, so reloads after timing edits fetch nothing. The editor's waveform downloads and decodes everything (in the worker, chunk by chunk): only the timeline asks for it.
- A segment is one continuous run through the recording; seeks, jumps and tempo changes replace it. `seek()` cuts hard, `jump()` crossfades. Until `jump()` commits a prepared jump, `getPosition()` runs on past it so the engine still reaches it.
- Stop every source once: Safari throws on a second `stop()`.

## Testing

- `src/test/fixtures.ts` documents its tick layout; `src/test/route.ts` builds timelines and sections for route tests; `src/test/updater.ts` steps the engine (`stepPast()` adds the extra step end of song and segues need).
- `engine.audio.test.ts` mocks `AudioDriver`. Where muting changes inside a step the engine stops there, costing an extra step.
- `setSegueEnabled()` does nothing before `load()`. `setGain(i, 0)` on the vocals track is how muting shows; clear the spy before the asserted step.
