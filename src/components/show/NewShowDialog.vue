<script setup lang="ts">
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import { ref, watch } from "vue";
import { useRouter } from "vue-router";

import { useNotify } from "@/composables/useNotify";
import Show from "@/core/models/show";
import { useAuthStore } from "@/stores/auth";

import CoverPicker from "./CoverPicker.vue";

const visible = defineModel<boolean>({ required: true });

const auth = useAuthStore();
const router = useRouter();
const { notifyError } = useNotify();

const title = ref("");
const cover = ref<File>();
const creating = ref(false);

watch(visible, (value) => {
  if (value) {
    title.value = "";
    cover.value = undefined;
  }
});

async function create(): Promise<void> {
  const trimmedTitle = title.value.trim();
  if (!trimmedTitle || !auth.user || creating.value) {
    return;
  }

  creating.value = true;
  try {
    const show = await Show.create(trimmedTitle, auth.user.id, cover.value);
    visible.value = false;
    await router.push({ name: "show-edit", params: { showId: show.id } });
  } catch (error) {
    notifyError("Could not create the show", error);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="New show"
    class="w-lg max-w-[calc(100vw-2rem)]"
    modal
    dismissable-mask
  >
    <form
      class="flex flex-col gap-4 sm:flex-row"
      @submit.prevent="create"
    >
      <CoverPicker
        class="w-32 flex-none"
        :thumbnail="cover"
        compact
        @select="cover = $event"
        @remove="cover = undefined"
      />
      <div class="flex flex-1 flex-col gap-2">
        <label
          for="new-show-title"
          class="font-medium"
        >Title</label>
        <InputText
          id="new-show-title"
          v-model="title"
          autofocus
          fluid
        />
        <span class="text-sm text-muted-color">Only you can see the show until you share it. Songs and people are added next.</span>
      </div>
    </form>
    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        text
        @click="visible = false"
      />
      <Button
        label="Create show"
        :loading="creating"
        :disabled="!title.trim()"
        @click="create"
      />
    </template>
  </Dialog>
</template>
