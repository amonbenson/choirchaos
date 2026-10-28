<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import HeaderBar from "@/components/header/HeaderBar.vue";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isShowPath = computed(() => route.path.startsWith("/show/"));

const message = computed(() => {
  if (!isShowPath.value) {
    return "There is nothing at this address. The link may be mistyped or out of date.";
  }

  return auth.user
    ? "This show does not exist, or it has not been shared with you. Ask the person who sent you the link to share it with your account."
    : "This show does not exist, or it is private. Sign in if it has been shared with you.";
});

function signIn(): void {
  router.push({ name: "login", query: { redirect: route.fullPath } });
}
</script>

<template>
  <div class="flex size-full flex-col gap-2 p-2">
    <HeaderBar class="relative z-10" />

    <main class="flex flex-1 items-center justify-center overflow-y-auto p-4">
      <div class="flex max-w-md flex-col items-center gap-4 text-center">
        <span class="text-7xl font-bold text-primary-text">404</span>
        <h2 class="text-2xl font-semibold">
          {{ isShowPath ? "Show not found" : "Page not found" }}
        </h2>
        <p class="text-muted-color">
          {{ message }}
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <Button
            label="Go to home page"
            icon="pi pi-home"
            @click="router.push({ name: 'home' })"
          />
          <Button
            v-if="isShowPath && !auth.user"
            label="Sign in"
            icon="pi pi-sign-in"
            severity="secondary"
            @click="signIn"
          />
        </div>
      </div>
    </main>
  </div>
</template>
