import { defineStore } from "pinia";
import { ref, type Ref } from "vue";

const STORE_NAME = "settings";
const LOCAL_STORAGE_KEY = "choirchaosSettings";

export type UiSettings = {
  selectedTab: "markers" | "pdf" | "mixer";
  panelVisible: {
    markers: boolean;
    mixer: boolean;
  };
};

export type MixerSettings = {
  dummy: null;
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
      dummy: null,
    },
  };
}

function loadSettings(): Settings {
  if (localStorage.getItem(LOCAL_STORAGE_KEY)) {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
  } else {
    return getDefaultSettings();
  }
}

function storeSettings(settings: Settings) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
}

function clearSettings() {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export const useSettingsStore = defineStore(STORE_NAME, () => {
  const settings: Ref<Settings> = ref(loadSettings());
  console.log(settings.value);

  const updateSelectedTab = (tab: UiSettings["selectedTab"]) => {
    settings.value.ui.selectedTab = tab;
    storeSettings(settings.value);
  };
  const updatePanelVisible = (panel: keyof UiSettings["panelVisible"], visible: boolean) => {
    settings.value.ui.panelVisible[panel] = visible;
    storeSettings(settings.value);
  };
  const togglePanelVisible = (panel: keyof UiSettings["panelVisible"]) => {
    updatePanelVisible(panel, !settings.value.ui.panelVisible[panel]);
  };

  const clear = () => {
    settings.value = getDefaultSettings();
    clearSettings();
  };

  return {
    current: settings,
    updateSelectedTab,
    updatePanelVisible,
    togglePanelVisible,
    clear,
  };
});
