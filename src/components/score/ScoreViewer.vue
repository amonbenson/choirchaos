<script setup lang="ts">
import { onLongPress, useEventListener, useKeyModifier } from "@vueuse/core";
import { computed, ref, shallowRef, watch } from "vue";

import { type ClickIntent, getClickIntent, injectEditorSelection } from "@/composables/useEditorSelection";
import { useMarqueeSelection } from "@/composables/useMarqueeSelection";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import type { Marker } from "@/core/models/markers";
import Measure, { type MeasureId, type MeasureLayout, needsReview } from "@/core/models/measure";
import { type BoxEdge, planLayouts, resizeBox } from "@/core/models/measureEditing";
import {
  type BoxOverlays,
  findRecordingJumps,
  getBoxOverlays,
  getSectionBars,
  getSectionOverlays,
} from "@/core/models/scoreOverlays";
import { getSectionRun, type Section } from "@/core/models/sections";
import {
  getSelectableMeasures,
  isBoxSelected,
  isMeasureSelected,
  isSectionSelected,
  NO_SELECTION,
  type Selection,
  selectMeasures,
  toggleBox,
  toggleMeasure,
} from "@/core/models/selection";
import Song from "@/core/models/song";
import { getSyncedOccurrences } from "@/core/models/warpEditing";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import { resolveUrl } from "@/core/utils/file";
import { usePlayerStore } from "@/stores/player";
import { type ArrangementKey, useSettingsStore } from "@/stores/settings";

import DrawLayer from "./DrawLayer.vue";
import MeasureBox from "./MeasureBox.vue";
import PdfViewer, { type ViewInsets } from "./PdfViewer.vue";
import ScoreBadge from "./ScoreBadge.vue";
import ScoreBox from "./ScoreBox.vue";
import ScorePage from "./ScorePage.vue";
import SectionBar from "./SectionBar.vue";
import SectionRange from "./SectionRange.vue";

const player = usePlayerStore();
const { notifyError } = useNotify();
const editor = injectMeasureEditor();
const { drawing, pendingBox, detection, revealRequest } = editor;
const editorSelection = injectEditorSelection();
const { selection, selected, touchMultiSelect } = editorSelection;

const props = defineProps<{
  song?: Song;
  editMode?: boolean;
  /** Pixels at the bottom of the score that a panel covers, such as the inspector's bottom sheet. */
  coveredBottom?: number;
}>();

const emit = defineEmits<{
  "pdf-loading": [loading: boolean];
}>();

const pdfViewer = ref();
const overlayRoot = ref<HTMLElement>();

function groupByPage<T>(items: readonly T[], layoutOf: (item: T) => MeasureLayout | undefined): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const page = layoutOf(item)?.page;
    if (page !== undefined) {
      groups.set(page, [...groups.get(page) ?? [], item]);
    }
  }

  return groups;
}

// Measures

/** Layouts of a running resize drag, shown until the drag ends and the edit is saved. */
const resizePreview = shallowRef(new Map<MeasureId, MeasureLayout>());

function layoutOf(measure: Measure): MeasureLayout | undefined {
  return resizePreview.value.get(measure.id) ?? measure.layout;
}

const measuresByPage = computed(() => groupByPage(props.song?.getMeasures() ?? [], layoutOf));

function isResizable(measure: Measure): boolean {
  const current = selected.value;
  return !!props.editMode && !drawing.value && current.kind === "measures" && current.measures.length === 1 && current.measures[0]!.id === measure.id;
}

// Detection preview and boxes without a number

type PreviewBox = {
  label?: string;
  layout: MeasureLayout;
};

const previewing = computed(() => !!props.editMode && !!detection.plan.value);

const previewByPage = computed(() => {
  const plan = props.editMode ? detection.plan.value : undefined;
  if (!plan) {
    return new Map<number, PreviewBox[]>();
  }

  const boxes: PreviewBox[] = [
    ...plan.placements.map(({ measure, layout }) => ({ label: measure.label, layout })),
    ...plan.additions.map(addition => ({ label: addition.label, layout: addition.layout! })),
    ...plan.unnumbered.map(layout => ({ layout })),
  ];
  return groupByPage(boxes, box => box.layout);
});

const replacedMeasures = computed(() => new Set(detection.plan.value?.placements.map(placement => placement.measure.id)));

