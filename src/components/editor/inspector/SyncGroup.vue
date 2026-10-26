<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { computed, ref, useId, watch } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useSyncEditor } from "@/composables/useSyncEditor";
import { formatOccurrence, formatTimes } from "@/core/models/locationFormat";
import type { SelectedRun } from "@/core/models/measureSelection";
import { getRecordingStretches, type RecordedPass, type TimelineEntry } from "@/core/models/recording";
import type Song from "@/core/models/song";
import {
  canPlaceWarpMarker,
  constrainWarpMarkerTime,
  formatSyncTime,
  getOccurrenceKey,
  getReassignCandidates,
  getSyncStatus,
  LARGE_NUDGE_STEP,
  NUDGE_STEP,
  nudgeWarpMarkerTime,
  parseSyncTime,
} from "@/core/models/warpEditing";
import { getStartTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";

import InspectorGroup from "./InspectorGroup.vue";

const props = defineProps<{
  song: Song;
  run: SelectedRun;
}>();

const MILLISECONDS_PER_SECOND = 1000;

const player = usePlayerStore();
const editor = injectMeasureEditor();
const sync = useSyncEditor(() => props.song);
const timeId = useId();
const hintId = useId();
const statusId = useId();
const reassignId = useId();
const reassignPanelId = useId();
const reassigning = ref(false);
const timeText = ref("");

/** The sync point belongs to the selected occurrence, which is where a range starts. */
const entry = computed<TimelineEntry>(() => props.song.getTimeline()[props.run.first]!);
const occurrence = computed(() => ({ measure: entry.value.measure, occurrence: entry.value.occurrence }));
const label = (entry: TimelineEntry): string => formatOccurrence(props.song.findMeasure(entry.measure)?.label ?? "?", entry.occurrence);
const place = computed(() => label(entry.value));

const time = computed(() => sync.getTime(occurrence.value));
const hasSyncPoint = computed(() => time.value !== undefined);
const estimatedTime = computed(() => {
  const position = player.timeline[props.run.first];
  return position && getStartTick(position) / MILLISECONDS_PER_SECOND;
});

const unsyncedText = computed(() => estimatedTime.value === undefined
  ? "No sync point."
  : `No sync point. ${place.value} starts at about ${formatSyncTime(estimatedTime.value)}, following the sync points around it.`);

const canSyncToPlayhead = computed(() => player.ready && canPlaceWarpMarker(
  props.song.getTimeline(),
  props.song.getWarpMarkers(),
  occurrence.value,
  sync.getPlayheadTime(),
  sync.getDuration(),
));

const summary = computed(() => time.value === undefined ? "Not synced" : formatSyncTime(time.value));

watch(() => getOccurrenceKey(occurrence.value), () => {
  reassigning.value = false;
});

watch(time, (value) => {
  timeText.value = value === undefined ? "" : formatSyncTime(value);
}, { immediate: true });

const reassignOptions = computed(() => hasSyncPoint.value
  ? getReassignCandidates(props.song.getTimeline(), props.song.getWarpMarkers(), occurrence.value, sync.getDuration())
      .map(candidate => ({ label: label(candidate), value: getOccurrenceKey(candidate), entry: candidate }))
  : []);

/**
 * Moving the sync point re-times the measures, which can leave the playhead in another occurrence. The
 * playhead decides the selected occurrence, so it goes back to the start of the one being edited.
 */
async function moveTo(next: number): Promise<void> {
  const run = props.run;
  await sync.moveTo(occurrence.value, next);
  const position = player.currentLocation?.position;
  if (position === undefined || position < run.first || position > run.last) {
    player.seekPosition(run.first);
  }
}

function nudge(delta: number): void {
  if (time.value === undefined) {
    return;
  }

  moveTo(nudgeWarpMarkerTime(props.song.getTimeline(), props.song.getWarpMarkers(), occurrence.value, time.value, delta, sync.getDuration()));
}

function onTimeKeydown(event: KeyboardEvent): void {
  // Left and right stay with the text cursor, so the time can still be typed.
  const directions: Record<string, number> = { ArrowUp: 1, ArrowDown: -1 };
  const direction = directions[event.key];
  if (direction === undefined) {
    return;
  }

  event.preventDefault();
  nudge(direction * (event.shiftKey ? LARGE_NUDGE_STEP : NUDGE_STEP));
}

function commitTime(): void {
  const parsed = parseSyncTime(timeText.value);
  if (parsed === undefined || time.value === undefined) {
    timeText.value = time.value === undefined ? "" : formatSyncTime(time.value);
    return;
  }

  const next = constrainWarpMarkerTime(props.song.getTimeline(), props.song.getWarpMarkers(), occurrence.value, parsed, sync.getDuration());
  timeText.value = formatSyncTime(next);
  if (next !== time.value) {
    moveTo(next);
  }
}

async function reassign(key: string): Promise<void> {
  reassigning.value = false;
  const target = reassignOptions.value.find(option => option.value === key)?.entry;
  if (!target) {
    return;
  }

  await sync.reassign(occurrence.value, target);
  // The sync point now lives on the other measure, so the selection follows it.
  const measure = props.song.findMeasure(target.measure);
  editor.setSelection(measure?.layout ? [measure] : []);
  player.seekPosition(target.position);
}

// Sync status

const status = computed(() => getSyncStatus(
  props.song.getTimeline(),
  props.song.getWarpMarkers(),
  getRecordingStretches(props.song.getMeasures(), props.song.getRecording()),
));

function formatStretch({ first, last }: RecordedPass): string {
  const timeline = props.song.getTimeline();
  const start = timeline[first]!;
  const end = timeline[last]!;
  const measureLabel = (item: TimelineEntry): string => props.song.findMeasure(item.measure)?.label ?? "?";
  if (first === last) {
    return label(start);
  }

  if (start.occurrence === end.occurrence) {
    const times = start.occurrence > 1 ? `, ${formatTimes(start.occurrence)}` : "";
    return `${measureLabel(start)} to ${measureLabel(end)}${times}`;
  }

  return `${label(start)} to ${label(end)}`;
}

type StatusIssue = { key: string; text: string; position: number };

const issues = computed<StatusIssue[]>(() => [
  ...status.value.unsyncedPasses.map(pass => ({
    key: `pass-${pass.first}`,
    text: `No sync point in ${formatStretch(pass)}`,
    position: pass.first,
  })),
  ...status.value.gaps.map(gap => ({
    key: `gap-${gap.first}`,
    text: `Measures ${formatStretch(gap)} may drift: ${gap.length} measures between sync points`,
    position: gap.first,
  })),
]);

const statusSummary = computed(() => {
  const { count } = status.value;
  if (count === 0) {
    return "No sync points yet";
  }

  const points = count === 1 ? "1 sync point" : `${count} sync points`;
  return status.value.unsyncedPasses.length === 0 ? `${points}, every pass covered` : points;
});

function showIssue({ position }: StatusIssue): void {
  const measure = props.song.findMeasure(props.song.getTimeline()[position]!.measure);
  editor.setSelection(measure?.layout ? [measure] : []);
  player.seekPosition(position);
}
</script>

<template>
  <InspectorGroup
    id="sync"
    title="Audio sync"
    :summary="summary"
  >
    <template v-if="hasSyncPoint">
      <div class="flex items-center gap-2">
        <label
          :for="timeId"
          class="text-sm"
        >Starts at</label>
        <div class="ml-auto flex items-center gap-1">
          <Button
            icon="pi pi-chevron-left"
            severity="secondary"
            size="small"
            aria-label="Nudge earlier"
            text
            rounded
            @click="nudge(-NUDGE_STEP)"
          />
          <InputText
            :id="timeId"
            v-model="timeText"
            class="w-28 text-center font-mono"
            size="small"
            :aria-describedby="hintId"
            @keydown="onTimeKeydown"
            @keydown.enter="commitTime"
            @keydown.esc="timeText = formatSyncTime(time!)"
            @blur="commitTime"
          />
          <Button
            icon="pi pi-chevron-right"
            severity="secondary"
            size="small"
            aria-label="Nudge later"
            text
            rounded
            @click="nudge(NUDGE_STEP)"
          />
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          label="Sync to playhead"
          icon="pi pi-map-marker"
          severity="secondary"
          size="small"
          :disabled="!canSyncToPlayhead"
          @click="sync.syncToPlayhead(occurrence)"
        />
        <Button
          label="Move to another measure"
          severity="secondary"
          size="small"
          :aria-expanded="reassigning"
          :aria-controls="reassignPanelId"
          :disabled="reassignOptions.length === 0"
          @click="reassigning = !reassigning"
        />
      </div>
      <div
        v-show="reassigning"
        :id="reassignPanelId"
        class="flex flex-col gap-2"
      >
        <label
          :id="reassignId"
          class="text-sm"
        >Which measure starts at {{ time === undefined ? "" : formatSyncTime(time) }}?</label>
        <div class="flex items-center gap-2">
          <Select
            :options="reassignOptions"
            option-label="label"
            option-value="value"
            :aria-labelledby="reassignId"
            placeholder="Choose a measure"
            size="small"
            scroll-height="16rem"
            class="min-w-0 flex-1"
            filter
            @update:model-value="reassign"
          />
          <Button
            label="Cancel"
            severity="secondary"
            size="small"
            text
            @click="reassigning = false"
          />
        </div>
      </div>
      <Button
        label="Remove"
        icon="pi pi-trash"
        severity="danger"
        size="small"
        :aria-label="`Remove sync point at ${place}`"
        class="self-start"
        text
        @click="sync.remove(occurrence)"
      />
      <span
        :id="hintId"
        class="text-xs text-muted-color"
      >The up and down arrow keys nudge by 10 ms, with Shift by 100 ms.</span>
    </template>

    <template v-else>
      <span class="text-sm">{{ unsyncedText }}</span>
      <Button
        label="Sync to playhead"
        icon="pi pi-map-marker"
        severity="secondary"
        size="small"
        class="self-start"
        :disabled="!canSyncToPlayhead"
        @click="sync.syncToPlayhead(occurrence)"
      />
    </template>

    <span
      v-if="player.ready && !canSyncToPlayhead"
      class="text-xs text-muted-color"
    >To sync {{ place }}, move the playhead between the sync points before and after it.</span>

    <div class="flex flex-col gap-1 border-t border-surface-200 pt-3 dark:border-surface-700">
      <h4
        :id="statusId"
        class="m-0 text-xs font-semibold tracking-wide text-muted-color uppercase"
      >
        Sync status
      </h4>
      <ul
        class="flex flex-col gap-1 text-sm"
        :aria-labelledby="statusId"
      >
        <li class="flex items-start gap-2">
          <i
            class="pi mt-0.5"
            :class="status.count > 0 && status.unsyncedPasses.length === 0 ? 'pi-check text-primary' : 'pi-info-circle text-muted-color'"
            aria-hidden="true"
          />
          <span>{{ statusSummary }}</span>
        </li>
        <li
          v-for="issue in issues"
          :key="issue.key"
          class="flex items-start gap-2"
        >
          <i
            class="pi pi-exclamation-circle mt-0.5 text-orange-600 dark:text-orange-400"
            aria-hidden="true"
          />
          <button
            type="button"
            class="rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            @click="showIssue(issue)"
          >
            {{ issue.text }}
          </button>
        </li>
      </ul>
    </div>
  </InspectorGroup>
</template>
