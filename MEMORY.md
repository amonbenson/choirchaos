# choirchaos — Project Memory

> Copied from Claude's persistent memory on 2026-06-27.
> These are point-in-time observations — verify code references before relying on them.

---

## Project Overview

Choir accompaniment web app. Members open songs, see the PDF score, and hear MIDI or audio playback that tracks position in real time.

**Stack:** Vue 3 (Composition API), Vite, TypeScript, Pinia, PrimeVue, Tailwind CSS, PocketBase (backend/auth/storage/realtime). Audio via Web Audio API + `webaudiofont` (MIDI synthesis) + `rubberband-web` (pitch/tempo shifting). PDF rendering via `pdfjs-dist`.

**Song format:** Songs are PocketBase records. Two playback modes:
- **MIDI mode**: `.mid` + `.json` pair. The `.json` is MTIMidiJson — contains beat/tempo/time-signature events mapping MIDI tick positions to measure/beat references. Player reads JSON for transport metadata, MIDI for note events.
- **Audio mode**: one or more `.mp3`/`.wav` files (one per track). No MIDI/JSON required. Pitch/tempo shifted in real time via `rubberband-web`.

`tmp/exampleMidi/` contains a sample song in the production format (MIDI + JSON + PocketBase record). **These files are proprietary — use only as a format reference. Never copy musical or text content from them.**

---

## Player Architecture

### File layout

```
src/core/player/
├── engine.ts          ← PlayerEngine (transport, vamps, segue, events)
├── backend.ts         ← abstract PlayerBackend + BackendCallbacks + StepResult + LoadResult
├── types.ts           ← PlayerStatus, PlayerMode, PlayerVamp/State, PlayerSegueState,
│                         SystemEvents, TrackEvents
├── midi/
│   └── backend.ts     ← MidiBackend (MIDI clock, note scheduling, WebAudioFont)
└── audio/
    ├── backend.ts     ← AudioBackend (warp-driven position, delegates to AudioDriver)
    ├── driver.ts      ← AudioDriver (RubberBand, gain nodes, BufferSource management)
    └── driver.test.ts
src/core/midi/
├── warp.ts            ← WarpMap (pure integer-index timing math)
├── warp.test.ts
└── types.ts           ← Tick, TimeSignature (also used by song.ts — do not move)
src/core/utils/
├── events.ts          ← Property<T>, Emitter<T>, Disposable, Event<T>, Emitters
└── updater.ts         ← Updater (abstract), SetIntervalUpdater
src/composables/
└── event.ts           ← useEvent() composable (replaces old EventEmitter-based version)
```

`midi/events.ts` (MidiEvent, NoteEvent, MeasureEvent etc.) is a candidate to move to `player/events.ts` since all consumers are player-internal — not yet done as of this session.

### API conventions

**No _ prefixes** — TypeScript access modifiers enforce privacy. `_` only for ignored callback args.

**No TypeScript getters** — public read access via `get*()`/`is*()` methods:
- `engine.getStatus()`, `engine.isPlaying()`, `engine.getPosition()`, `engine.getDuration()`
- `engine.getCurrentMeasure()`, `engine.getCurrentTempo()`, `engine.getCurrentTimeSignature()`
- `engine.getFinalMeasure()`, `engine.getCurrentVamp()`, `engine.getCurrentSegue()`
- `engine.getMode()`, `engine.getPpqn()`, `engine.getCurrentSong()`, `engine.getAudioBuffers()`
- `engine.getPlaybackSpeed()`, `engine.getPlaybackTransposition()`, `engine.getMidiEvents()`

**Setters via methods**: `engine.setPlaybackSpeed(v)`, `engine.setPlaybackTransposition(v)`

**Event subscription** via `Property.onChange` / `Emitter.event` — returns `Disposable`:
```ts
const d = engine.onPositionChange(pos => { ... });
d.dispose();
```

