import { defineStore } from "pinia";
import { ref, type Ref } from "vue";

export const useProjectStore = defineStore("project", () => {
  const showId = ref("");
  const songId: Ref<string | null> = ref("");

  return {
    showId,
    songId,
  };
});
