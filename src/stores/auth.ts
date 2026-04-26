import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { pb } from "@/pocketbase";

export const useAuthStore = defineStore("auth", () => {
  const user = ref(pb.authStore.record);

  // Pinia stores are singletons, so this subscription lives for the app lifetime.
  pb.authStore.onChange((_token, record) => {
    user.value = record;
  });

  const isLoggedIn = computed(() => user.value !== null);

  return { user, isLoggedIn };
});