Property fields (fire `on*Change` events): status, mode, playing, position, duration, currentMeasure, currentTempo, currentTimeSignature, finalMeasure, currentVamp, currentSegue, playbackSpeed, playbackTransposition.

Emitter fields (fire-and-forget): note, trackAmplitudesChange, segue, audioContextZombie.
Event names: `onNote`, `onTrackAmplitudesChange`, `onSegue`, `onAudioContextZombie`.

### PlayerEngine internals

- All reactive state is `Property<T>` — including `mode` (was a plain field, now fires `onModeChange`)
- Default constants at module level: `DEFAULT_MEASURE`, `DEFAULT_TEMPO`, `DEFAULT_TIME_SIGNATURE`
- `unload()` explicitly resets ALL `current*` Properties + `vamps` array + `mode` to defaults — do not rely on the next `load()` to clean stale state
- Segue initialized in `load()` after `resolveEventTicks()`, NOT inside `resolveEventTicks()`
- `resolveEventTicks()` only resolves tick positions of vamps/markers + resets `currentVamp`
- `seek(0)` at end of `load()` initializes `currentVamp` via `vampAt(0)` — covers songs that start mid-vamp
- `stop()` resets `currentVamp.currentIteration` to 0 for songs that start with a vamp
- Position throttle removed — Property fires on every 50Hz step
- `getMidiEvents()` returns `{ system: SystemEvents; track: TrackEvents[] }` (track only in midi mode)
- `syncDisplayAt(pos)` — private; updates `currentMeasure`/`currentTempo`/`currentTimeSignature` from system events without seeking the backend; returns the found `TempoEvent | undefined`. Used by both `syncStateAt()` and `syncWarp()`.
- `syncWarp()` (audio mode only): calls `backend.syncWarp()`, re-resolves marker + vamp ticks (resets `vamps`/`currentVamp`), recomputes `finalMeasure`, then calls `syncDisplayAt(pos)`. **Does NOT touch `currentSegue`** — segue is independent of the warp map. **Does NOT seek the backend** — only the display properties are re-synced.

### PlayerBackend (abstract)

- `StepResult`: `{ p0, p1, deltaTimeConsumed }` — `barlineCrossed` was removed (engine uses own `barlineBetween()`)
- `syncWarp()` takes no arguments (AudioBackend re-reads `currentSong` internally)
- Doc comments on all abstract methods in backend.ts describe when each is called

### MidiBackend

- Private fields: `ppqn`, `tickDuration`, `currentBpm`, `audioClockReference`, `audioClockTickPosition`, `lastKnownPosition`, `player`, `instruments`, `noteEvents`, `currentSong`
- `getNoteEvents(): TrackEvents[]` — accessed by engine via `instanceof MidiBackend` check
- `lastKnownPosition` set to `p1` BEFORE event scan so `resetAudioClockReference()` anchors correctly

### AudioBackend

- `syncWarp()` calls `buildWarpEvents()` which re-reads `this.currentSong` (no song param)
- `buildWarpEvents()` converts each `SongWarpMarker` (Numbering string) to an integer index via `measures.findIndex(m => m.value === marker.measure)` before passing to `WarpMap`; markers whose measure number is not found are silently dropped (`.filter(m => m.measure !== -1)`)
- `step(currentPosition, deltaTime, limit?, vampPhase?)` — clamps raw driver position to `limit` so overshoot doesn't shift vamp jump targets; passes `rawP1` (unclamped) to the measure-change search so callbacks fire at the true audio position
- During `vampPhase === "repeating"`, tracks with `classification === "Vocal"` are silenced (`setGain(i, 0)`)
- `onPositionJump` calls `audioDriver.scheduleSeek()` (crossfade) rather than `seek()` (hard cut)

### AudioDriver (audio/driver.ts)

