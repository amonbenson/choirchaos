# choirchaos — Project Memory

Verify code references before relying on them; memories are point-in-time observations.

---

## Project

Choir accompaniment web app: PDF score + real-time MIDI or audio playback.

**Stack:** Vue 3, Vite, TypeScript, Pinia, PrimeVue, Tailwind, PocketBase, Web Audio API, `webaudiofont`, `rubberband-web`, `pdfjs-dist`.

**Two playback modes:**
- MIDI: `.mid` + MTIMidiJson `.json` (tick-to-measure/beat mapping)
- Audio: `.mp3`/`.wav` per track, pitch/tempo-shifted via `rubberband-web`

`tmp/exampleMidi/` is proprietary — format reference only, never copy content.

---

## Coding Style

- Avoid comments. Prefer clear names and extracting expressions into named constants/functions.
- No special characters in comments (no emojis, arrows, decorative lines).
- After larger edits, re-read the whole file as one unit to make sure it reads coherently.
- Avoid nesting. Prefer early returns and extracted functions over nested conditionals, but only if that results in clearer code.

---

## Player Architecture

**Key files:** `src/core/player/engine.ts` (PlayerEngine), `backend.ts` (abstract), `midi/backend.ts` (MidiBackend), `audio/backend.ts` (AudioBackend), `audio/driver.ts` (AudioDriver), `src/core/midi/warp.ts` (WarpMap), `src/core/utils/events.ts` (Property/Emitter), `src/composables/event.ts` (useEvent).

**Conventions:**
- No `_` prefixes — TypeScript access modifiers enforce privacy. `_` only for ignored callback args.
- No TypeScript getters — use `get*()`/`is*()` methods for public read access.
- Reactive state uses `Property<T>` (fires `on*Change`). Fire-and-forget events use `Emitter<T>`. Both return `Disposable` on subscription.
- `Property<void>`: call `fire(undefined)`.
- `useEvent()` requires an active Vue effect scope.

**WarpMap vs SongWarpMarker — critical distinction:**
- `WarpMap` (warp.ts) takes integer array indices.
- `SongWarpMarker` (models/song.ts) stores `{ measure: Numbering, time: number }` where `measure` is a string like `"1"` or `"2a"` — stable across reordering. AudioBackend converts via `findIndex` before passing to WarpMap; unmatched markers are silently dropped.
- `Song.deserialize()` migrates legacy integer-index markers to Numbering strings.

**Key engine invariants:**
- `unload()` resets all `current*` Properties, `vamps`, and `mode` — do not rely on `load()` to clear stale state.
- Seek order in `syncStateAt`: `backend.seek(pos)` BEFORE `backend.onTempoRestored(bpm)`.
- `syncWarp()` (audio mode): re-resolves warp/vamp ticks and resyncs display properties. Does NOT touch `currentSegue` and does NOT seek the backend.
- End-of-song fires in the same step as overshoot (`pos >= duration`).
- `MeasureReference` is `[MeasureNumber, BeatNumber]` where BeatNumber is 0-based.
- `$beatTicks`/`$tickLength` on Measure are populated by AudioBackend during `buildWarpEvents()`.

**Vamp API on PlayerEngine:**
- `exitVamp()`, `resetVamp()`, `toggleVamp()` — manipulate `manualExit`/`currentIteration` on the current vamp.
- `setVampsEnabled(enabled)` — global toggle; disabling force-exits any active vamp and makes `vampAt()` return `undefined`.
- `VampOut = "onEnd" | "anyBar" | "anyBeat"`, `VampVocals = "all" | "first" | "last" | "split"` (from `src/core/models/measureEvent.ts`, re-exported from `types.ts`).
- `VampPhase = "entering" | "repeating" | "exiting"`. Phase passed as 4th arg to `backend.step()`; AudioBackend uses it to mute Vocal tracks during `"repeating"`.

**AudioDriver:** `scheduleSeek()` does a crossfade seek (for vamp jumps); `seek()` is a hard cut (initial seeks only). `AUDIO_LOOKAHEAD = 0.1` must match MIDI's `AUDIO_CLOCK_OFFSET`.

**Store (src/stores/player.ts):** Uses `useEvent()` for all engine-reactive values. `loading`/`ready` are plain `computed()` from `status`.

---

## Testing

**Linting:** Always run `npm run lint:fix`. Never fix formatting manually.

**Mandatory mocks** for any file importing MidiPlayer or AudioPlayer (not needed if `audioPlayer` itself is mocked):

```typescript
vi.mock("midi-json-parser", () => ({
  parseArrayBuffer: vi.fn().mockResolvedValue({ tracks: [] }),
}));

vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));
```

**afterEach:** Use `vi.clearAllMocks()`, NOT `vi.resetAllMocks()`. Reset destroys `mockResolvedValue`/`mockReturnValue` set in `vi.mock()` factories.

**Test infra:** `src/test/setup.ts` (polyfills), `src/test/updater.ts` (ManualUpdater), `src/test/midi.ts` (buildMidiBuffer), `src/test/fixtures.ts` (song factories, TICKS constants).

**Tick layout** (120 BPM, ppqn=480):
```
Measure "0" (pickup, 1 beat): tick    0
Measure "1" (4/4):            tick  480
Measure "2" (4/4):            tick 2400
Measure "3" (4/4, 140 BPM):  tick 4320
Measure "4" (4/4):            tick 6240
Measure "5" (terminal/dur):   tick 8160
```

**stepPast pattern** — extra flush step needed because end-of-song/segue fires one step after overshoot:
```typescript
function stepPast(updater: ManualUpdater, player: MidiPlayer, targetTick: number): void {
  for (let i = 0; i < 10_000; i++) {
    if (player.position > targetTick || !updater.running) break;
    updater.step(0.02);
  }
  if (updater.running) updater.step(0.02);
}
```

**Vamp loop pattern** — `currentVamp` is undefined until the playhead enters the region:
```typescript
for (let i = 0; i < 10_000 && vp.currentVamp === undefined; i++) vu.step(0.02);
for (let i = 0; i < 10_000 && vp.currentVamp !== undefined; i++) vu.step(0.02);
```

**Audio vamp tests:**
- MockAudioDriver must include `scheduleSeek` — vamp jumps call `scheduleSeek`, not `seek`.
- Wire it so `getPosition` stays in sync: `ap.scheduleSeek.mockImplementation(pos => ap.getPosition.mockReturnValue(pos))`.
- Clear `seek`/`scheduleSeek` after `load()` — initial seek to 0 pollutes call counts.
- Vamp entry needs two steps: one to enter the region, one to hit the end and trigger the jump.

**Audio test fixtures:** `makeAudioSong()`, `makeAudioSongWithVamp()`, `makeAudioSongWithVocalVamp(vocals?)`, `makeAudioSongWithVampOut(out)`. Vamp fixtures use markers `[{measure:"1", time:0}, {measure:"3", time:0.5}]` (0.25 s/measure).

**Silent failure traps:**
- `setSegueEnabled()` does nothing if `load()` never ran (segue never initialized).
- Missing `$beatTicks` in JSON mocks causes silent breakage in vamp/duration logic.
- In audio tests, `setGain(1, 0)` = vocal track muted; clear the spy before the asserting step.
