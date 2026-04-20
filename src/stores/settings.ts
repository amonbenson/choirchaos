import { defineStore } from "pinia";
import { type Ref, ref } from "vue";

import type { ShortcutAction } from "@/composables/useGlobalShortcuts";

// --- Types -------------------------------------------------------------------

export type WorkspaceSettings = {
  selectedTab: "markers" | "pdf" | "mixer";
  panelVisible: {
    markers: boolean;
    mixer: boolean;
  };
};

export type AppearanceSettings = {
  theme: "system" | "light" | "dark";
};

export type PlaybackSettings = {
  speed: number;
  transposition: number;
  segueEnabled: boolean;
  mergeAccompaniment: boolean;
};

export type TrackMixerEntry = {
  gain: number;
  mute: boolean;
  solo: boolean;
  highlight: boolean;
};

export type MixerSettings = {
  tracks: Record<string, TrackMixerEntry>;
};

// Maps key strings (e.g. "Mod+ArrowLeft") to named actions.
// Multiple keys can bind to the same action; one action may have no binding.
export type ShortcutSettings = Record<string, ShortcutAction>;

export type Settings = {
  readonly version: typeof SETTINGS_VERSION;
  workspace: WorkspaceSettings;
  appearance: AppearanceSettings;
  playback: PlaybackSettings;
  mixer: MixerSettings;
  shortcuts: ShortcutSettings;
};

// --- Versioning --------------------------------------------------------------
//
// Increment SETTINGS_VERSION when making breaking changes to the Settings
// shape. Stored settings from a different version are discarded entirely and
// replaced with defaults.
//
// For purely additive changes (new optional fields within an existing section),
// keep the version as-is - mergeWithDefaults will fill in the missing keys.
//
// To migrate stored settings non-destructively in a future version, add an
// entry to the `migrations` map below.

const SETTINGS_VERSION = 1;

// Typed migration chain for future use.
// Each entry migrates stored data from version N-1 to N.
// Example (version 2):
//   [2, (old: unknown) => ({ ...(old as Settings), newSection: { newField: 0 } })]
const migrations = new Map<number, (old: unknown) => unknown>();

// --- Defaults ----------------------------------------------------------------

function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    workspace: {
      selectedTab: "pdf",
      panelVisible: { markers: true, mixer: true },
    },
    appearance: {
      theme: "system",
    },
    playback: {
      speed: 1.0,
      transposition: 0,
      segueEnabled: true,
      mergeAccompaniment: true,
    },
    mixer: {
      tracks: {},
    },
    shortcuts: {
      " ": "playPause",
      "ArrowLeft": "previousMeasure",
      "ArrowRight": "nextMeasure",
      "Mod+ArrowLeft": "rewind",
      "Mod+ArrowRight": "forward",
      "v": "toggleVamp",
      "s": "toggleSegue",
    },
  } satisfies Settings;
}

// --- Type guards -------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<const T extends readonly unknown[]>(v: unknown, options: T): v is T[number] {
  return (options as readonly unknown[]).includes(v);
}

// Kept in sync with the ShortcutAction union - the `satisfies` ensures a
// compile error if the two ever diverge.
const SHORTCUT_ACTIONS = [
  "playPause",
  "previousMeasure",
  "nextMeasure",
  "rewind",
  "forward",
  "toggleVamp",
  "toggleSegue",
] as const satisfies readonly ShortcutAction[];

function isShortcutAction(v: unknown): v is ShortcutAction {
  return isOneOf(v, SHORTCUT_ACTIONS);
}

function isTrackMixerEntry(v: unknown): v is TrackMixerEntry {
  return (
    isObject(v)
    && typeof v.gain === "number"
    && typeof v.mute === "boolean"
    && typeof v.solo === "boolean"
    && typeof v.highlight === "boolean"
  );
}

// --- Merge -------------------------------------------------------------------
//
// Merges a parsed (potentially partial/unknown) stored object with the
// defaults, field by field. For each scalar, uses the stored value if it passes
// a type check; otherwise falls back to the default. User-data records
// (mixer.tracks, shortcuts) are validated entry-by-entry and used wholesale.
//
// When adding a new field to Settings, add the corresponding merge clause here.
// The `satisfies Settings` on the return value will produce a compile error for
// any missing field.

