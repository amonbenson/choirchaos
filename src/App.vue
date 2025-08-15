<script setup lang="ts">
import { RouterView, useRouter } from "vue-router";
import { login } from "./pocketbase/auth";
import { onMounted } from "vue";

const router = useRouter();

onMounted(async () => {
  // auto-login
  if (import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"]) {
    console.info(`Auto-login activated. Trying to log in with email '${import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"]}'`);
    const res = await login(import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"], import.meta.env["VITE_PB_AUTOLOGIN_PASS"]);
    console.info(`Logged in as '${res.record.name}'`);
  }
});
</script>

<template>
  <RouterView />
</template>
