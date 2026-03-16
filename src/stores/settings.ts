import { defineStore } from "pinia";
import { type Ref, ref } from "vue";

const STORE_NAME = "settings";
const LOCAL_STORAGE_KEY = "choirchaosSettings";

export type UiSettings = {
  selectedTab: "markers" | "pdf" | "mixer";
  panelVisible: {
    markers: boolean;
    mixer: boolean;
  };
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

export type Settings = {
  ui: UiSettings;
  mixer: MixerSettings;
};

function getDefaultSettings(): Settings {
  return {
    ui: {
      selectedTab: "pdf",
      panelVisible: {
        markers: true,
        mixer: true,
      },
    },
    mixer: {
      tracks: {},
    },
  };
}

function loadSettings(): Settings {
  if (localStorage.getItem(LOCAL_STORAGE_KEY)) {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    // Migrate from older format that had { dummy: null } instead of { tracks: {} }
    if (!parsed.mixer?.tracks) {
      parsed.mixer = { tracks: {} };
    }
    return parsed as Settings;
  } else {
    return getDefaultSettings();
  }
}

function storeSettings(settings: Settings): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
}

function clearSettings(): void {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export const useSettingsStore = defineStore(STORE_NAME, () => {
  const settings: Ref<Settings> = ref(loadSettings());

  function updateSelectedTab(tab: UiSettings["selectedTab"]): void {
    settings.value.ui.selectedTab = tab;
    storeSettings(settings.value);
  }

  function updatePanelVisible(panel: keyof UiSettings["panelVisible"], visible: boolean): void {
    settings.value.ui.panelVisible[panel] = visible;
    storeSettings(settings.value);
  }

  function togglePanelVisible(panel: keyof UiSettings["panelVisible"]): void {
    updatePanelVisible(panel, !settings.value.ui.panelVisible[panel]);
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
    storeSettings(settings.value);
  }

  function clear(): void {
    settings.value = getDefaultSettings();
    clearSettings();
  }

  return {
    current: settings,
    updateSelectedTab,
    updatePanelVisible,
    togglePanelVisible,
    getTrackMixer,
    updateTrackMixer,
    clear,
  };
});
