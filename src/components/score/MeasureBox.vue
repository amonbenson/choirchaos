<script setup lang="ts">
import { computed, useId } from "vue";

import type { Marker } from "@/core/models/markers";
import Measure, { type MeasureLayout, needsReview } from "@/core/models/measure";
import type { BoxEdge } from "@/core/models/measureEditing";
import type { BoxOverlays, CaesuraMark } from "@/core/models/scoreOverlays";
import type { CaesuraSection } from "@/core/models/sections";
import { isCaesuraSelected, isMarkerSelected, isMeasureSelected, type Selection } from "@/core/models/selection";

import BoxResizeHandle from "./BoxResizeHandle.vue";
import MeasurePlaybar from "./MeasurePlaybar.vue";
import ScoreBadge from "./ScoreBadge.vue";
import ScoreBox from "./ScoreBox.vue";
import ScoreLane from "./ScoreLane.vue";
import { SECTION_COLORS } from "./sectionColors";

const props = defineProps<{
  measure: Measure;
  /** The measure's layout, or where a running resize drag has moved it. */
  layout: MeasureLayout;
  editMode: boolean;
  selection: Selection;
  overlays?: BoxOverlays;
  /** The playhead is in this measure. */
  playing: boolean;
  resizable: boolean;
  dimmed: boolean;
}>();

const emit = defineEmits<{
  "select-marker": [marker: Marker];
  "select-caesura": [caesura: CaesuraSection];
  "resize": [edge: BoxEdge, delta: { x: number; y: number }];
  "resize-end": [];
}>();

const EDGES: readonly BoxEdge[] = ["top", "right", "bottom", "left"];

const descriptionId = useId();

const selected = computed(() => props.editMode && isMeasureSelected(props.selection, props.measure.id));

const review = computed(() => needsReview(props.measure.layout));

/** Caesura badges sit above the marker badges, on the side of their line that lies inside the box. */
const caesuraLane = computed(() => (props.overlays?.markerLane ?? 0) + (props.overlays?.markers.length ? 1 : 0));

function caesuraBadgeStyle({ x }: CaesuraMark): Record<string, string> {
  return x > 0.5 ? { right: `${(1 - x) * 100}%` } : { left: `${x * 100}%` };
}

const surfaceClass = computed(() => {
  if (!props.editMode) {
    return "hover:bg-primary/25";
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

    <MeasurePlaybar v-if="playing" />

    <div
      v-for="caesura of overlays?.caesuras"
      :key="`caesura-line-${caesura.x}`"
      class="pointer-events-none absolute -inset-y-1 w-1 -translate-x-1/2 rounded-full"
      :class="SECTION_COLORS.caesura.background"
      :style="{ left: `${caesura.x * 100}%` }"
    />

    <template v-if="editMode">
      <ScoreLane
        v-for="caesura of overlays?.caesuras"
        :key="`caesura-badge-${caesura.x}`"
        :lane="caesuraLane"
        class="bottom-full"
        :style="caesuraBadgeStyle(caesura)"
      >
        <ScoreBadge
          tone="caesura"
          :name="caesura.name"
          selectable
          :selected="isCaesuraSelected(selection, caesura.section)"
          @select="emit('select-caesura', caesura.section)"
        >
          Caesura
        </ScoreBadge>
      </ScoreLane>
    </template>

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
