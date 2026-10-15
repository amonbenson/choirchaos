import { AudioContext, OfflineAudioContext } from "node-web-audio-api";
import { vi } from "vitest";

// rubberband-web imports tone (broken ESM, extensionless imports) which fails in Node.
vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));

// midi-json-parser uses Web Workers, which are unavailable in Node.
vi.mock("midi-json-parser", async () => {
  const { PARSED_MIDI } = await import("./fixtures");
  return { parseArrayBuffer: vi.fn().mockResolvedValue(PARSED_MIDI) };
});

// jsdom's localStorage can be missing or broken in some vitest worker configurations.
// Provide a minimal in-memory implementation so pocketbase initialisation doesn't throw.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage?.getItem !== "function") {
  const _store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => _store[k] ?? null,
      setItem: (k: string, v: string) => {
        _store[k] = v;
      },
      removeItem: (k: string) => {
        delete _store[k];
      },
      clear: () => {
        Object.keys(_store).forEach(k => delete _store[k]);
      },
      get length() {
        return Object.keys(_store).length;
      },
      key: (i: number) => Object.keys(_store)[i] ?? null,
    },
    writable: true,
    configurable: true,
  });
}

Object.assign(globalThis, { AudioContext, OfflineAudioContext });

const mockWebAudioFontPlayerInstance = {
  queueWaveTable: vi.fn(),
  loader: {
    findInstrument: vi.fn(() => 0),
    instrumentInfo: vi.fn(() => ({ variable: "_tone_0_SoundFont_sf2", url: "" })),
    startLoad: vi.fn(),
    waitLoad: vi.fn((resolve: () => void) => resolve()),
  },
};

vi.stubGlobal("WebAudioFontPlayer", class {
  constructor() {
    return mockWebAudioFontPlayerInstance;
  }
});
