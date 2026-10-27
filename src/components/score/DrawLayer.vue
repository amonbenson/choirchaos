<script setup lang="ts">
import { usePointerSwipe } from "@vueuse/core";
import { computed, useTemplateRef } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import type { MeasureLayout } from "@/core/models/measure";
import { normalizeLayout, splitLayout } from "@/core/models/measureEditing";

import type { VisiblePage } from "./PdfViewer.vue";
import ScoreBox from "./ScoreBox.vue";
import ScorePage from "./ScorePage.vue";

const props = defineProps<{
  pages: readonly VisiblePage[];
}>();

const { pendingBox, pendingCount } = injectMeasureEditor();

type ScreenPoint = { x: number; y: number };

const MIN_DRAG_PIXELS = 4;
const MIN_BOX_SIZE = 0.005;

const layer = useTemplateRef<HTMLElement>("layer");

const { isSwiping, posStart, posEnd } = usePointerSwipe(layer, {
  threshold: MIN_DRAG_PIXELS,
  onSwipeEnd: finishDrawing,
});

/** The page under a point in screen pixels. The layer covers the overlay, whose fractions place the pages. */
function findPageAt(point: ScreenPoint): { page: VisiblePage; rect: DOMRect } | undefined {
  const bounds = layer.value?.getBoundingClientRect();
  if (!bounds) {
    return undefined;
  }

  return props.pages.map(page => ({
    page,
    rect: new DOMRect(bounds.left + page.x * bounds.width, bounds.top + page.y * bounds.height, page.width * bounds.width, page.height * bounds.height),
  })).find(({ rect }) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
}

/** The drag relative to the page it started on. It may reach beyond the page. */
function dragOnPage(start: ScreenPoint, end: ScreenPoint): MeasureLayout | undefined {
  const target = findPageAt(start);
  if (!target || target.rect.width === 0 || target.rect.height === 0) {
    return undefined;
  }

  const { page, rect } = target;
  return normalizeLayout({
    page: page.pageNumber,
    x: (start.x - rect.left) / rect.width,
    y: (start.y - rect.top) / rect.height,
    width: (end.x - start.x) / rect.width,
    height: (end.y - start.y) / rect.height,
  });
}

function clampToPage(layout: MeasureLayout): MeasureLayout {
  const x = Math.max(0, layout.x);
  const y = Math.max(0, layout.y);
  return { page: layout.page, x, y, width: Math.min(1, layout.x + layout.width) - x, height: Math.min(1, layout.y + layout.height) - y };
}

function finishDrawing(): void {
  const rect = dragOnPage(posStart, posEnd);
  if (rect && rect.width >= MIN_BOX_SIZE && rect.height >= MIN_BOX_SIZE) {
    pendingBox.value = clampToPage(rect);
  }
}

const drawnRect = computed(() => isSwiping.value ? dragOnPage(posStart, posEnd) : undefined);

/** The box waiting for the inspector to say what it holds, split into the measures it will hold. */
const pendingParts = computed(() => pendingBox.value ? splitLayout(pendingBox.value, Math.max(1, pendingCount.value)) : []);
</script>

<template>
  <div
    ref="layer"
    class="absolute inset-0 cursor-crosshair touch-none"
  >
    <ScorePage
      v-for="page of pages"
      :key="page.pageNumber"
      :page="page"
      class="pointer-events-none"
    >
      <ScoreBox
        v-for="(part, i) of pendingParts.filter(part => part.page === page.pageNumber)"
        :key="i"
        :layout="part"
        class="bg-primary/20 outline outline-primary outline-dashed"
      />
      <ScoreBox
        v-if="drawnRect?.page === page.pageNumber"
        :layout="drawnRect"
        class="bg-primary/20 outline outline-primary"
      />
    </ScorePage>
  </div>
</template>
