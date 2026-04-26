<script setup lang="ts">
import Button from "primevue/button";
import { onMounted, type Ref, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

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

    <div class="relative z-0 flex size-full flex-1 items-center justify-center gap-4 overflow-hidden">
      <div
        v-for="show in shows"
        :key="show.id"
        class="relative size-64 cursor-pointer rounded bg-cover bg-center"
        :style="{
          backgroundImage: show.thumbnail && `url(${resolveUrl(show.thumbnail, 'shows', show.id)})`
        }"
        @click="router.push({ name: 'show', params: { showId: show.id } })"
      >
        <div class="absolute inset-0 flex size-full items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
          <i class="pi pi-play-circle text-8xl text-white" />
          <!--           <div class="text-center text-2xl font-bold">
            {{ show.title }}
          </div> -->
        </div>
      </div>
    </div>
  </div>
</template>
