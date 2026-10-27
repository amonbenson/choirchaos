<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { computed, onMounted, ref, useId } from "vue";

import { describeDropped, describeLength, useRecordingEditor } from "@/composables/useRecordingEditor";
import { formatRecording, parseRecording, type RecordingSpan } from "@/core/models/recording";
import type Song from "@/core/models/song";

const props = defineProps<{
  song: Song;
}>();

const emit = defineEmits<{
  close: [];
}>();

const editor = useRecordingEditor(() => props.song);
const { saving } = editor;
const ids = { field: useId(), hint: useId(), feedback: useId() };

const current = computed(() => formatRecording(props.song.getRecording(), props.song.getMeasures()));
const text = ref(current.value);

type Check
  = | { status: "invalid"; reason: string }
    | { status: "ok"; spans: RecordingSpan[]; length: string; dropped: string[] };

const check = computed<Check>(() => {
  const parsed = parseRecording(text.value, props.song.getMeasures());
  if (parsed.status === "invalid") {
    return parsed;
  }

  try {
    const preview = props.song.previewRecordingSpans(parsed.spans);
    return { status: "ok", spans: parsed.spans, length: describeLength(props.song, preview), dropped: describeDropped(props.song, preview.dropped) };
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
});

// The form opens from a button, so typing can start right away.
onMounted(() => document.getElementById(ids.field)?.focus());

const unchanged = computed(() => text.value.trim() === current.value);

async function save(): Promise<void> {
  const result = check.value;
  if (result.status !== "ok" || unchanged.value) {
    return;
  }

  if (await editor.setSpans(result.spans)) {
    emit("close");
  }
}
</script>

<template>
  <form
    class="flex flex-col gap-2"
    @submit.prevent="save"
  >
    <label
      :for="ids.field"
      class="text-sm font-medium"
    >Recording as text</label>
    <InputText
      :id="ids.field"
      v-model="text"
      class="font-mono"
      size="small"
      spellcheck="false"
      autocomplete="off"
      :invalid="check.status === 'invalid'"
      :aria-describedby="`${ids.feedback} ${ids.hint}`"
      fluid
      @keydown.esc.prevent="emit('close')"
    />
    <div
      :id="ids.feedback"
      aria-live="polite"
    >
      <Message
        v-if="check.status === 'invalid'"
        severity="error"
        size="small"
        variant="simple"
      >
        {{ check.reason }}
      </Message>
      <div
        v-else-if="!unchanged"
        class="flex flex-col gap-1 text-xs"
      >
        <span>{{ check.length }}</span>
        <span
          v-if="check.dropped.length > 0"
          class="text-review-text"
        >Removes {{ check.dropped.join(", ") }}.</span>
      </div>
    </div>
    <span
      :id="ids.hint"
      class="text-xs text-muted-color"
    >Parts in playing order, separated by commas. A part is a measure or a range like 19-20, and x3 plays it 3 times in a row, e.g. 1-20, 19-20 x3, 21-28.</span>
    <div class="flex gap-2">
      <Button
        type="submit"
        label="Save"
        size="small"
        :disabled="check.status === 'invalid' || unchanged || saving"
      />
      <Button
        label="Cancel"
        severity="secondary"
        size="small"
        text
        @click="emit('close')"
      />
    </div>
  </form>
</template>
