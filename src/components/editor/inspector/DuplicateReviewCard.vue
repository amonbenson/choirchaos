<script setup lang="ts">
import { useSessionStorage } from "@vueuse/core";
import Button from "primevue/button";
import { computed } from "vue";

import { describeDropped, useRecordingEditor } from "@/composables/useRecordingEditor";
import { type DuplicateRun, findDuplicateRuns, playDuplicatesAsRepeat, previewDuplicatesAsRepeat } from "@/core/models/duplicateMigration";
import { formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import type Measure from "@/core/models/measure";
import { expandRecording, findPosition, formatRecording } from "@/core/models/recording";
import type Song from "@/core/models/song";

const props = defineProps<{
  song: Song;
}>();

// The stored song has no place for "keep separate", so the choice lasts until the browser tab is closed.
const dismissed = useSessionStorage<string[]>("choirchaos.keptDuplicates", []);

const editor = useRecordingEditor(() => props.song);
const { saving } = editor;

function getKey(run: DuplicateRun): string {
  return `${props.song.id}:${run.duplicates.map(measure => measure.id).join(",")}`;
}

function formatMeasures(measures: readonly Measure[]): string {
  return measures.length === 1 ? measures[0]!.label : `${measures[0]!.label} to ${measures.at(-1)!.label}`;
}

function getIds(measures: readonly Measure[]): string[] {
  return measures.map(measure => measure.id);
}

type Proposal = {
  key: string;
  run: DuplicateRun;
  duplicates: string;
  originals: string;
  /** Which time of the originals the duplicates become, undefined when the recording never plays them. */
  occurrence?: number;
  recording: string;
  dropped: string[];
};

function propose(run: DuplicateRun): Proposal[] {
  try {
    const preview = previewDuplicatesAsRepeat(props.song, getIds(run.duplicates), getIds(run.originals));
    const position = findPosition(props.song.getTimeline(), { measure: run.duplicates[0]!.id, occurrence: 1 });
    const timeline = expandRecording(props.song.getMeasures(), preview.spans);
    return [{
      key: getKey(run),
      run,
      duplicates: formatMeasures(run.duplicates),
      originals: formatMeasures(run.originals),
      occurrence: position === undefined ? undefined : timeline[position]?.occurrence,
      recording: formatRecording(preview.spans, props.song.getMeasures()),
      dropped: describeDropped(props.song, preview.dropped),
    }];
  } catch {
    return [];
  }
}

const proposals = computed(() => props.song.isRecordingEditable()
  ? findDuplicateRuns(props.song.getMeasures()).filter(run => !dismissed.value.includes(getKey(run))).flatMap(propose)
  : []);

function describeOverlap({ run, duplicates, originals }: Proposal): string {
  return run.duplicates.length === 1
    ? `Measure ${duplicates} lies exactly on top of ${originals}`
    : `Measures ${duplicates} lie exactly on top of ${originals}`;
}

function getActionLabel({ originals, occurrence }: Proposal): string {
  return occurrence === undefined ? `Merge into ${originals}` : `Play as ${formatTimes(occurrence)} of ${originals}`;
}

async function accept({ run }: Proposal): Promise<void> {
  const duplicates = getIds(run.duplicates);
  const originals = getIds(run.originals);
  await editor.apply(
    () => previewDuplicatesAsRepeat(props.song, duplicates, originals),
    () => playDuplicatesAsRepeat(props.song, duplicates, originals),
    "Could not play the measures as a repeat",
  );
}

function keepSeparate({ key }: Proposal): void {
  dismissed.value = [...dismissed.value, key];
}
</script>

<template>
  <ul
    v-if="proposals.length > 0"
    class="flex flex-col gap-3"
    aria-label="Duplicate boxes"
  >
    <li
      v-for="proposal in proposals"
      :key="proposal.key"
      class="flex flex-col gap-2 rounded-md border border-review-border bg-review-surface p-3"
    >
      <span
        class="text-sm font-semibold"
      >{{ describeOverlap(proposal) }}</span>
      <template v-if="proposal.occurrence !== undefined">
        <span class="text-sm">Is the recording playing {{ proposal.originals }} a {{ formatOrdinal(proposal.occurrence) }} time?</span>
        <span class="text-xs text-muted-color">
          Recording becomes {{ proposal.recording }}. Measures {{ proposal.duplicates }} are deleted. Their sync points, markers
          and sections move to {{ proposal.originals }}, {{ formatTimes(proposal.occurrence) }}. Timing does not change.
        </span>
      </template>
      <span
        v-else
        class="text-xs text-muted-color"
      >The recording never plays {{ proposal.duplicates }}, so merging only deletes them.</span>
      <span
        v-if="proposal.dropped.length > 0"
        class="text-xs text-review-text"
      >Removes {{ proposal.dropped.join(", ") }}.</span>
      <div class="flex flex-wrap gap-2">
        <Button
          :label="getActionLabel(proposal)"
          size="small"
          :disabled="saving"
          @click="accept(proposal)"
        />
        <Button
          label="Keep separate measures"
          severity="secondary"
          size="small"
          text
          @click="keepSeparate(proposal)"
        />
      </div>
      <span class="text-xs text-muted-color">Keeping them hides this until you close the browser tab.</span>
    </li>
  </ul>
</template>
