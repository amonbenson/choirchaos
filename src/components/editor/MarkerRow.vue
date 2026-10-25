<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { computed, ref, useId, useTemplateRef, watch } from "vue";

import type { Marker } from "@/core/models/markers";
import { isSameLocation, type Location } from "@/core/models/recording";
import type Song from "@/core/models/song";

import LocationInput from "./LocationInput.vue";

const props = defineProps<{
  song: Song;
  marker: Marker;
  active: boolean;
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  update: [at: Location, text: string];
  remove: [];
}>();

const row = ref<HTMLElement>();
const locationInput = useTemplateRef<InstanceType<typeof LocationInput>>("locationInput");
const subject = computed(() => `marker ${props.marker.text}`);
const at = ref<Location>(props.marker.at);
const name = ref("");
const locationError = ref<string>();
const locationErrorId = useId();

function reset(): void {
  at.value = props.marker.at;
  name.value = props.marker.text;
  locationInput.value?.reset();
}

watch(() => [props.marker.at, props.marker.text], reset, { immediate: true });

function commit(): void {
  const text = name.value.trim();
  if (!text) {
    name.value = props.marker.text;
    return;
  }

  if (!isSameLocation(at.value, props.marker.at) || text !== props.marker.text) {
    emit("update", at.value, text);
  }
}

// The row of a new marker renders before its save finishes, which is when it learns to take the focus.
watch(() => props.autofocus, (autofocus) => {
  if (!autofocus) {
    return;
  }

  const input = row.value?.querySelector<HTMLInputElement>("[data-marker-name]");
  input?.focus();
  input?.select();
}, { immediate: true, flush: "post" });
</script>

<template>
  <div
    ref="row"
    class="flex flex-col gap-1 border-l-2 pl-2 transition-colors"
    :class="active ? 'border-primary' : 'border-transparent'"
  >
    <div class="flex flex-wrap items-center gap-2">
      <LocationInput
        ref="locationInput"
        v-model="at"
        v-model:error="locationError"
        :song="song"
        :subject="subject"
        :error-id="locationErrorId"
        @commit="commit"
        @cancel="reset"
      />
      <div class="flex min-w-24 flex-1 items-center gap-2">
        <InputText
          v-model="name"
          data-marker-name
          class="min-w-0 flex-1"
          size="small"
          :aria-label="`Name of ${subject}`"
          @blur="commit"
          @keydown.enter="commit"
          @keydown.esc="reset"
        />
        <Button
          icon="pi pi-trash"
          severity="secondary"
          size="small"
          :aria-label="`Delete ${subject}`"
          text
          rounded
          @click="emit('remove')"
        />
      </div>
    </div>
    <Message
      v-if="locationError"
      :id="locationErrorId"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ locationError }}
    </Message>
  </div>
</template>
