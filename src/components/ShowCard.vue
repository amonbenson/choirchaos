<script setup lang="ts">
import Button from "primevue/button";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import { computed, ref } from "vue";

import type Show from "@/core/models/show";
import type { MemberRole } from "@/core/models/show";

import ShowCover from "./ShowCover.vue";

const props = defineProps<{
  show: Show;
  role?: MemberRole;
  showRole?: boolean;
}>();

const emit = defineEmits<{
  open: [];
  edit: [];
  share: [];
  delete: [];
}>();

const VISIBILITY_ICONS = { private: "pi-lock", unlisted: "pi-link", public: "pi-globe" };
const ROLE_LABELS: Record<MemberRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

const menu = ref();

const songCount = computed(() => props.show.getSongCount());
const subtitle = computed(() => {
  const songs = songCount.value === 0 ? "No songs yet" : `${songCount.value} ${songCount.value === 1 ? "song" : "songs"}`;
  return props.showRole && props.role ? `${songs} · ${ROLE_LABELS[props.role]}` : songs;
});

const menuItems = computed<MenuItem[]>(() => {
  const isOwner = props.role === "owner";
  return [
    { label: "Edit show", icon: "pi pi-pencil", command: () => emit("edit") },
    { label: "Share", icon: "pi pi-user-plus", command: () => emit("share") },
    ...(isOwner
      ? [
          { separator: true },
          { label: "Delete", icon: "pi pi-trash", command: () => emit("delete") },
        ]
      : []),
  ];
});
</script>

<template>
  <div
    class="group relative flex w-40 cursor-pointer flex-col gap-2 sm:w-52"
    role="link"
    :aria-label="show.title"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <ShowCover
      :show-id="show.id"
      :thumbnail="show.thumbnail"
      icon-class="text-5xl sm:text-6xl"
    >
      <span
        v-if="role === 'owner'"
        class="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full bg-black/45 text-white"
        :title="show.permissions.visibility"
      >
        <i :class="`pi ${VISIBILITY_ICONS[show.permissions.visibility]} text-xs`" />
      </span>
      <div class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
        <i class="pi pi-play-circle text-6xl text-white sm:text-7xl" />
      </div>
      <Button
        v-if="role === 'owner' || role === 'editor'"
        icon="pi pi-ellipsis-v"
        severity="secondary"
        size="small"
        :aria-label="`Options for ${show.title}`"
        class="absolute top-2 right-2 opacity-100 transition-opacity mouse:opacity-0 mouse:group-focus-within:opacity-100 mouse:group-hover:opacity-100"
        rounded
        @click.stop="menu.toggle($event)"
      />
    </ShowCover>
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
    <Menu
      ref="menu"
      :model="menuItems"
      popup
    />
  </div>
</template>
