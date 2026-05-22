# choirchaos-ts

Vue 3 / TypeScript choir accompaniment app. Members open a song, see the score as a PDF, and hear MIDI or audio playback that follows the score in real time.

## Stack

- **Frontend**: Vue 3 (Composition API), Vite, TypeScript, Pinia, PrimeVue, Tailwind CSS
- **Backend**: PocketBase (self-hosted BaaS; handles auth, storage, realtime)
- **Audio**: Web Audio API; MIDI synthesis via `webaudiofont`, pitch/tempo shifting via `rubberband-web`
- **PDF viewer**: `pdfjs-dist`

## Project structure

```
src/
  core/
    midi/         # Player engine (player.ts, audioPlayer.ts, events.ts, warp.ts, updater.ts)
    models/       # Song, Measure, Track, MeasureEvent domain objects
    utils/        # binarySearch, numbering, file helpers, updater base class
    scripts/      # bundlemti — build tool for packing MTI song packages
    pdf/          # PDF rendering helpers
  pocketbase/     # PocketBase client, auth, db helpers
  stores/         # Pinia stores
  components/     # Vue components
  views/          # Route-level views
  test/           # Shared test infrastructure (see Testing section)
```

## Song format

Songs are stored as PocketBase records. Playback depends on two file types:

- **MIDI mode**: `.mid` + `.json` pair. The `.json` is MTIMidiJson — it contains beat/tempo/time-signature events that map MIDI tick positions to measure/beat references. The player reads the JSON for transport metadata and the MIDI file for note events.
- **Audio mode**: one or more `.mp3`/`.wav` files (one per track). No MIDI or JSON required. Pitch/tempo shifting is applied in real time via `rubberband-web`.

`tmp/exampleMidi/` contains a sample song in the production format (MIDI + JSON + PocketBase record). **These files are proprietary — use them only as a format reference. Never copy musical or text content from them.**

## Player architecture

`MidiPlayer` (`src/core/midi/player.ts`) is the single player class for both modes.

- **Transport**: tick-based (`Tick = number`, unit = ms in audio mode, MIDI ticks in MIDI mode). `_handleStep(delta)` is the main loop, called by an `Updater`.
- **Updater**: abstract base in `src/core/utils/updater.ts`. Production uses `SetIntervalUpdater` (setInterval) or `AnimationFrameUpdater` (rAF). Tests inject `ManualUpdater` via constructor.
- **MIDI mode**: parses note events from the MIDI file; schedules WebAudioFont notes on the `AudioContext` clock. `$beatTicks[]` on each `Measure` is populated from JSON BEAT events during load — without it, seek/vamp/duration logic breaks.
- **Audio mode**: wraps `AudioPlayer` (`audioPlayer.ts`) which chains BufferSource → RubberBandNode → GainNode → destination. Position is read from `audioPlayer.position * 1000` (seconds → ms).
- **Vamps**: a vamp loops a measure range for N iterations, then exits. `_currentVamp` is `undefined` before the playhead enters the vamp region.
- **Segue**: `song.events.segue` must be `true` **at load time** (`_updateCurrentSegue` is called once during `load()`). Calling `setSegueEnabled()` after load is a no-op if `_currentSegue` was never initialized.
- **End-of-song**: `_handleStep` checks `position >= duration` at the **start** of each step (before advancing position). The pause fires on the step after overshooting, not in the same step.

### Constructor injection (for testing)

```typescript
new MidiPlayer(audioContext?, updaterFactory?)
```

Pass a `node-web-audio-api` `AudioContext` and a factory that returns a `ManualUpdater`. This is how tests control time.

## Planned refactor

The player will be split into:
1. A general **engine** (transport, measures, vamps, segue)
2. Swappable sub-engines: **MidiEngine** (clock + synthesis) and **AudioEngine** (AudioPlayer wrapper)

Keep this in mind when designing new tests — avoid coupling tests to internals that will move.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Tests (watch) | `npm test` |
| Tests (single pass) | `npx vitest run` |
| Type-check | `npm run typecheck` |
| **Lint + auto-fix** | **`npm run lint:fix`** |

> **Always run `npm run lint:fix` to fix formatting and lint errors — do not attempt to fix ESLint/Prettier issues manually.** The command handles import ordering, spacing, and style rules far more reliably than manual edits.

## Testing

### Infrastructure

| File | Purpose |
|---|---|
| `src/test/setup.ts` | Global setup: `node-web-audio-api` polyfill, `WebAudioFontPlayer` stub, localStorage polyfill |
| `src/test/updater.ts` | `ManualUpdater` — step time forward deterministically via `updater.step(seconds)` |
| `src/test/midi.ts` | Pure-TS MIDI binary builder (`buildMidiBuffer`) — no external deps |
| `src/test/fixtures.ts` | Song/JSON/MIDI factories; tick layout constants (`TICKS`, `TRACK_NAMES`) |

### Mandatory mocks for any test that imports `MidiPlayer`

Two packages blow up in Node.js and must always be mocked at the top of the file:

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

### afterEach: use `clearAllMocks`, not `resetAllMocks`

`vi.resetAllMocks()` destroys `mockResolvedValue` / `mockReturnValue` implementations set in module-level `vi.mock()` factories. Use `vi.clearAllMocks()` (clears call history, preserves implementations) in `afterEach`.

### stepPast helper pattern

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

`currentVamp` starts as `undefined` before the playhead enters the vamp region. A loop like `while (currentVamp !== undefined)` exits immediately. Use two phases:

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

## Key gotchas

- **`song.events.segue` must be set before `load()`**. `setSegueEnabled()` silently does nothing if the segue was not enabled at load time.
- **`$beatTicks` is populated during `loadMidi()`** from the MTIMidiJson BEAT events. If these aren't present in the JSON mock, `song.findMeasure(...)?.$beatTicks[0]` returns `undefined` and vamps/duration break silently.
- **`MeasureReference` is `[measureNumber, beatIndex]`** where beatIndex is 0-based (beat 1 of a measure = index 0).
- **`_position` can momentarily exceed `_duration`** via direct arithmetic (bypasses `_updatePosition` clamping). The end-of-song handler calls `_updatePosition(this._duration)` before `pause()` to clamp it.
- **PocketBase imports `localStorage` on module load** via `pocketbase/index.ts`. `setup.ts` provides an in-memory polyfill to prevent jsdom worker crashes.
