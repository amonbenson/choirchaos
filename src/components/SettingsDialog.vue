<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import SelectButton from "primevue/selectbutton";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import ToggleSwitch from "primevue/toggleswitch";
import { computed, ref, watch } from "vue";

import type { ShortcutAction } from "@/composables/useGlobalShortcuts";
import type { AppearanceSettings, TransportButtonKey } from "@/stores/settings";
import { useSettingsStore } from "@/stores/settings";

import KbdShortcut from "./KbdShortcut.vue";

const visible = defineModel<boolean>({ default: false });
const settings = useSettingsStore();

// --- Appearance --------------------------------------------------------------

const TRANSPORT_BUTTON_LABELS: Record<TransportButtonKey, string> = {
  measure: "Measure",
  transposition: "Transpose",
  tempo: "Tempo",
  timeSignature: "Time Sig.",
  vamp: "Vamp",
  segue: "Segue",
};

const THEME_OPTIONS: { label: string; value: AppearanceSettings["theme"] }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const theme = computed({
  get: () => settings.current.appearance.theme,
  set: (value: AppearanceSettings["theme"]) => settings.update({ appearance: { theme: value } }),
});

// Transport buttons as array instead of boolean map
const transportButtons = computed({
  get: () => Object.entries(settings.current.appearance.transportButtonVisible)
    .filter(([, visible]) => visible)
    .map(([key]) => key as TransportButtonKey),
  set: (visibleButtons: TransportButtonKey[]) => {
    const updated = Object.fromEntries(
      Object.keys(TRANSPORT_BUTTON_LABELS).map(key => [key, visibleButtons.includes(key as TransportButtonKey)]),
    ) as Record<TransportButtonKey, boolean>;
    settings.update({ appearance: { transportButtonVisible: updated as any } });
  },
});

// --- Keyboard shortcuts ------------------------------------------------------

const ACTION_LABELS: Record<ShortcutAction, string> = {
  playPause: "Play / Pause",
  previousMeasure: "Previous Measure",
  nextMeasure: "Next Measure",
  rewind: "Rewind",
  forward: "Forward",
  toggleVamp: "Toggle Vamp",
  toggleSegue: "Toggle Segue",
};

const ACTIONS = Object.keys(ACTION_LABELS) as ShortcutAction[];

const recording = ref<ShortcutAction | null>(null);

function getBinding(action: ShortcutAction): string | undefined {
  return Object.entries(settings.current.shortcuts.bindings).find(([, a]) => a === action)?.[0];
}

function startRecording(action: ShortcutAction): void {
  recording.value = action;
}

function clearBinding(action: ShortcutAction): void {
  const bindings = Object.fromEntries(
    Object.entries(settings.current.shortcuts.bindings).filter(([, a]) => a !== action),
  ) as Record<string, ShortcutAction>;
  settings.update({ shortcuts: { bindings } });
}

// Cancel recording when the dialog is closed.
watch(visible, (v) => {
  if (!v) {
    recording.value = null;
  }
});

