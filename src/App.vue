<script setup lang="ts">
import { useEventListener, useMediaQuery } from "@vueuse/core";
import Button from "primevue/button";
import ConfirmDialog from "primevue/confirmdialog";
import Toast from "primevue/toast";
import { onMounted, watchEffect } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { UPDATE_TOAST_GROUP, useAppUpdate } from "./composables/useAppUpdate";
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

useAppUpdate();

function reload(): void {
  window.location.reload();
}

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
  <Toast
    position="bottom-center"
    :group="UPDATE_TOAST_GROUP"
  >
    <template #message="{ message }">
      <div class="flex flex-1 items-center gap-3">
        <span class="flex-1 font-medium">{{ message.summary }}</span>
        <Button
          label="Reload"
          size="small"
          @click="reload"
        />
      </div>
    </template>
  </Toast>
  <ConfirmDialog class="max-w-[calc(100vw-2rem)]" />
</template>