const unnumberedByPage = computed(() => props.editMode ? groupByPage(editor.unnumberedBoxes.value, box => box) : new Map<number, MeasureLayout[]>());

function visibleMeasures(page: number): Measure[] {
  const measures = measuresByPage.value.get(page) ?? [];
  return previewing.value ? measures.filter(measure => !replacedMeasures.value.has(measure.id)) : measures;
}

type PreviewTone = "unnumbered" | "review" | "primary";

const PREVIEW_SURFACES: Record<PreviewTone, string> = {
  unnumbered: "outline-danger bg-danger/10",
  review: "outline-warn bg-warn/15",
  primary: "outline-primary bg-primary/10",
};

function previewTone(box: PreviewBox): PreviewTone {
  if (box.label === undefined) {
    return "unnumbered";
  }

  return needsReview(box.layout) ? "review" : "primary";
}

function unnumberedClass(box: MeasureLayout): string {
  return isBoxSelected(selection.value, box)
    ? "outline-2 outline-primary bg-primary/30"
    : "outline-2 outline-danger/80 bg-danger/10 hover:bg-danger/20";
}

// Playback

const currentMeasureId = computed(() => player.currentTimelinePosition?.measure);

// Arrangement

const settings = useSettingsStore();

/** Rehearsers choose which parts of the arrangement the score shows. */
const isArrangementVisible = (key: ArrangementKey): boolean => !!props.editMode || settings.current.appearance.arrangementVisible[key];

const sectionOverlays = computed(() => props.song
  ? getSectionOverlays(
      props.song.getMeasures(),
      props.song.getTimeline(),
      props.song.getSections().filter(section => isArrangementVisible(section.kind)),
      { cutBars: !!props.editMode },
    )
  : []);

const sectionBars = computed(() => props.song ? getSectionBars(props.song.getMeasures(), sectionOverlays.value) : []);

const cutBoxes = computed(() => sectionOverlays.value
  .filter(overlay => overlay.section.kind === "cut")
  .flatMap(overlay => overlay.measures.flatMap(id => props.song?.findMeasure(id)?.layout ?? [])));

/** Sync points only matter while editing an audio song. */
const syncedOccurrences = computed(() => props.editMode && props.song?.playerMode === "audio"
  ? getSyncedOccurrences(props.song.getTimeline(), props.song.getWarpMarkers())
  : new Map<MeasureId, number[]>());

const boxOverlays = computed(() => {
  const song = props.song;
  if (!song) {
    return new Map<MeasureId, BoxOverlays>();
  }

  const timeline = song.getTimeline();
  return getBoxOverlays({
    measures: song.getMeasures(),
    timeline,
    sections: sectionOverlays.value,
    markers: isArrangementVisible("marker") ? song.getMarkers() : [],
    jumps: props.editMode ? findRecordingJumps(song.getMeasures(), timeline) : [],
    synced: syncedOccurrences.value,
  });
});

/** The selected section gets range handles, unless the score is busy drawing or previewing. */
const rangeTarget = computed(() => {
  const current = selected.value;
  const section = props.editMode && !drawing.value && !previewing.value && current.kind === "section" ? current.section : undefined;
  const lane = sectionOverlays.value.find(overlay => overlay.section === section)?.lane ?? 0;
  return section && props.song && getSectionRun(props.song.getTimeline(), section) ? { section, lane } : undefined;
});

/** A click on a section or marker badge selects it in the editor. While rehearsing it only moves the playhead there. */
function selectObject(object: { section: Section } | { marker: Marker }): void {
  const next = "section" in object
    ? { kind: "section" as const, from: object.section.from }
    : { kind: "marker" as const, marker: object.marker };
  if (props.editMode) {
    editorSelection.selectAndSeek(next);
  } else {
    player.seekLocation("section" in object ? object.section.from : object.marker.at);
  }
}

watch(() => props.song, () => {
  if (props.song) {
    pdfViewer.value?.zoomToPage(0);
  }
});

// Keeping boxes in view

watch(currentMeasureId, (id) => {
  const layout = id === undefined ? undefined : props.song?.findMeasure(id)?.layout;
  if (layout) {
    scrollToLayout(layout);
  }
});

watch(revealRequest, (request) => {
  if (request) {
    scrollToLayout(request.layout);
  }
});

const viewInsets = computed<ViewInsets>(() => ({ top: 0, bottom: props.coveredBottom ?? 0 }));