function mergeWithDefaults(defaults: Settings, raw: Record<string, unknown>): Settings {
  const workspace = isObject(raw.workspace) ? raw.workspace : {};
  const panelVisible = isObject(workspace.panelVisible) ? workspace.panelVisible : {};
  const appearance = isObject(raw.appearance) ? raw.appearance : {};
  const playback = isObject(raw.playback) ? raw.playback : {};
  const mixer = isObject(raw.mixer) ? raw.mixer : {};

  return {
    version: SETTINGS_VERSION,
    workspace: {
      selectedTab: isOneOf(workspace.selectedTab, ["markers", "pdf", "mixer"] as const)
        ? workspace.selectedTab
        : defaults.workspace.selectedTab,
      panelVisible: {
        markers: typeof panelVisible.markers === "boolean"
          ? panelVisible.markers
          : defaults.workspace.panelVisible.markers,
        mixer: typeof panelVisible.mixer === "boolean"
          ? panelVisible.mixer
          : defaults.workspace.panelVisible.mixer,
      },
    },
    appearance: {
      theme: isOneOf(appearance.theme, ["system", "light", "dark"] as const)
        ? appearance.theme
        : defaults.appearance.theme,
    },
    playback: {
      speed: typeof playback.speed === "number"
        ? playback.speed
        : defaults.playback.speed,
      transposition: typeof playback.transposition === "number"
        ? playback.transposition
        : defaults.playback.transposition,
      segueEnabled: typeof playback.segueEnabled === "boolean"
        ? playback.segueEnabled
        : defaults.playback.segueEnabled,
      mergeAccompaniment: typeof playback.mergeAccompaniment === "boolean"
        ? playback.mergeAccompaniment
        : defaults.playback.mergeAccompaniment,
    },
    mixer: {
      tracks: isObject(mixer.tracks)
        ? Object.fromEntries(
            Object.entries(mixer.tracks)
              .filter((entry): entry is [string, TrackMixerEntry] => isTrackMixerEntry(entry[1])),
          )
        : defaults.mixer.tracks,
    },
    shortcuts: isObject(raw.shortcuts)
      ? Object.fromEntries(
          Object.entries(raw.shortcuts)
            .filter((entry): entry is [string, ShortcutAction] => isShortcutAction(entry[1])),
        )
      : defaults.shortcuts,
  } satisfies Settings;
}

// --- Persistence -------------------------------------------------------------

const LOCAL_STORAGE_KEY = "choirchaosSettings";

function loadSettings(): Settings {
  const defaults = defaultSettings();

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    let parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return defaults;
    }

    const storedVersion = parsed.version;

    // Run any available migrations to bring stored data up to the current version.
    if (typeof storedVersion === "number" && storedVersion < SETTINGS_VERSION) {
      for (let v = storedVersion + 1; v <= SETTINGS_VERSION; v++) {
        const migrate = migrations.get(v);
        if (migrate) {
          parsed = migrate(parsed);
          if (!isObject(parsed)) {
            return defaults;
          }
        }
      }
    }

    // After migrations, if the version still doesn't match, discard.
    if ((parsed as Record<string, unknown>).version !== SETTINGS_VERSION) {
      return defaults;
    }

    return mergeWithDefaults(defaults, parsed);
  } catch {
    return defaults;
  }
}

function saveSettings(settings: Settings): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
}

// --- Store -------------------------------------------------------------------

const STORE_NAME = "settings";

export const useSettingsStore = defineStore(STORE_NAME, () => {
  const settings: Ref<Settings> = ref(loadSettings());

  function updateWorkspace(update: Partial<WorkspaceSettings>): void {
    settings.value.workspace = { ...settings.value.workspace, ...update };
    saveSettings(settings.value);
  }

  function updatePanelVisible(panel: keyof WorkspaceSettings["panelVisible"], visible: boolean): void {
    settings.value.workspace.panelVisible[panel] = visible;
    saveSettings(settings.value);
  }

  function togglePanelVisible(panel: keyof WorkspaceSettings["panelVisible"]): void {
    updatePanelVisible(panel, !settings.value.workspace.panelVisible[panel]);
  }

  const DEFAULT_TRACK_MIXER: TrackMixerEntry = { gain: 1.0, mute: false, solo: false, highlight: false };

  function isDefaultTrackMixer(entry: TrackMixerEntry): boolean {
    return entry.gain === 1.0 && !entry.mute && !entry.solo && !entry.highlight;
  }

  function getTrackMixer(trackTitle: string): TrackMixerEntry {
    return settings.value.mixer.tracks[trackTitle] ?? { ...DEFAULT_TRACK_MIXER };
  }

  function updateTrackMixer(trackTitle: string, update: Partial<TrackMixerEntry>): void {
    const current = settings.value.mixer.tracks[trackTitle] ?? { ...DEFAULT_TRACK_MIXER };
    const updated = { ...current, ...update };
    if (isDefaultTrackMixer(updated)) {
      delete settings.value.mixer.tracks[trackTitle];
    } else {
      settings.value.mixer.tracks[trackTitle] = updated;
    }

    saveSettings(settings.value);
  }

  function updateAppearance(update: Partial<AppearanceSettings>): void {
    settings.value.appearance = { ...settings.value.appearance, ...update };
    saveSettings(settings.value);
  }

  function updatePlayback(update: Partial<PlaybackSettings>): void {
    settings.value.playback = { ...settings.value.playback, ...update };

    // Reset track mixer settings if merging was changed
    if (update.mergeAccompaniment !== undefined) {
      settings.value.mixer.tracks = {};
    }

    saveSettings(settings.value);
  }

  function updateShortcuts(shortcuts: ShortcutSettings): void {
    settings.value.shortcuts = shortcuts;
    saveSettings(settings.value);
  }

  function clear(): void {
    settings.value = defaultSettings();
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  return {
    current: settings,
    updateWorkspace,
    updatePanelVisible,
    togglePanelVisible,
    updateAppearance,
    getTrackMixer,
    updateTrackMixer,
    updatePlayback,
    updateShortcuts,
    clear,
  };
});
