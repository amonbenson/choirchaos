<script setup lang="ts">
defineOptions({ inheritAttrs: false });

import Avatar from "primevue/avatar";
import Menu from "primevue/menu";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { logout } from "@/pocketbase/auth";
import { useAuthStore } from "@/stores/auth";

import SettingsDialog from "./SettingsDialog.vue";

const router = useRouter();
const menu = ref();
const settingsVisible = ref(false);

const auth = useAuthStore();

const initials = computed(() => {
  const name: string = auth.user?.name ?? "";
  return name
    .split(" ")
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("") || null;
});

const avatarUrl = computed(() => {
  const r = auth.user;
  if (!r?.avatar) {
    return null;
  }

  return `${import.meta.env.VITE_PB_URL}/api/files/users/${r.id}/${r.avatar}`;
});

const menuItems = computed(() => [
  {
    label: "Home",
    icon: "pi pi-home",
    command: () => router.push({ name: "home" }),
  },
  {
    label: "Settings",
    icon: "pi pi-cog",
    command: () => {
      settingsVisible.value = true;
    },
  },
  { separator: true },
  auth.user
    ? {
        label: "Sign Out",
        icon: "pi pi-sign-out",
        command: async () => {
          await logout();
        },
      }
    : {
        label: "Sign In",
        icon: "pi pi-sign-in",
        command: () => router.push({ name: "login", query: { redirect: router.currentRoute.value.fullPath } }),
      },
]);

function toggle(event: MouseEvent): void {
  menu.value.toggle(event);
}
</script>

<template>
  <Avatar
    v-bind="$attrs"
    :image="avatarUrl ?? undefined"
    :label="!avatarUrl && initials ? initials : undefined"
    :icon="!avatarUrl && !initials ? 'pi pi-user' : undefined"
    shape="circle"
    class="cursor-pointer select-none"
    @click="toggle"
  />

  <Menu
    ref="menu"
    :model="menuItems"
    popup
  />

  <SettingsDialog v-model="settingsVisible" />
</template>
