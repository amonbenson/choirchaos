<script setup lang="ts">
import { useEventListener, useMediaQuery } from "@vueuse/core";
import ConfirmDialog from "primevue/confirmdialog";
import Toast from "primevue/toast";
import { onMounted, watchEffect } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { login } from "./pocketbase/auth";
import { useSettingsStore } from "./stores/settings";

const settings = useSettingsStore();
const systemPrefersDark = useMediaQuery("(prefers-color-scheme: dark)");

watchEffect(() => {
  const { theme } = settings.current.appearance;
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark.value);
  document.documentElement.classList.toggle("dark", isDark);
});

// Browsers zoom the whole page on ctrl or cmd and wheel, and on trackpad pinch, which they report the same
// way. The score and the timeline handle these gestures first and zoom themselves.
useEventListener(window, "wheel", (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
}, { passive: false });

const router = useRouter();
const route = useRoute();

onMounted(async () => {
  // auto-login
  if (import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"]) {
    console.info(`Auto-login activated. Trying to log in with email '${import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"]}'`);
    const res = await login(import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"], import.meta.env["VITE_PB_AUTOLOGIN_PASS"]);
    console.info(`Logged in as '${res.record.name}'`);
  }

  // auto-select show
  if (route.name === "home" && import.meta.env["VITE_PB_AUTOLOGIN_SHOW"]) {
    router.push(`/show/${import.meta.env["VITE_PB_AUTOLOGIN_SHOW"]}`);
  }
});
</script>

<template>
  <RouterView />
  <Toast position="bottom-right" />
  <ConfirmDialog class="max-w-[calc(100vw-2rem)]" />
</template>