type ClickedBox = { measureId: MeasureId } | { box: MeasureLayout };

/** The box clicked last, kept in view while it stays selected. */
let lastClicked: ClickedBox | undefined;

function getLastClickedLayout(): MeasureLayout | undefined {
  const clicked = lastClicked;
  if (!clicked) {
    return undefined;
  }

  if ("box" in clicked) {
    return isBoxSelected(selection.value, clicked.box) ? clicked.box : undefined;
  }

  const current = selected.value;
  return current.kind === "measures" ? current.measures.find(measure => measure.id === clicked.measureId)?.layout : undefined;
}

// Selecting expands the bottom sheet, which would otherwise cover the box that was just clicked.
// Post flush, so the viewer already knows the new insets.
watch(() => props.coveredBottom ?? 0, (covered, previous) => {
  const layout = getLastClickedLayout();
  if (layout && covered > previous) {
    scrollToLayout(layout);
  }
}, { flush: "post" });

function scrollToLayout(layout: MeasureLayout): void {
  if (!pdfViewer.value) {
    return;
  }

  const tl: PageCoordinate = { x: layout.x, y: layout.y, p: layout.page };
  const br: PageCoordinate = { x: layout.x + layout.width, y: layout.y + layout.height, p: layout.page };
  const isVisible = (): boolean => pdfViewer.value.isLocationVisible(tl) && pdfViewer.value.isLocationVisible(br);

  if (isVisible()) {
    return;
  }

  const center: PageCoordinate = { x: 0.5, y: layout.y + layout.height / 2, p: layout.page };
  pdfViewer.value.moveToLocation(center, { axis: "horizontal" });

  if (!isVisible()) {
    pdfViewer.value.moveToLocation(center, { axis: "both" });
  }

  if (!isVisible()) {
    pdfViewer.value.moveToLocation(
      { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2, p: layout.page },
      { axis: "both" },
    );
  }

  pdfViewer.value.redraw();
}

// Keys

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function isSelectAll(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a";
}

useEventListener("keydown", (event: KeyboardEvent) => {
  if (!props.editMode || isTyping(event.target)) {
    return;
  }

  if (isSelectAll(event) && !previewing.value) {
    event.preventDefault();
    editorSelection.selectAllMeasures();
  } else if (event.key === "Escape") {
    stepBack();
  }
});

/** Escape steps back once: from a selection box to the selection before it, from a drawn box to drawing, from drawing to selecting, and from a selection to none. */
function stepBack(): void {
  if (marquee.cancel()) {
    return;
  }

  if (pendingBox.value) {
    pendingBox.value = undefined;
  } else if (drawing.value) {
    editor.stopDrawing();
  } else {
    editorSelection.clear();
  }
}

// Clicking
// A drag pans the score, and the viewer swallows the click that ends it, so only real clicks get here.
// Clicks on boxes stop at the box, so the overlay only gets clicks on empty space.

let lastPointerType: string = "mouse";
let suppressNextClick = false;

function rememberPointerType(event: PointerEvent): void {
  lastPointerType = event.pointerType;
}

function getIntent(event: MouseEvent): ClickIntent {
  return getClickIntent(event, lastPointerType, touchMultiSelect.value);
}

/** A repeated measure is always entered at its first pass. Other passes are reached through the inspector or the timeline. */
function seekMeasure(measure: Measure): void {
  player.seekLocation({ measure: measure.id, occurrence: 1, beat: 0 });
}

/** A click always moves the playhead. In edit mode it also selects. */
function onBoxClick(event: MouseEvent, measure: Measure): void {
  if (!props.editMode) {
    seekMeasure(measure);
    return;
  }

  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  lastClicked = { measureId: measure.id };
  editorSelection.clickMeasure(measure.id, getIntent(event));

  if (isMeasureSelected(selection.value, measure.id)) {
    seekMeasure(measure);
  }
}

function onUnnumberedClick(event: MouseEvent, box: MeasureLayout): void {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  lastClicked = { box };
  editorSelection.select(getIntent(event) === "select" ? { kind: "boxes", boxes: [box] } : toggleBox(selection.value, box));
}

/** A click on empty space clears the selection, unless a modifier asks to add to it. */
function onEmptyClick(event: MouseEvent): void {
  if (drawing.value || previewing.value || event.shiftKey || event.ctrlKey || event.metaKey) {
    return;
  }

  editorSelection.clear();
}

