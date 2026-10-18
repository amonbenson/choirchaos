<script setup lang="ts">
defineOptions({ inheritAttrs: false });

import Avatar from "primevue/avatar";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { pb } from "@/pocketbase";
import { logout } from "@/pocketbase/auth";
import { useAuthStore } from "@/stores/auth";
import type { AuthTab } from "@/views/AuthView.vue";

import PreferencesDialog from "./PreferencesDialog.vue";

const router = useRouter();
const route = useRoute();
const menu = ref();
const preferencesVisible = ref(false);
const auth = useAuthStore();

const placeholderAvatarUrl = `${import.meta.env.BASE_URL}avatar.svg`;

const avatarUrl = computed(() => {
  const r = auth.user;
  if (!r?.avatar) {
    return placeholderAvatarUrl;
  }

  return pb.files.getURL(r, r.avatar);
});

// Account things only. Navigating the app is the header's job.
const menuItems = computed<MenuItem[]>(() => {
  const preferences = { label: "Preferences", icon: "pi pi-sliders-v", command: () => preferencesVisible.value = true };
  if (!auth.user) {
    return [
      { label: "Sign in", icon: "pi pi-sign-in", command: () => openAuth("login") },
      { label: "Create account", icon: "pi pi-user-plus", command: () => openAuth("register") },
      { separator: true },
      preferences,
    ];
  }

  return [
    { label: auth.user.name || auth.user.email, disabled: true },
    { separator: true },
    preferences,
    { label: "Sign out", icon: "pi pi-sign-out", command: () => logout() },
  ];
});

function openAuth(tab: AuthTab): void {
  router.push({ name: "login", query: { tab, redirect: route.fullPath } });
}
</script>

<template>
  <Avatar
    v-bind="$attrs"
    :image="avatarUrl"
    shape="circle"
    class="flex-none cursor-pointer select-none"
    role="button"
    tabindex="0"
    aria-label="Account"
    aria-haspopup="menu"
    @click="menu.toggle($event)"
    @keydown.enter="menu.toggle($event)"
    @keydown.space.prevent="menu.toggle($event)"
  />
  <Menu
    ref="menu"
    :model="menuItems"
    aria-label="Account"
    popup
  />
  <PreferencesDialog v-model="preferencesVisible" />
</template>
