<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";

import HeaderBar from "@/components/HeaderBar.vue";
import Show from "@/core/models/show";
import { resolveUrl } from "@/core/utils/file";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

const shows = ref<Show[]>([]);

// Fetch shows when logged in state changes
watch(() => auth.user, async () => {
  shows.value = await Show.list();

  // If the user is not signed in and now shows are displayed, redirect them to the auth page
  if (!auth.user && shows.value.length === 0) {
    router.push({ name: "login" });
  }
}, { immediate: true });
</script>

<template>
  <div class="flex size-full flex-col gap-2 p-2">
    <HeaderBar class="relative z-10" />

    <div class="relative z-0 flex-1 overflow-y-auto">
      <div class="flex min-h-full flex-wrap content-center justify-center gap-4 p-2">
        <div
          v-for="show in shows"
          :key="show.id"
          class="group flex w-40 cursor-pointer flex-col gap-2 sm:w-64"
          @click="router.push({ name: 'show', params: { showId: show.id } })"
        >
          <div
            class="relative flex aspect-square items-center justify-center overflow-hidden rounded bg-surface-200 bg-cover bg-center dark:bg-surface-800"
            :style="{
              backgroundImage: show.thumbnail && `url(${resolveUrl(show.thumbnail, 'shows', show.id)})`
            }"
          >
            <i
              v-if="!show.thumbnail"
              class="pi pi-book text-5xl text-muted-color sm:text-7xl"
            />
            <div class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <i class="pi pi-play-circle text-6xl text-white sm:text-8xl" />
            </div>
          </div>
          <div
            class="truncate text-center font-medium text-color"
            :title="show.title"
          >
            {{ show.title }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