function findDataAt(target: EventTarget | null, attribute: string): string | undefined {
  return (target as Element | null)?.closest<HTMLElement>(`[data-${attribute}]`)?.getAttribute(`data-${attribute}`) ?? undefined;
}

function findMeasureAt(target: EventTarget | null): Measure | undefined {
  const id = findDataAt(target, "measure");
  return id === undefined ? undefined : editor.measures.value.find(measure => measure.id === id);
}

function findUnnumberedBoxAt(target: EventTarget | null): MeasureLayout | undefined {
  const index = findDataAt(target, "unnumbered-box");
  const page = findDataAt(target, "page");
  return index === undefined || page === undefined ? undefined : unnumberedByPage.value.get(Number(page))?.[Number(index)];
}

/** Adds what was pressed to the selection. True when a measure or a box was pressed. */
function addForMultiSelect(target: EventTarget | null): boolean {
  const measure = findMeasureAt(target);
  if (measure) {
    if (!isMeasureSelected(selection.value, measure.id)) {
      editorSelection.select(toggleMeasure(selection.value, measure.id));
    }

    return true;
  }

  const box = findUnnumberedBoxAt(target);
  if (box && !isBoxSelected(selection.value, box)) {
    editorSelection.select(toggleBox(selection.value, box));
  }

  return !!box;
}

// On touch a long press starts multi-select. The pressed box is selected before the mode starts,
// because a selection of one measure ends multi-select.
onLongPress(overlayRoot, (event) => {
  if (!props.editMode || drawing.value || event.pointerType === "mouse" || previewing.value) {
    return;
  }

  if (addForMultiSelect(event.target)) {
    touchMultiSelect.value = true;
    suppressNextClick = true;
  }
});

// Selection box
// Shift and a drag select the measures the box touches while it moves. Ctrl/Cmd adds them to the selection.

const canDrawMarquee = computed(() => !!props.editMode && !drawing.value && !previewing.value);

// Mouse events too, so a Shift released while another window had focus is noticed on the next move.
const shiftHeld = useKeyModifier("Shift", { events: ["mousedown", "mouseup", "mousemove", "keydown", "keyup"] });

let selectionBeforeMarquee: Selection = NO_SELECTION;
let addsToSelection = false;

const marquee = useMarqueeSelection(overlayRoot, {
  canStart: () => canDrawMarquee.value,
  onStart: (event) => {
    selectionBeforeMarquee = selection.value;
    addsToSelection = event.ctrlKey || event.metaKey;
  },
  onChange: selectInBox,
  onCancel: () => editorSelection.select(selectionBeforeMarquee),
});

/** Measures whose box, as drawn, overlaps the selection box. */
function findMeasuresInBox(box: DOMRect): Set<MeasureId> {
  const elements = overlayRoot.value?.querySelectorAll<HTMLElement>("[data-measure]") ?? [];
  return new Set([...elements].flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const overlaps = rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom;
    return overlaps && element.dataset.measure ? [element.dataset.measure] : [];
  }));
}

function selectInBox(box: DOMRect): void {
  if (!props.song) {
    return;
  }

  const ids = findMeasuresInBox(box);
  const before = selectionBeforeMarquee;
  const kept = addsToSelection && before.kind === "measures" ? before.ids : [];
  const next = getSelectableMeasures(props.song)
    .map(measure => measure.id)
    .filter(id => ids.has(id) || kept.includes(id));
  editorSelection.select(selectMeasures(next));
}

/** While Shift is held a press draws a selection box, so the score shows the arrow instead of the hand. */
const cursorLock = computed(() => marquee.area.value || (shiftHeld.value && canDrawMarquee.value) ? "default" as const : undefined);

// Resizing

function onResize(measure: Measure, edge: BoxEdge, delta: { x: number; y: number }): void {
  const layouts = resizeBox(editor.measures.value, measure, edge, delta);
  resizePreview.value = new Map(layouts.map(([box, layout]) => [box.id, layout]));
}

/** Saves the drag as one edit. The neighbours it moved stay unselected, so the handles stay on the dragged box. */
async function onResizeEnd(measure: Measure): Promise<void> {
  const changes = editor.measures.value.flatMap((other) => {
    const layout = resizePreview.value.get(other.id);
    return layout ? [[other, layout] as [Measure, MeasureLayout]] : [];
  });

  try {
    if (changes.length > 0) {
      await editor.apply(planLayouts(changes));
      editorSelection.select(selectMeasures([measure.id]));
    }
  } catch (error) {
    notifyError("Could not save the measure boxes", error);
  } finally {
    resizePreview.value = new Map();
  }
}
</script>

