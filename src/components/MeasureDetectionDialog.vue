<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import ProgressBar from "primevue/progressbar";
import { computed, ref, shallowRef, watch } from "vue";

import { useNotify } from "@/composables/useNotify";
import { type DetectedMeasure, hasMeasureDetectionChanges, planMeasureDetection } from "@/core/models/measureDetection";
import type Song from "@/core/models/song";
import { detectMeasures, type MeasureDetectionProgress } from "@/core/pdf/measureDetector";
import { resolveUrl } from "@/core/utils/file";
import { usePlayerStore } from "@/stores/player";

const visible = defineModel<boolean>({ required: true });

const props = defineProps<{
  song: Song;
}>();

const player = usePlayerStore();
const { notifyError, notifySuccess } = useNotify();

const MAX_LISTED_MEASURES = 12;

const progress = ref<MeasureDetectionProgress>();
const detected = shallowRef<DetectedMeasure[]>();
const applying = ref(false);
const replacePlaced = ref(false);
const createMissing = ref(true);
const beats = ref(4);

// Closing the dialog cannot stop a running detection, so a stale run only drops its result.
let currentRun = 0;

watch(visible, (value) => {
  currentRun++;
  progress.value = undefined;
  detected.value = undefined;
  if (value) {
    replacePlaced.value = false;
    createMissing.value = props.song.playerMode !== "midi";
  }
});

const running = computed(() => !!progress.value && !detected.value);
const hasPlacedMeasures = computed(() => props.song.measures.items().some(m => m.layout));

// In MIDI mode the beat map defines which measures exist, so detection only places them.
const canCreateMeasures = computed(() => props.song.playerMode !== "midi");

const plan = computed(() => detected.value && planMeasureDetection(props.song.measures.items(), detected.value, {
  replacePlaced: replacePlaced.value,
  createMissing: canCreateMeasures.value && createMissing.value,
  beats: beats.value,
}));

const progressValue = computed(() => {
  const value = progress.value;
  return value?.stage === "detect" ? Math.round((value.done / value.total) * 100) : undefined;
});

const progressLabel = computed(() => {
  const value = progress.value;
  if (value?.stage === "detect") {
    return `Reading page ${Math.min(value.done + 1, value.total)} of ${value.total}`;
  }

  return value?.stage === "label" ? "Reading measure numbers" : "Loading the detector";
});

function formatList(values: string[]): string {
  const listed = values.slice(0, MAX_LISTED_MEASURES).map(value => value || "(no number)").join(", ");
  const more = values.length - MAX_LISTED_MEASURES;
  return more > 0 ? `${listed} and ${more} more` : listed;
}

function pluralize(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

async function detect(): Promise<void> {
  if (!props.song.pdfFile) {
    return;
  }

  const run = ++currentRun;
  const url = resolveUrl(props.song.pdfFile, "songs", props.song.id);
  const onProgress = (value: MeasureDetectionProgress): void => {
    if (run === currentRun) {
      progress.value = value;
    }
  };

  try {
    const result = await detectMeasures(url, onProgress);
    if (run === currentRun) {
      detected.value = result;
    }
  } catch (error) {
    if (run === currentRun) {
      progress.value = undefined;
      notifyError("Could not detect measures", error);
    }
  }
}

async function reloadPlayer(): Promise<void> {
  const savedPosition = player.position;
  await player.load(props.song);
  player.seek(savedPosition);
}

async function apply(): Promise<void> {
  const value = plan.value;
  if (!value || applying.value) {
    return;
  }

  applying.value = true;
  try {
    await props.song.applyMeasureDetection(value);
    if (value.additions.length > 0) {
      await reloadPlayer();
    }

    visible.value = false;
    notifySuccess("Measures placed", pluralize(value.placements.length + value.additions.length, "measure"));
  } catch (error) {
    notifyError("Could not save the measures", error);
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="Detect measures"
    class="w-[32rem] max-w-[calc(100vw-2rem)]"
    modal
  >
    <div
      v-if="!progress"
      class="flex flex-col gap-2"
    >
      <p>Finds the measures on the score and reads their numbers. Nothing changes until you review and apply the result.</p>
      <p class="text-sm text-muted-color">
        The first run downloads the detector, which takes a moment. Large scores can take a minute.
      </p>
    </div>

    <div
      v-else-if="running"
      class="flex flex-col gap-2"
    >
      <span>{{ progressLabel }}</span>
      <ProgressBar
        :value="progressValue"
        :mode="progressValue === undefined ? 'indeterminate' : 'determinate'"
        :show-value="false"
        class="h-2"
      />
    </div>

    <div
      v-else-if="plan"
      class="flex flex-col gap-3"
    >
      <span v-if="detected!.length === 0">No measures were found on the score.</span>
      <ul
        v-else
        class="flex list-disc flex-col gap-1 pl-5"
      >
        <li>Found {{ pluralize(detected!.length, "measure") }}.</li>
        <li v-if="plan.placements.length > 0">
          Places {{ pluralize(plan.placements.length, "measure") }} of the song.
        </li>
        <li v-if="plan.additions.length > 0">
          Adds {{ pluralize(plan.additions.length, "new measure") }}: {{ formatList(plan.additions.map(m => m.value)) }}.
        </li>
        <li v-if="plan.keptPlaced.length > 0">
          Keeps {{ pluralize(plan.keptPlaced.length, "measure") }} that already {{ plan.keptPlaced.length === 1 ? "has" : "have" }} a box.
        </li>
        <li v-if="plan.duplicates.length > 0">
          Read twice, keeps the first box: {{ formatList(plan.duplicates) }}.
        </li>
        <li v-if="plan.unmatched.length > 0">
          Skips {{ plan.unmatched.length }}: {{ formatList(plan.unmatched) }}.
        </li>
      </ul>

      <div
        v-if="hasPlacedMeasures"
        class="flex items-center gap-2"
      >
        <Checkbox
          v-model="replacePlaced"
          input-id="detect-replace-placed"
          binary
        />
        <label for="detect-replace-placed">Replace boxes that are already placed</label>
      </div>

      <template v-if="canCreateMeasures">
        <div class="flex items-center gap-2">
          <Checkbox
            v-model="createMissing"
            input-id="detect-create-missing"
            binary
          />
          <label for="detect-create-missing">Add measures the song does not have yet</label>
        </div>
        <div
          v-if="createMissing"
          class="flex items-center justify-between gap-2 pl-7"
        >
          <label
            for="detect-beats"
            class="text-sm"
          >Beats per new measure</label>
          <InputNumber
            v-model="beats"
            input-id="detect-beats"
            :min="1"
            :max="32"
            show-buttons
            button-layout="horizontal"
            size="small"
            input-class="w-12 text-center"
          />
        </div>
      </template>
      <span
        v-else-if="plan.unmatched.length > 0"
        class="text-sm text-muted-color"
      >The beat map defines the measures of this song, so only measures it contains are placed.</span>

      <Message
        v-if="plan.lowConfidence.length > 0"
        severity="warn"
        size="small"
      >
        Check these by hand, the detector is unsure about them: {{ formatList(plan.lowConfidence) }}.
      </Message>
    </div>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        text
        @click="visible = false"
      />
      <Button
        v-if="!plan"
        label="Detect"
        icon="pi pi-sparkles"
        :loading="running"
        @click="detect"
      />
      <Button
        v-else
        label="Apply"
        :disabled="!hasMeasureDetectionChanges(plan)"
        :loading="applying"
        @click="apply"
      />
    </template>
  </Dialog>
</template>
