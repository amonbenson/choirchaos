import { AudioContext, OfflineAudioContext } from "node-web-audio-api";
import { vi } from "vitest";

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