<template>
  <PdfViewer
    ref="pdfViewer"
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    :pannable="!editMode || !drawing"
    :insets="viewInsets"
    :cursor-lock="cursorLock"
    role="region"
    aria-label="Score"
    @loading-change="emit('pdf-loading', $event)"
  >
    <template #default="{ visiblePages }">
      <!-- While editing, the overlay takes the clicks on empty space, which clear the selection -->
      <div
        ref="overlayRoot"
        class="absolute inset-0"
        :class="editMode ? 'pointer-events-auto' : 'pointer-events-none'"
        @pointerdown.capture="rememberPointerType"
        @click="editMode && onEmptyClick($event)"
      >
        <ScorePage
          v-for="page of visiblePages"
          :key="page.pageNumber"
          :page="page"
          :class="previewing ? '**:pointer-events-none' : ''"
          role="group"
          :aria-label="`Page ${page.pageNumber + 1}`"
          :data-page="page.pageNumber"
        >
          <ScoreBox
            v-for="(layout, i) of cutBoxes.filter(box => box.page === page.pageNumber)"
            :key="`cut-${i}`"
            :layout="layout"
            class="hatch-section-cut"
          />

          <MeasureBox
            v-for="measure of visibleMeasures(page.pageNumber)"
            :key="measure.id"
            :measure="measure"
            :layout="layoutOf(measure)!"
            :edit-mode="!!editMode"
            :selection="selection"
            :overlays="boxOverlays.get(measure.id)"
            :playing="currentMeasureId === measure.id"
            :resizable="isResizable(measure)"
            :dimmed="previewing"
            @click.stop="onBoxClick($event, measure)"
            @contextmenu.stop.prevent
            @select-marker="marker => selectObject({ marker })"
            @resize="(edge, delta) => onResize(measure, edge, delta)"
            @resize-end="onResizeEnd(measure)"
          />

          <ScoreBox
            v-for="(box, i) of unnumberedByPage.get(page.pageNumber) ?? []"
            :key="`unnumbered-${i}`"
            :layout="box"
            :class="previewing ? 'opacity-40' : ''"
            :data-unnumbered-box="i"
            @click.stop="onUnnumberedClick($event, box)"
            @contextmenu.stop.prevent
          >
            <div
              class="pointer-events-auto absolute inset-0 cursor-pointer transition-colors select-none"
              :class="unnumberedClass(box)"
              role="button"
              aria-label="Box without a number"
              :aria-pressed="isBoxSelected(selection, box)"
            />
            <template #top-start>
              <ScoreBadge tone="unnumbered">
                ?
              </ScoreBadge>
            </template>
          </ScoreBox>

          <ScoreBox
            v-for="(box, i) of previewByPage.get(page.pageNumber) ?? []"
            :key="`preview-${i}`"
            :layout="box.layout"
            class="outline-2 outline-dashed"
            :class="PREVIEW_SURFACES[previewTone(box)]"
            role="img"
            :aria-label="box.label === undefined ? 'Detected box without a number' : `Detected measure ${box.label}`"
          >
            <template #top-start>
              <ScoreBadge :tone="previewTone(box)">
                {{ box.label ?? "?" }}
              </ScoreBadge>
            </template>
          </ScoreBox>

          <SectionBar
            v-for="bar of sectionBars.filter(item => item.run.page === page.pageNumber)"
            :key="bar.key"
            :bar="bar"
            :selected="!!editMode && isSectionSelected(selection, bar.section)"
            @select="selectObject({ section: bar.section })"
          />
        </ScorePage>

        <SectionRange
          v-if="song && rangeTarget"
          :song="song"
          :section="rangeTarget.section"
          :lane="rangeTarget.lane"
          :pages="visiblePages"
        />

        <DrawLayer
          v-if="editMode && drawing && !previewing"
          :pages="visiblePages"
        />

        <ScoreBox
          v-if="marquee.area.value"
          :layout="{ page: 0, ...marquee.area.value }"
          class="bg-primary/10 outline outline-primary"
          aria-hidden="true"
        />
      </div>
    </template>
  </PdfViewer>
</template>
