<script setup lang="ts">
defineOptions({ inheritAttrs: false });

import Avatar from "primevue/avatar";
import Button from "primevue/button";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { pb } from "@/pocketbase";
import { logout } from "@/pocketbase/auth";
import { useAuthStore } from "@/stores/auth";

import PreferencesDialog from "./PreferencesDialog.vue";

const router = useRouter();
const route = useRoute();
const menu = ref();
const preferencesVisible = ref(false);
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

  return pb.files.getURL(r, r.avatar);
});

// Account things only. Navigating the app is the header's job.
const menuItems = computed<MenuItem[]>(() => {
  const preferences = { label: "Preferences", icon: "pi pi-sliders-v", command: () => preferencesVisible.value = true };
  if (!auth.user) {
    return [preferences];
  }

  return [
    { label: auth.user.name || auth.user.email, disabled: true },
    { separator: true },
    preferences,
    { label: "Sign out", icon: "pi pi-sign-out", command: () => logout() },
  ];
});

function signIn(): void {
  router.push({ name: "login", query: { redirect: route.fullPath } });
}
</script>

<template>
  <div
    v-bind="$attrs"
    class="flex flex-none items-center gap-2"
  >
    <Button
      v-if="!auth.user"
      label="Sign in"
      severity="secondary"
      size="small"
      @click="signIn"
    />
    <Avatar
      :image="avatarUrl ?? undefined"
      :label="!avatarUrl && initials ? initials : undefined"
      :icon="!avatarUrl && !initials ? 'pi pi-user' : undefined"
      shape="circle"
      class="cursor-pointer select-none"
      role="button"
      tabindex="0"
      aria-label="Account"
      aria-haspopup="menu"
      @click="menu.toggle($event)"
      @keydown.enter="menu.toggle($event)"
    />
  </div>
  <Menu
    ref="menu"
    :model="menuItems"
    popup
  />
  <PreferencesDialog v-model="preferencesVisible" />
</template>
