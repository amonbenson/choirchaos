<script setup lang="ts">
import { computed } from "vue";

import type { ShortcutAction } from "@/composables/useGlobalShortcuts";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  action: ShortcutAction;
}>();

const settingsStore = useSettingsStore();

const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  "ArrowLeft": "←",
  "ArrowRight": "→",
  "ArrowUp": "↑",
  "ArrowDown": "↓",
  "Escape": "Esc",
  "Enter": "↵",
  "Backspace": "⌫",
  "Delete": "Del",
  "Tab": "⇥",
  "Home": "Home",
  "End": "End",
  "PageUp": "PgUp",
  "PageDown": "PgDn",
};

const MODIFIER_LABELS: Record<string, string> = {
  Mod: "Ctrl",
  Meta: "⌘",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

const MODIFIER_LABELS_MAC: Record<string, string> = {
  Mod: "⌘",
  Meta: "⌘",
  Ctrl: "^",
  Shift: "⇧",
  Alt: "⌥",
};

function formatKey(key: string): string {
  // Lookup modifier labels
  if (Object.keys(MODIFIER_LABELS).includes(key)) {
    return (isMac ? MODIFIER_LABELS_MAC : MODIFIER_LABELS)[key];
  }

  // Lookup normal key label or use letter/number
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

// Find the first binding for this action (reactive to settings changes).
const parts = computed(() => {
  const entry = Object.entries(settingsStore.current.shortcuts)
    .find(([, action]) => action === props.action);
  if (!entry) {
    return [];
  }

  return entry[0].split("+").map(formatKey);
});
</script>

<template>
  <span
    v-if="parts.length > 0"
    class="inline-flex items-center gap-1"
  >
    <template
      v-for="(part, i) in parts"
      :key="i"
    >
      <kbd class="-my-0.5">{{ part }}</kbd>
      <span
        v-if="i < parts.length - 1"
        class="text-xs opacity-50"
      >+</span>
    </template>
  </span>
</template>
