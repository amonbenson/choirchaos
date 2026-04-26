import { defineStore } from "pinia";
import { type Ref, ref } from "vue";

import { AppearanceSettings } from "./appearance";
import { type DataOf, type DeepPartial, isPlainObject, SettingsBase } from "./base";
import { DEFAULT_TRACK_MIXER, isDefaultTrackMixer, MixerSettings, type TrackMixerEntry } from "./mixer";
import { PlaybackSettings } from "./playback";
import { ShortcutSettings } from "./shortcuts";
import { PanelVisibleSettings, WorkspaceSettings } from "./workspace";

// --- Root settings class -----------------------------------------------------

class Settings extends SettingsBase {
  constructor(
    public readonly workspace: WorkspaceSettings = new WorkspaceSettings(),
    public readonly appearance: AppearanceSettings = new AppearanceSettings(),
    public readonly playback: PlaybackSettings = new PlaybackSettings(),
    public readonly mixer: MixerSettings = new MixerSettings(),
    public readonly shortcuts: ShortcutSettings = new ShortcutSettings(),
  ) {
    super();
  }
}

// --- Versioning --------------------------------------------------------------
//
// Increment SETTINGS_VERSION when making breaking changes to the Settings
// shape. Stored settings from a different version are discarded entirely and
// replaced with defaults.
//
// For additive changes (new fields with defaults), keep the version as-is —
// fromPartial fills in missing keys automatically.

const SETTINGS_VERSION = 1;

// --- Persistence -------------------------------------------------------------

const STORAGE_KEY = "choirchaosSettings";

function loadSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!isPlainObject(raw) || raw.version !== SETTINGS_VERSION) {
      return new Settings();
    }

    return new Settings().fromPartial(raw);
  } catch {
    return new Settings();
  }
}

function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...settings }));
}

// --- Store -------------------------------------------------------------------

export const useSettingsStore = defineStore("settings", () => {
  const current: Ref<Settings> = ref(loadSettings());

  function update(patch: DeepPartial<Settings>): void {
    current.value = current.value.update(patch);

    // Cross-group side effect: reset per-track mixer state when the track
    // grouping mode changes, since old keys would refer to the wrong tracks.
    if (patch.appearance?.mergeAccompaniment !== undefined) {
      current.value = current.value.update({ mixer: { tracks: {} } });
    }

    saveSettings(current.value);
  }

  function togglePanelVisible(panel: keyof DataOf<PanelVisibleSettings>): void {
    update({ workspace: { panelVisible: { [panel]: !current.value.workspace.panelVisible[panel] } } });
  }

  function getTrackMixer(trackTitle: string): TrackMixerEntry {
    return current.value.mixer.tracks[trackTitle] ?? { ...DEFAULT_TRACK_MIXER };
  }

  function updateTrackMixer(trackTitle: string, patch: Partial<TrackMixerEntry>): void {
    const updated = { ...(current.value.mixer.tracks[trackTitle] ?? DEFAULT_TRACK_MIXER), ...patch };
    const tracks = { ...current.value.mixer.tracks };
    if (isDefaultTrackMixer(updated)) {
      delete tracks[trackTitle];
    } else {
      tracks[trackTitle] = updated;
    }

    update({ mixer: { tracks } });
  }

  function clear(): void {
    current.value = new Settings();
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    current,
    update,
    togglePanelVisible,
    getTrackMixer,
    updateTrackMixer,
    clear,
  };
});

// --- Re-exports for consumers ------------------------------------------------

export { AppearanceSettings, type TransportButtonKey, TransportButtonSettings } from "./appearance";
export type { DataOf, DeepPartial } from "./base";
export { MixerSettings, type TrackMixerEntry } from "./mixer";
export { PlaybackSettings } from "./playback";
export { ShortcutSettings } from "./shortcuts";
export { PanelVisibleSettings, WorkspaceSettings } from "./workspace";
export type { Settings };
