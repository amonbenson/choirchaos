<script setup lang="ts">
import { computed, useId } from "vue";

import { SYNC_POINT_COLORS } from "@/components/editor/timeline/syncColors";
import type { Marker } from "@/core/models/markers";
import Measure, { type MeasureLayout, needsReview } from "@/core/models/measure";
import type { BoxEdge } from "@/core/models/measureEditing";
import type { BoxOverlays } from "@/core/models/scoreOverlays";
import { isMarkerSelected, isMeasureSelected, type Selection } from "@/core/models/selection";

import BoxResizeHandle from "./BoxResizeHandle.vue";
import ScoreBadge from "./ScoreBadge.vue";
import ScoreBox from "./ScoreBox.vue";
import ScoreLane from "./ScoreLane.vue";

export type PlayingBox = {
  /** How far the playing pass has got through the measure, from 0 to 1. */
  progress: number;
};

const props = defineProps<{
  measure: Measure;
  /** The measure's layout, or where a running resize drag has moved it. */
  layout: MeasureLayout;
  editMode: boolean;
  selection: Selection;
  overlays?: BoxOverlays;
  playing?: PlayingBox;
  /** A highlighted track plays in this measure. */
  highlighted: boolean;
  resizable: boolean;
  dimmed: boolean;
}>();

const emit = defineEmits<{
  "select-marker": [marker: Marker];
  "resize": [edge: BoxEdge, delta: { x: number; y: number }];
  "resize-end": [];
}>();

const EDGES: readonly BoxEdge[] = ["top", "right", "bottom", "left"];

const descriptionId = useId();

const selected = computed(() => props.editMode && isMeasureSelected(props.selection, props.measure.id));

const review = computed(() => needsReview(props.measure.layout));

const surfaceClass = computed(() => {
  if (!props.editMode) {
    return props.highlighted ? "bg-track-highlight/25 hover:bg-track-highlight/45" : "hover:bg-primary/25";
  }

  if (selected.value) {
    return "outline-2 outline-primary bg-primary/30";
  }

  return review.value
    ? "outline-2 outline-warn bg-warn/15 hover:bg-warn/30"
    : "outline outline-primary/70 bg-primary/10 hover:bg-primary/25";
});
</script>

<template>
  <ScoreBox
    :layout="layout"
    :class="dimmed ? 'opacity-40' : ''"
    :data-measure="measure.id"
  >
    <div
      class="pointer-events-auto absolute inset-0 cursor-pointer transition-colors select-none"
      :class="surfaceClass"
      role="button"
      :aria-label="`Measure ${measure.label}`"
      :aria-pressed="editMode ? selected : undefined"
      :aria-current="playing ? 'location' : undefined"
      :aria-describedby="overlays ? descriptionId : undefined"
    />
    <span
      v-if="overlays"
      :id="descriptionId"
      hidden
    >{{ overlays.description }}</span>

    <div
      v-if="playing"
      class="pointer-events-none absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-primary"
      :style="{ left: `${playing.progress * 100}%` }"
    />

    <ScoreLane
      v-if="overlays?.markers.length"
      :lane="overlays.markerLane"
      class="bottom-full left-0.5"
    >
      <div class="flex gap-0.5">
        <ScoreBadge
          v-for="{ marker, name } of overlays.markers"
          :key="`${marker.at.occurrence}-${marker.text}`"
          tone="marker"
          :name="name"
          selectable
          :selected="isMarkerSelected(selection, marker)"
          @select="emit('select-marker', marker)"
        >
          <i
            class="pi pi-bookmark text-[0.5625rem]"
            aria-hidden="true"
          />
          <span class="truncate">{{ marker.text }}</span>
        </ScoreBadge>
      </div>
    </ScoreLane>

    <i
      v-if="overlays?.synced"
      class="pi pi-map-marker absolute top-full left-0 mt-0.25 -translate-x-1/2 text-[0.625rem]"
      :class="SYNC_POINT_COLORS.onScore"
      aria-hidden="true"
    />

    <template
      v-if="editMode"
      #top-start
    >
      <ScoreBadge :tone="review ? 'review' : 'primary'">
        {{ measure.label }}
      </ScoreBadge>
    </template>

    <template
      v-if="overlays?.jumps.length"
      #bottom-end
    >
      <ScoreBadge
        v-for="jump of overlays.jumps"
        :key="jump.key"
        tone="neutral"
        :name="jump.name"
      >
        {{ jump.text }}
      </ScoreBadge>
    </template>

    <template v-if="resizable">
      <BoxResizeHandle
        v-for="edge of EDGES"
        :key="edge"
        :edge="edge"
        @move="emit('resize', edge, $event)"
        @end="emit('resize-end')"
      />
    </template>
  </ScoreBox>
</template>
