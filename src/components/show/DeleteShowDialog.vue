<script setup lang="ts">
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import { computed, ref, watch } from "vue";

import { useNotify } from "@/composables/useNotify";
import type Show from "@/core/models/show";

const props = defineProps<{
  show: Show;
}>();

const emit = defineEmits<{
  deleted: [];
}>();

const visible = defineModel<boolean>({ required: true });

const { notifyError } = useNotify();

const confirmation = ref("");
const deleting = ref(false);
const confirmed = computed(() => confirmation.value.trim() === props.show.title.trim());
const songCount = computed(() => props.show.getSongCount());

watch(visible, () => {
  confirmation.value = "";
});

async function deleteShow(): Promise<void> {
  if (!confirmed.value || deleting.value) {
    return;
  }

  deleting.value = true;
  try {
    await props.show.delete();
    emit("deleted");
    visible.value = false;
  } catch (error) {
    notifyError("Could not delete the show", error);
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="Delete show"
    class="w-120 max-w-[calc(100vw-2rem)]"
    modal
    dismissable-mask
  >
    <form
      class="flex flex-col gap-4"
      @submit.prevent="deleteShow"
    >
      <div class="flex gap-3">
        <i
          class="pi pi-exclamation-triangle mt-0.5 text-2xl text-danger"
          aria-hidden="true"
        />
        <span>
          "{{ show.title }}"<template v-if="songCount > 0"> and its <b>{{ songCount }} {{ songCount === 1 ? "song" : "songs" }}</b></template>
          will be deleted permanently, including all scores and recordings. Everyone you shared it with loses access.
        </span>
      </div>
      <div class="flex flex-col gap-2">
        <label
          for="delete-show-confirmation"
          class="text-sm text-muted-color"
        >Type <b class="text-color">{{ show.title }}</b> to confirm</label>
        <InputText
          id="delete-show-confirmation"
          v-model="confirmation"
          autocomplete="off"
          fluid
        />
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
        label="Delete show"
        severity="danger"
        :loading="deleting"
        :disabled="!confirmed"
        @click="deleteShow"
      />
    </template>
  </Dialog>
</template>