Constants: `AUDIO_LOOKAHEAD = 0.1` (must match MIDI's `AUDIO_CLOCK_OFFSET` — visual position leads audio by this margin), `SEEK_CROSSFADE = 0.020` (xfade window bridging render-quantum gaps).

Key fields: `scheduledStartTime` (context time when current play/seek started), `refPosition` (position at that moment), `sourceFadeGains: GainNode[]` (one per track, inserted between source and trackInput to allow crossfade on seek).

- `play()` creates `sourceFadeGains` (gain=1) then sources; connects `source → fadeGain → trackInput`
- `pause()` captures position, stops sources with try-catch (sources scheduled in lookahead window can throw outside the browser), disconnects fadeGains
- `seek()` is a hard stop+restart (used for initial seeks only)
- `scheduleSeek(positionSeconds)` — crossfade seek while playing:
  - If not playing: just sets `refPosition`
  - Fades out old sources over `[when, when+SEEK_CROSSFADE]`, stops them at `xfadeEnd`; `onended` disconnects the old fadeGain for GC
  - Creates new fadeGains (gain 0→1) and sources starting at `when` from `positionSeconds`
  - Sets `refPosition = positionSeconds`, `scheduledStartTime = context.currentTime` (not `when`) — so `getPosition()` advances immediately, matching MIDI's visual-lead behavior

### WarpMap (midi/warp.ts)

Pure integer-index timing math:
- `setMarkers(markers: WarpMarker[])`, `addMarker(marker)`, `removeMarker(measure: number)`
- `measureToTime(index: number): number`, `timeToMeasure(time: number): number`
- Internally maintains sorted `WarpSegment[]` with linear interpolation between markers
- Validates: integer measures, no duplicates, strictly increasing times

### SongWarpMarker (models/song.ts)

Songs store warp markers as `{ measure: Numbering; time: number }` where `measure` is a measure *number* string (e.g. `"1"`, `"2a"`) — **not** an array index. This makes markers stable when measures are inserted or reordered.

**Migration:** `Song.deserialize()` converts legacy integer-index markers to Numbering strings:
```ts
typeof m.measure === "number"
  ? (measureList.items()[m.measure]?.value ?? String(m.measure))  // legacy: index → label
  : m.measure  // already a Numbering string
```
- `warpMarkers` may be `undefined` in old PB records — guarded with `?? []`
- Out-of-bounds legacy index falls back to `String(index)` rather than throwing

**Song.currentSong** exposed in player store as `ComputedRef<Song | undefined>` using `onStatusChange` as trigger (backed by `shallowRef` — no deep reactivity on Song)

### Vamp state machine

```
if (!currentVamp.get() && vamps.length > 0) {
  const v = vampAt(pos);
  if (v) currentVamp.set(v);
}
```
Actions: **repeat** (jump to vamp.start), **exit-at-end** (clear vamp), **exit-at-barline** (jump to vamp.end).
`jumpOffset = vamp.end - p1` in exit-at-barline — ticks, not seconds. `deltaTimeConsumed` is seconds.

`PlayerVampState` has `out: VampOut` and `vocals: VampVocals` fields (from `types.ts`):
- `VampOut = "onEnd" | "anyBar" | "anyBeat"` — when the exit triggers
- `VampVocals = "all" | "first" | "last" | "split"` — which passes include vocals

Both types live in [src/core/models/measureEvent.ts](src/core/models/measureEvent.ts) and are re-exported from [src/core/player/types.ts](src/core/player/types.ts).

### Vamp public API on PlayerEngine

- `exitVamp()` — sets `manualExit: true` on current vamp
- `resetVamp()` — clears `manualExit`, resets `currentIteration` to 0
- `toggleVamp()` — calls `resetVamp` or `exitVamp` depending on `manualExit`
- `setVampsEnabled(enabled: boolean)` — global vamp toggle (PR #73); when disabled, `vampAt()` always returns `undefined` and any active vamp is immediately force-exited

### VampPhase

`VampPhase = "entering" | "repeating" | "exiting"` (exported from `engine.ts`)

`vampPhaseAt(vamp, pos)` private engine method:
- `"exiting"` if `vamp.manualExit` OR (last iteration AND pos >= midpoint)
- `"entering"` if `currentIteration === 0` AND pos < midpoint
- `"repeating"` otherwise

`midpoint = vamp.start + (vamp.end - vamp.start) / 2`

Phase is computed each step and forwarded to `backend.step()` as the optional 4th arg. `MidiBackend` ignores it (`_vampPhase`); `AudioBackend` uses it to mute vocals during "repeating".

### Store integration (src/stores/player.ts)

Uses `useEvent<T>()` from `@/composables/event` — three overloads:
1. With `setter` → `WritableComputedRef<T>` (for playbackSpeed, playbackTransposition)
2. Standard (no setter, event payload = T) → `ComputedRef<T>` (most properties)
3. Custom `getter` (event is trigger only, T from initial) → `ComputedRef<T>` (for `events` which uses `onStatusChange` as trigger but calls `getMidiEvents()` as getter)

`mode` now uses `useEvent(globalPlayer.onModeChange, ...)` — was broken before (plain computed, never invalidated).
`ppqn` was removed from store return value.
`loading` and `ready` are plain `computed()` derived from `status.value`.

### Key gotchas

- Seek order: `backend.seek(pos)` BEFORE `backend.onTempoRestored(bpm)` — preserved as comment in `syncStateAt`.
- End-of-song fires in the same step as overshoot (`pos >= duration.get()`).
- `MeasureReference` is `[MeasureNumber, BeatNumber]` where BeatNumber is 0-based.
- `$beatTicks`, `$tickLength` on Measure populated by AudioBackend during `buildWarpEvents()`.
- `Property<void>` emitters: call `fire(undefined)` — TypeScript allows `undefined` for `void`.
- `useEvent` requires an active Vue effect scope — throws if called outside one.

---

## Feedback: Testing Patterns

### Mandatory mocks for any test file that imports `MidiPlayer`

Always mock these two packages at the top of the file:

```typescript
// midi-json-parser internally creates new Worker() — unavailable in Node/jsdom
vi.mock("midi-json-parser", () => ({
  parseArrayBuffer: vi.fn().mockResolvedValue({ tracks: [...] }),
}));

// rubberband-web depends on tone, which uses extensionless ESM imports
// (e.g. ./core/Global instead of ./core/Global.js) that Node cannot resolve.
vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));
```

Tests that mock `./audioPlayer` entirely (like `player.audio.test.ts`) only need the `midi-json-parser` mock — `rubberband-web` is not loaded when `audioPlayer` is intercepted.

### afterEach: `clearAllMocks`, not `resetAllMocks`

`vi.resetAllMocks()` destroys `mockResolvedValue` / `mockReturnValue` implementations set in module-level `vi.mock()` factories, breaking all tests after the first. Use `vi.clearAllMocks()` (clears call history, preserves implementations).

### Test infrastructure files

| File | Purpose |
|---|---|
| `src/test/setup.ts` | Global setup: `node-web-audio-api` polyfill, `WebAudioFontPlayer` stub, localStorage polyfill |
| `src/test/updater.ts` | `ManualUpdater` — step time forward deterministically via `updater.step(seconds)` |
| `src/test/midi.ts` | Pure-TS MIDI binary builder (`buildMidiBuffer`) — no external deps |
| `src/test/fixtures.ts` | Song/JSON/MIDI factories; tick layout constants (`TICKS`, `TRACK_NAMES`) |

### `stepPast` helper pattern

```typescript
function stepPast(updater: ManualUpdater, player: MidiPlayer, targetTick: number): void {
  for (let i = 0; i < 10_000; i++) {
    if (player.position > targetTick) break;
    if (!updater.running) break;
    updater.step(0.02);
  }
  // Flush step: _handleStep checks position >= duration at the START of each step,
  // so end-of-song / segue logic fires one step after overshooting.
  if (updater.running) updater.step(0.02);
}
```

### Vamp loop pattern

`currentVamp` starts as `undefined` before the playhead enters the vamp region. A `while (currentVamp !== undefined)` loop exits immediately. Use two phases:

```typescript
// Phase 1: advance until vamp is entered
for (let i = 0; i < 10_000 && vp.currentVamp === undefined; i++) vu.step(0.02);
// Phase 2: keep going until vamp exits
for (let i = 0; i < 10_000 && vp.currentVamp !== undefined; i++) vu.step(0.02);
```

### Tick layout (test fixtures, 120 BPM, ppqn=480)

```
Measure "0" (pickup, 1 beat):  tick    0
Measure "1" (4/4):             tick  480
Measure "2" (4/4):             tick 2400
Measure "3" (4/4, → 140 BPM): tick 4320
Measure "4" (4/4):             tick 6240
Measure "5" (terminal):        tick 8160  ← also used as duration
```

### AudioPlayer / engine.audio.test.ts patterns

**MockAudioDriver shape — always include `scheduleSeek`:**

```typescript
type MockAudioDriver = {
  getPosition: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  scheduleSeek: ReturnType<typeof vi.fn>; // ← must be present; vamps call this, not seek
  setGain: ReturnType<typeof vi.fn>;
  setTempo: ReturnType<typeof vi.fn>;
  setPitch: ReturnType<typeof vi.fn>;
};
```

**Wiring scheduleSeek so getPosition stays in sync after a vamp jump:**

```typescript
ap.scheduleSeek.mockImplementation((pos: number) => {
  ap.getPosition.mockReturnValue(pos);
});
```

Without this the mock driver still reports the old position after a vamp loop and the test assertions break.

**Vamp tests need two steps to trigger the loop:**
1. Step 1: set `getPosition` to a value inside the vamp region — engine detects entry
2. Step 2: set `getPosition` to the vamp end — engine applies the limit and calls `onPositionJump` / `scheduleSeek`

Clear `ap.seek` and `ap.scheduleSeek` after `load()` (initial seek to 0 pollutes call counts).

**Test fixtures for audio vamp tests:**

| Fixture | What it creates |
|---|---|
| `makeAudioSong()` | Single track, no vamp, no warp markers |
| `makeAudioSongWithVamp()` | Single track (Accompaniment), vamp at measure 2→3 (250–500 ms), 2 iterations |
| `makeAudioSongWithVocalVamp(vocals?)` | Two tracks (Accompaniment + Vocal), same vamp; midpoint = 375 ms, last pass = `currentIteration >= 2` |
| `makeAudioSongWithVampOut(out)` | Single track, vamp with a specific `VampOut` exit mode |

Both vamp fixtures use warp markers `[{measure:"1", time:0.0}, {measure:"3", time:0.5}]` → 0.25 s/measure.

### Other gotchas

- `song.events.segue` must be `true` at load time — `setSegueEnabled()` silently does nothing if `_currentSegue` was never initialized by `load()`.
- `$beatTicks` is populated during `loadMidi()` from MTIMidiJson BEAT events. If missing from JSON mocks, `song.findMeasure(...)?.$beatTicks[0]` returns `undefined` and vamps/duration break silently.
- In audio tests, vamp phase assertions use `setGain` spy: vocal track is index 1, `expect(ap.setGain).toHaveBeenCalledWith(1, 0)` means muted. Clear `setGain` mock before the asserting step.

---

## Feedback: Linting

Run `npm run lint:fix` to fix any lint or formatting issue. Do not attempt to fix import ordering, spacing, or style errors by hand.

Manual fixes are slower and less reliable than the linter; always run `npm run lint:fix` immediately when you notice or cause a lint/formatting issue.