// Key capture runs in the capture phase so it intercepts before the global
// shortcut handler. stopPropagation prevents the shortcut from also firing.
useEventListener(window, "keydown", (e: KeyboardEvent) => {
  if (!recording.value) {
    return;
  }

  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  if (e.key === "Escape") {
    recording.value = null;
    return;
  }

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) {
    parts.push("Mod");
  }

  if (e.shiftKey) {
    parts.push("Shift");
  }

  if (e.altKey) {
    parts.push("Alt");
  }

  parts.push(e.key);

  const combo = parts.join("+");

  const bindings = Object.fromEntries(
    Object.entries(settings.current.shortcuts.bindings).filter(([, a]) => a !== recording.value),
  ) as Record<string, ShortcutAction>;
  bindings[combo] = recording.value!;
  settings.update({ shortcuts: { bindings } });
  recording.value = null;
}, { capture: true });
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="Settings"
    modal
    dismissable-mask
    pt:root:class="w-[50rem] max-w-[calc(100vw-2rem)]"
  >
    <Tabs value="appearance">
      <TabList>
        <Tab value="appearance">
          Appearance
        </Tab>
        <Tab value="playback">
          Playback
        </Tab>
        <Tab value="shortcuts">
          Keyboard Shortcuts
        </Tab>
      </TabList>

      <TabPanels class="h-128 overflow-y-auto">
        <!-- Appearance -->
        <TabPanel value="appearance">
          <div class="flex flex-col gap-6 py-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="font-medium">
                  Theme
                </div>
                <div class="text-sm text-muted-color">
                  Controls the color scheme of the application.
                </div>
              </div>
              <SelectButton
                v-model="theme"
                :options="THEME_OPTIONS"
                option-label="label"
                option-value="value"
                :allow-empty="false"
              />
            </div>
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="font-medium">
                  Merge accompaniment tracks
                </div>
                <div class="text-sm text-muted-color">
                  Combine all accompaniment tracks into a single track in the mixer.
                </div>
              </div>
              <ToggleSwitch
                :model-value="settings.current.appearance.mergeAccompaniment"
                @update:model-value="settings.update({ appearance: { mergeAccompaniment: $event } })"
              />
            </div>
            <div class="flex flex-col gap-2">
              <div>
                <div class="font-medium">
                  Transport bar buttons
                </div>
                <div class="text-sm text-muted-color">
                  Choose which controls are visible in the transport bar.
                </div>
              </div>
              <!-- <div class="flex gap-4 rounded bg-black p-2">
                <Button
                  v-for="(label, key) in TRANSPORT_BUTTON_LABELS"
                  :key="key"
                  :label="label"
                  :severity="settings.current.appearance.transportButtonVisible[key as TransportButtonKey] ? 'primary' : 'secondary'"
                  size="small"
                  fluid
                  @click="settings.updateAppearance({ transportButtonVisible: { ...settings.current.appearance.transportButtonVisible, [key]: !settings.current.appearance.transportButtonVisible[key as TransportButtonKey] } })"
                />
              </div> -->
              <SelectButton
                v-model="transportButtons"
                :options="Object.entries(TRANSPORT_BUTTON_LABELS).map(([key, label]) => ({ label, value: key }))"
                option-label="label"
                option-value="value"
                multiple
                fluid
              />
            </div>
          </div>
        </TabPanel>

        <!-- Playback -->
        <TabPanel value="playback">
          <div class="flex flex-col gap-6 py-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="font-medium">
                  Auto-advance on segue
                </div>
                <div class="text-sm text-muted-color">
                  Automatically move to the next song when a segue is triggered.
                </div>
              </div>
              <ToggleSwitch
                :model-value="settings.current.playback.segueEnabled"
                @update:model-value="settings.update({ playback: { segueEnabled: $event } })"
              />
            </div>
          </div>
        </TabPanel>

        <!-- Keyboard Shortcuts -->
        <TabPanel value="shortcuts">
          <div class="py-2">
            <div
              v-for="action in ACTIONS"
              :key="action"
              class="flex items-center justify-between gap-4 border-b border-surface-200 py-3 last:border-b-0 dark:border-surface-700"
            >
              <span class="text-sm">{{ ACTION_LABELS[action] }}</span>
              <div class="flex items-center gap-2">
                <!-- Recording state -->
                <button
                  v-if="recording === action"
                  class="animate-pulse cursor-default rounded border border-primary px-3 py-1 text-sm text-primary"
                >
                  Press a key...
                </button>
                <!-- Bound -->
                <button
                  v-else-if="getBinding(action)"
                  class="rounded px-2 py-1 text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
                  title="Click to rebind"
                  @click="startRecording(action)"
                >
                  <KbdShortcut :action="action" />
                </button>
                <!-- Unbound -->
                <button
                  v-else
                  class="rounded px-2 py-1 text-sm text-muted-color hover:bg-surface-100 dark:hover:bg-surface-800"
                  title="Click to bind"
                  @click="startRecording(action)"
                >
                  Not bound
                </button>
                <!-- Cancel recording -->
                <Button
                  v-if="recording === action"
                  icon="pi pi-times"
                  severity="secondary"
                  size="small"
                  text
                  rounded
                  aria-label="Cancel"
                  @click="recording = null"
                />
                <!-- Clear binding -->
                <Button
                  v-else-if="getBinding(action)"
                  icon="pi pi-times"
                  severity="secondary"
                  size="small"
                  text
                  rounded
                  aria-label="Clear binding"
                  @click="clearBinding(action)"
                />
                <!-- Spacer to keep row height consistent when there's no button -->
                <div
                  v-else
                  class="size-8"
                />
              </div>
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </Dialog>
</template>
