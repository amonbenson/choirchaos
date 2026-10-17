<script setup lang="ts">
import Button from "primevue/button";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import { computed, ref } from "vue";
import type { RouteLocationRaw } from "vue-router";

import type Show from "@/core/models/show";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{
  show?: Show;
  songId?: string;
}>();

const emit = defineEmits<{
  selectSong: [songId: string];
}>();

const auth = useAuthStore();
const songMenu = ref();

const song = computed(() => props.show?.songs.find(s => s.id === props.songId));

// Viewers have no show page, so for them the show leads to its first song.
const showRoute = computed<RouteLocationRaw | undefined>(() => {
  if (!props.show) {
    return undefined;
  }

  const name = props.show.getAccess(auth.user?.id).editor ? "show-edit" : "show";
  return { name, params: { showId: props.show.id } };
});

const songItems = computed<MenuItem[]>(() => (props.show?.songs ?? []).map(item => ({
  label: `#${item.number} ${item.title}`,
  class: item.id === props.songId ? "font-semibold" : "",
  command: () => emit("selectSong", item.id),
})));

function crumbClass(isLast: boolean): string {
  return isLast ? "text-color" : "text-muted-color";
}
</script>

<template>
  <nav
    class="flex min-w-0 items-center"
    aria-label="Breadcrumb"
  >
    <RouterLink
      v-slot="{ href, navigate }"
      :to="{ name: 'home' }"
      custom
    >
      <Button
        as="a"
        :href="href"
        severity="secondary"
        text
        class="flex-none max-sm:px-2"
        aria-label="Home"
        @click="navigate"
      >
        <img
          src="/favicon.svg"
          alt=""
          class="size-6"
        >
      </Button>
    </RouterLink>

    <template v-if="show && showRoute">
      <span
        class="px-0.5 text-muted-color"
        aria-hidden="true"
      >/</span>
      <RouterLink
        v-slot="{ href, navigate }"
        :to="showRoute"
        custom
      >
        <Button
          as="a"
          :href="href"
          :label="show.title"
          severity="secondary"
          text
          class="min-w-12 shrink-[2] whitespace-nowrap max-sm:px-2"
          :class="crumbClass(!song)"
          pt:label="truncate font-semibold"
          @click="navigate"
        />
      </RouterLink>
    </template>

    <template v-if="show && song">
      <span
        class="px-0.5 text-muted-color"
        aria-hidden="true"
      >/</span>
      <Button
        :label="`#${song.number} ${song.title}`"
        icon="pi pi-chevron-down"
        icon-pos="right"
        severity="secondary"
        text
        class="min-w-0 whitespace-nowrap max-sm:px-2"
        :class="crumbClass(true)"
        pt:label="truncate font-semibold"
        aria-haspopup="menu"
        @click="songMenu.toggle($event)"
      />
      <Menu
        ref="songMenu"
        :model="songItems"
        class="max-h-[70vh] overflow-y-auto"
        popup
      />
    </template>
  </nav>
</template>
