<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";

import type Show from "@/core/models/show";
import type { MemberRole } from "@/core/models/show";

import ShowCover from "./ShowCover.vue";

const props = defineProps<{
  show: Show;
  to: RouteLocationRaw;
  role?: MemberRole;
  showRole?: boolean;
}>();

const ROLE_LABELS: Record<MemberRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

const songCount = computed(() => props.show.getSongCount());
const subtitle = computed(() => {
  const songs = songCount.value === 0 ? "No songs yet" : `${songCount.value} ${songCount.value === 1 ? "song" : "songs"}`;
  return props.showRole && props.role ? `${songs} · ${ROLE_LABELS[props.role]}` : songs;
});
</script>

<template>
  <RouterLink
    :to="to"
    class="group flex w-40 flex-col gap-2 sm:w-52"
    :aria-label="show.title"
  >
    <ShowCover
      :show-id="show.id"
      :thumbnail="show.thumbnail"
      icon-class="text-5xl sm:text-6xl"
      class="transition-opacity group-hover:opacity-80"
    />
    <div class="flex min-w-0 flex-col items-center">
      <div
        class="w-full truncate text-center font-medium text-color"
        :title="show.title"
      >
        {{ show.title }}
      </div>
      <div class="text-sm text-muted-color">
        {{ subtitle }}
      </div>
    </div>
  </RouterLink>
</template>
