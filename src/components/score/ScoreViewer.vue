<script setup lang="ts">
import { onLongPress, useElementSize, useEventListener } from "@vueuse/core";
import SelectButton from "primevue/selectbutton";
import { computed, type ComputedRef, nextTick, ref, shallowRef, useId, watch } from "vue";

import Draggable from "@/components/base/Draggable.vue";
import { SYNC_POINT_COLORS } from "@/components/editor/warp/syncColors";
import { injectMeasureEditor, type MeasureTool } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import { formatLocation, formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import Measure, { type MeasureId, type MeasureLayout, needsReview } from "@/core/models/measure";
import { getReadingOrder, intersects, normalizeLayout, planLayouts, splitLayout } from "@/core/models/measureEditing";
import { findNearestPosition, formatSectionName, getSectionRun, type SelectedRun, withRun } from "@/core/models/measureSelection";
import { countOccurrences } from "@/core/models/recording";
import {
  describeJump,
  describeOverlays,
  describeSection,
  findRecordedRepeats,
  findRecordingJumps,
  formatJumpChip,
  formatSectionChip,
  getMarkerOverlays,
  getSectionOverlays,
  type OverlayRun,
} from "@/core/models/scoreOverlays";
import { type SectionKind, validateSections } from "@/core/models/sections";
import Song from "@/core/models/song";
import { getSyncedOccurrences } from "@/core/models/warpEditing";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import { resolveUrl } from "@/core/utils/file";
import { usePlayerStore } from "@/stores/player";

import PdfViewer, { type ViewInsets } from "./PdfViewer.vue";
import { SECTION_COLORS, SECTION_CONTRAST_TEXT } from "./sectionColors";

const player = usePlayerStore();
const { notifyError } = useNotify();
const editor = injectMeasureEditor();
const { tool, pendingBox, pendingCount, touchMultiSelect, detection, revealRequest } = editor;

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

// ── Measure data ──────────────────────────────────────────────────────────────

const measuresByPage = computed<{ [key: number]: Measure[] }>(() => {
  if (!props.song) {
    return {};
  }

  const groups: { [key: number]: Measure[] } = {};
  for (const measure of props.song.getMeasures()) {
    const layout = layoutOf(measure);
    if (layout) {
      const p = layout.page;
      if (!Array.isArray(groups[p])) {
        groups[p] = [];
      }

      groups[p].push(measure);
    }
  }

  return groups;
});

// ── Detection preview and review marks ───────────────────────────────────────

type PreviewBox = {
  label?: string;
  layout: MeasureLayout;
};

const previewing = computed(() => !!props.editMode && !!detection.plan.value);

const previewByPage = computed(() => {
  const plan = props.editMode ? detection.plan.value : undefined;
  if (!plan) {
    return {};
  }

  const boxes: PreviewBox[] = [
    ...plan.placements.map(({ measure, layout }) => ({ label: measure.label, layout })),
    ...plan.additions.map(addition => ({ label: addition.label, layout: addition.layout! })),
    ...plan.unnumbered.map(layout => ({ layout })),
  ];
  return groupByPage(boxes, box => box.layout);
});

const replacedMeasures = computed(() => new Set(detection.plan.value?.placements.map(placement => placement.measure.id)));

const unnumberedByPage = computed(() => props.editMode ? groupByPage(editor.unnumberedBoxes.value, box => box) : {});

function groupByPage<T>(items: readonly T[], layoutOf: (item: T) => MeasureLayout): { [key: number]: T[] } {
  const groups: { [key: number]: T[] } = {};
  for (const item of items) {
    const page = layoutOf(item).page;
    groups[page] = [...groups[page] ?? [], item];
  }

  return groups;
}

function visibleMeasures(page: number): Measure[] {
  const measures = measuresByPage.value[page] ?? [];
  return previewing.value ? measures.filter(measure => !replacedMeasures.value.has(measure.id)) : measures;
}

const CHIP_CLASS = "pointer-events-none absolute top-0 left-0 rounded-br-sm px-1 text-[0.625rem] leading-4 font-semibold";

function chipClass(layout: MeasureLayout | undefined, numbered: boolean): string[] {
  if (!numbered) {
    return [CHIP_CLASS, "bg-red-500 text-white"];
  }

  return [CHIP_CLASS, needsReview(layout) ? "bg-amber-400 text-amber-950" : "bg-primary text-primary-contrast"];
}

function previewClass(box: PreviewBox): string {
  if (box.label === undefined) {
    return "border-red-500 bg-red-500/10";
  }

  return needsReview(box.layout) ? "border-amber-500 bg-amber-400/15" : "border-primary bg-primary/10";
}

function unnumberedClass(box: MeasureLayout): string[] {
  const interaction = activeTool.value === "draw" || previewing.value ? "pointer-events-none" : "";
  const state = editor.isBoxSelected(box)
    ? "border-2 border-primary bg-primary/30"
    : "border-2 border-red-500/80 bg-red-500/10 hover:bg-red-500/20";
  return [interaction, state, previewing.value ? "opacity-40" : ""];
}

const highlightedTracks: ComputedRef<Set<number>> = computed(
  () => new Set(props.song?.tracks.flatMap((t, i) => t.mixer.highlight ? [i] : []) ?? []),
);

function isMeasureHighlighted(measure: Measure): boolean {
  for (const i of player.measureTrackIndices.get(measure.id) ?? []) {
    if (highlightedTracks.value.has(i)) {
      return true;
    }
  }

  return false;
}

function boxStyle(layout: MeasureLayout): Record<string, string> {
  return {
    left: `${layout.x * 100}%`,
    top: `${layout.y * 100}%`,
    width: `${layout.width * 100}%`,
    height: `${layout.height * 100}%`,
  };
}

function boxClass(measure: Measure): string[] {
  if (!props.editMode) {
    return ["cursor-pointer", isMeasureHighlighted(measure) ? "bg-sky-400/25 hover:bg-sky-400/45" : "bg-primary/0 hover:bg-primary/25"];
  }

  const interaction = activeTool.value === "draw" || previewing.value ? "pointer-events-none" : "";
  return [interaction, measureStateClass(measure), previewing.value ? "opacity-40" : ""];
}

function measureStateClass(measure: Measure): string {
  if (editor.isSelected(measure)) {
    return "border-2 border-primary bg-primary/30";
  }

  return needsReview(measure.layout)
    ? "border-2 border-amber-500 bg-amber-400/15 hover:bg-amber-400/30"
    : "border border-primary/70 bg-primary/10 hover:bg-primary/25";
}

function hasHandles(measure: Measure): boolean {
  return activeTool.value !== "draw" && editor.selection.value.length === 1 && editor.isSelected(measure);
}

// ── Playback sync ─────────────────────────────────────────────────────────────

const currentMeasureId = computed(() => player.currentLocation?.measure);

/** How far the current timeline position has played. Every pass of a measure moves the same box's playbar. */
const currentPositionProgress = computed(() => {
  const location = player.currentLocation;
  const position = location ? player.timeline[location.position] : undefined;
  if (!position) {
    return 0;
  }

  const start = position.beatTicks[0] ?? 0;
  const length = position.endTick - start;
  return length > 0 ? Math.max(0, Math.min(1, (player.position - start) / length)) : 0;
});

/** The occurrence tag on the playing box, only for measures the recording plays more than once. */
const currentOccurrenceTag = computed(() => {
  const location = player.currentLocation;
  if (!location || !props.song || countOccurrences(props.song.getTimeline(), location.measure) < 2) {
    return undefined;
  }

  return formatTimes(location.occurrence);
});

watch(() => player.position, () => {
  pdfViewer.value?.redrawOverlay();
});

// Arrangement overlays. They never take pointer events, and every box describes its overlays, so
// screen readers hear them on the box. Only the first chip of a section is an image of its own.

/** Overlays of sections drawn on the same boxes stack upwards by this much. */
const LANE_HEIGHT_PX = 22;
const BAR_OFFSET_PX = 5;

type SectionBar = {
  key: string;
  run: OverlayRun;
  kind: SectionKind;
  lane: number;
  chip: string;
  name?: string;
};

type OverlayBox = { key: string; layout: MeasureLayout; text: string; name?: string };

const playingSection = computed(() => player.ready ? player.currentSection : undefined);

const sectionOverlays = computed(() => props.song
  ? getSectionOverlays(props.song.getMeasures(), props.song.getTimeline(), props.song.getSections())
  : []);

const recordedRepeats = computed(() => props.song ? findRecordedRepeats(props.song.getTimeline()) : []);

const sectionBars = computed<SectionBar[]>(() => sectionOverlays.value.flatMap(({ index, section, runs, lane }) => {
  const playing = playingSection.value?.section === index ? playingSection.value : undefined;
  const chip = formatSectionChip(section, playing);
  const name = describeSection(props.song!.getMeasures(), section, playing);
  return runs.map((run, i) => ({ key: `section-${index}-${i}`, run, kind: section.kind, lane, chip, name: i === 0 ? name : undefined }));
}));

const cutBoxes = computed(() => sectionOverlays.value
  .filter(overlay => overlay.section.kind === "cut")
  .flatMap(overlay => overlay.measures.flatMap(id => props.song?.findMeasure(id)?.layout ?? [])));

const recordedGlyphs = computed<OverlayBox[]>(() => recordedRepeats.value.flatMap(({ measures, times }, i) => {
  const layout = props.song?.findMeasure(measures.at(-1)!)?.layout;
  const labels = measures.map(id => props.song!.findMeasure(id)?.label ?? "?");
  const range = labels.length === 1 ? `Measure ${labels[0]}` : `Measures ${labels[0]} to ${labels.at(-1)}`;
  return layout ? [{ key: `recorded-${i}`, layout, text: `×${times}`, name: `${range} recorded ${times} times` }] : [];
}));

const recordingJumps = computed(() => props.song ? findRecordingJumps(props.song.getMeasures(), props.song.getTimeline()) : []);

/** One chip per jump at the barline it leaves from. Jumps after the same box stack upwards by `index`. */
const jumpChips = computed<(OverlayBox & { index: number })[]>(() => {
  const song = props.song;
  if (!song) {
    return [];
  }

  const counts = new Map<MeasureId, number>();
  return recordingJumps.value.flatMap((jump) => {
    const layout = song.findMeasure(jump.after.measure)?.layout;
    if (!layout) {
      return [];
    }

    const index = counts.get(jump.after.measure) ?? 0;
    counts.set(jump.after.measure, index + 1);
    const name = describeJump(song.getMeasures(), song.getTimeline(), jump);
    return [{ key: `jump-${jump.position}`, layout, index, text: formatJumpChip(song.getMeasures(), jump), name }];
  });
});

/** The highest lane of the sections drawn on each measure, so marker chips go above their chips. */
const topLanes = computed(() => {
  const lanes = new Map<MeasureId, number>();
  for (const { measures, lane } of sectionOverlays.value) {
    measures.forEach(id => lanes.set(id, Math.max(lane, lanes.get(id) ?? 0)));
  }

  return lanes;
});

const markerChips = computed<(OverlayBox & { lane?: number })[]>(() => props.song
  ? getMarkerOverlays(props.song.getMarkers()).flatMap(({ measure, texts }) => {
      const layout = props.song!.findMeasure(measure)?.layout;
      return layout ? [{ key: `marker-${measure}`, layout, text: texts.join(", "), lane: topLanes.value.get(measure) }] : [];
    })
  : []);

/** Sync points only matter while editing an audio song. One pin per measure, at its start. */
const syncedOccurrences = computed(() => props.editMode && props.song?.playerMode === "audio"
  ? getSyncedOccurrences(props.song.getTimeline(), props.song.getWarpMarkers())
  : new Map<MeasureId, number[]>());

const syncPins = computed(() => [...syncedOccurrences.value.keys()].flatMap((id) => {
  const layout = props.song?.findMeasure(id)?.layout;
  return layout ? [{ key: `sync-${id}`, layout }] : [];
}));

function describeSyncPin(measure: MeasureId, occurrences: readonly number[]): string {
  if (countOccurrences(props.song!.getTimeline(), measure) < 2) {
    return "Sync point";
  }

  const times = occurrences.map(formatOrdinal);
  const list = times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times.at(-1)}` : times[0];
  return `Sync point on the ${list} time`;
}

const overlayDescriptions = computed(() => {
  if (!props.song) {
    return new Map<MeasureId, string>();
  }

  const descriptions = describeOverlays({
    measures: props.song.getMeasures(),
    timeline: props.song.getTimeline(),
    sections: sectionOverlays.value,
    repeats: recordedRepeats.value,
    markers: props.song.getMarkers(),
    jumps: recordingJumps.value,
    playing: playingSection.value,
  });
  for (const [measure, occurrences] of syncedOccurrences.value) {
    const sync = `${describeSyncPin(measure, occurrences)}.`;
    const existing = descriptions.get(measure);
    descriptions.set(measure, existing ? `${existing} ${sync}` : sync);
  }

  return descriptions;
});

const descriptionIdPrefix = useId();

function descriptionId(measure: Measure): string | undefined {
  return overlayDescriptions.value.has(measure.id) ? `${descriptionIdPrefix}-${measure.id}` : undefined;
}

function onPage<T>(items: readonly T[], page: number, pageOf: (item: T) => number): T[] {
  return items.filter(item => pageOf(item) === page);
}

function sectionBarStyle({ run, lane }: SectionBar): Record<string, string> {
  return {
    left: `${run.x * 100}%`,
    width: `${run.width * 100}%`,
    top: `calc(${run.y * 100}% - ${BAR_OFFSET_PX + lane * LANE_HEIGHT_PX}px)`,
  };
}

function markerChipStyle({ layout, lane }: OverlayBox & { lane?: number }): Record<string, string> {
  const offset = lane === undefined ? 2 : BAR_OFFSET_PX + (lane + 1) * LANE_HEIGHT_PX;
  return { left: `calc(${layout.x * 100}% + 2px)`, top: `calc(${layout.y * 100}% - ${offset}px)` };
}

function syncPinStyle({ layout }: { layout: MeasureLayout }): Record<string, string> {
  return { left: `${layout.x * 100}%`, top: `calc(${(layout.y + layout.height) * 100}% + 1px)` };
}

function recordedGlyphStyle({ layout }: OverlayBox): Record<string, string> {
  return { left: `calc(${(layout.x + layout.width) * 100}% - 2px)`, top: `calc(${layout.y * 100}% + 2px)` };
}

const JUMP_CHIP_STEP_PX = 18;

function jumpChipStyle({ layout, index }: OverlayBox & { index: number }): Record<string, string> {
  return {
    left: `calc(${(layout.x + layout.width) * 100}% - 2px)`,
    top: `calc(${(layout.y + layout.height) * 100}% - ${2 + (index + 1) * JUMP_CHIP_STEP_PX}px)`,
  };
}

watch(() => props.song, () => {
  if (props.song) {
    pdfViewer.value?.zoomToPage(0);
    pdfViewer.value?.redrawAll();
  }
});

watch(highlightedTracks, () => {
  pdfViewer.value?.redrawOverlay();
});

// ── Auto-scroll to current measure ───────────────────────────────────────────

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

// The tool switcher floats this far below the top edge of the score.
const TOOLBAR_OFFSET_PX = 8;
const toolbar = ref();
const { height: toolbarHeight } = useElementSize(toolbar, undefined, { box: "border-box" });

const viewInsets = computed<ViewInsets>(() => ({
  top: props.editMode ? TOOLBAR_OFFSET_PX + toolbarHeight.value : 0,
  bottom: props.coveredBottom ?? 0,
}));

type ClickedBox = { measureId: MeasureId } | { box: MeasureLayout };

/** The box clicked last, kept in view while it stays selected. */
let lastClicked: ClickedBox | undefined;

function getLastClickedLayout(): MeasureLayout | undefined {
  const clicked = lastClicked;
  if (!clicked) {
    return undefined;
  }

  if ("box" in clicked) {
    return editor.isBoxSelected(clicked.box) ? clicked.box : undefined;
  }

  return editor.selection.value.find(measure => measure.id === clicked.measureId)?.layout;
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

  pdfViewer.value.redrawAll();
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOL_OPTIONS: { label: string; value: MeasureTool; icon: string }[] = [
  { label: "Select", value: "select", icon: "pi pi-arrow-up-left" },
  { label: "Move", value: "move", icon: "pi pi-arrows-alt" },
  { label: "Draw", value: "draw", icon: "pi pi-stop" },
];

const TOOL_CURSORS: Record<MeasureTool, string> = {
  select: "cursor-default",
  move: "cursor-grab active:cursor-grabbing",
  draw: "cursor-crosshair",
};

const shiftHeld = ref(false);

/** The tool the score works with. Holding Shift switches to Select for as long as it is held. */
const activeTool = computed<MeasureTool>(() => shiftHeld.value ? "select" : tool.value);

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

  if (event.key === "Shift") {
    shiftHeld.value = true;
  } else if (isSelectAll(event) && !previewing.value) {
    event.preventDefault();
    editor.selectAll();
  } else if (event.key === "Escape") {
    cancelOrDeselect();
  }
});

useEventListener("keyup", (event: KeyboardEvent) => {
  if (event.key === "Shift") {
    shiftHeld.value = false;
  }
});

useEventListener("blur", () => {
  shiftHeld.value = false;
});

function cancelOrDeselect(): void {
  if (pendingBox.value) {
    pendingBox.value = undefined;
  } else {
    editor.clearSelection();
  }
}

// ── Clicking boxes ────────────────────────────────────────────────────────────

let lastPointerType: string = "mouse";
let suppressNextClick = false;

function rememberPointerType(event: PointerEvent): void {
  lastPointerType = event.pointerType;
}

/** A click always moves the playhead. In edit mode it also selects, so the selected occurrence is the playing one. */
function onBoxClick(event: MouseEvent, measure: Measure): void {
  if (!props.editMode) {
    editor.seekMeasure(measure);
    return;
  }

  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  lastClicked = { measureId: measure.id };
  if (lastPointerType !== "mouse") {
    if (touchMultiSelect.value) {
      editor.toggle(measure);
    } else {
      editor.selectOnly(measure);
    }
  } else if (event.shiftKey) {
    editor.selectRange(measure);
  } else if (event.ctrlKey || event.metaKey) {
    editor.toggle(measure);
  } else {
    editor.selectOnly(measure);
  }

  if (editor.isSelected(measure)) {
    editor.seekMeasure(measure);
  }
}

function onUnnumberedClick(event: MouseEvent, box: MeasureLayout): void {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  lastClicked = { box };
  const toggles = lastPointerType === "mouse" ? event.shiftKey || event.ctrlKey || event.metaKey : touchMultiSelect.value;
  if (toggles) {
    editor.toggleBox(box);
  } else {
    editor.selectBox(box);
  }
}

function pageAt(target: EventTarget | null): number | undefined {
  const value = (target as Element | null)?.closest<HTMLElement>("[data-page]")?.dataset.page;
  return value === undefined ? undefined : Number(value);
}

function isOnBox(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest("[data-measure], [data-unnumbered-box]");
}

function findMeasureAt(target: EventTarget | null): Measure | undefined {
  const value = (target as Element | null)?.closest<HTMLElement>("[data-measure]")?.dataset.measure;
  return value === undefined ? undefined : editor.measures.value.find(measure => measure.id === value);
}

function findUnnumberedBoxAt(target: EventTarget | null): MeasureLayout | undefined {
  const index = (target as Element | null)?.closest<HTMLElement>("[data-unnumbered-box]")?.dataset.unnumberedBox;
  const page = pageAt(target);
  return index === undefined || page === undefined ? undefined : unnumberedByPage.value[page]?.[Number(index)];
}

function selectForMultiSelect(target: EventTarget | null): boolean {
  const measure = findMeasureAt(target);
  if (measure) {
    if (!editor.isSelected(measure)) {
      editor.toggle(measure);
    }

    return true;
  }

  const box = findUnnumberedBoxAt(target);
  if (box && !editor.isBoxSelected(box)) {
    editor.toggleBox(box);
  }

  return !!box;
}

// On touch a long press starts multi-select, after which taps add and remove boxes. The box is
// selected before the mode starts, because a selection of one box ends multi-select.
onLongPress(overlayRoot, (event) => {
  if (!props.editMode || activeTool.value === "draw" || event.pointerType === "mouse" || previewing.value) {
    return;
  }

  if (selectForMultiSelect(event.target)) {
    touchMultiSelect.value = true;
    suppressNextClick = true;
  }
});

// ── Gestures ──────────────────────────────────────────────────────────────────

type ScreenPoint = { x: number; y: number };

/**
 * One press on the score, in screen coordinates so a marquee can start beside the pages and reach
 * across them. It keeps the tool it started with and becomes a drag once it moves. With the Move
 * tool the viewer pans the drag, so only its taps matter here.
 */
type Gesture = {
  tool: MeasureTool;
  page?: number;
  start: ScreenPoint;
  end: ScreenPoint;
  dragging: boolean;
  onBox: boolean;
  additive: boolean;
  keepsSelection: boolean;
};

const MIN_DRAG_PIXELS = 4;
const MIN_BOX_SIZE = 0.005;
const gesture = shallowRef<Gesture>();

function screenPoint(e: PointerEvent): ScreenPoint {
  return { x: e.clientX, y: e.clientY };
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !e.isPrimary || previewing.value) {
    return;
  }

  gesture.value = {
    tool: activeTool.value,
    page: pageAt(e.target),
    start: screenPoint(e),
    end: screenPoint(e),
    dragging: false,
    onBox: isOnBox(e.target),
    additive: e.ctrlKey || e.metaKey,
    keepsSelection: e.shiftKey || e.ctrlKey || e.metaKey,
  };
}

// The pointer is captured only once a drag starts, because a capture retargets the click of a tap
// away from the box under the pointer.
function onPointerMove(e: PointerEvent): void {
  const current = gesture.value;
  if (!current) {
    return;
  }

  const end = screenPoint(e);
  const dragging = current.dragging || Math.hypot(end.x - current.start.x, end.y - current.start.y) >= MIN_DRAG_PIXELS;
  if (dragging && !current.dragging && current.tool !== "move") {
    overlayRoot.value?.setPointerCapture(e.pointerId);
  }

  gesture.value = { ...current, end, dragging };
}

function onPointerUp(): void {
  const current = gesture.value;
  gesture.value = undefined;
  if (!current) {
    return;
  }

  if (!current.dragging) {
    finishTap(current);
  } else if (current.tool === "select") {
    finishMarquee(current);
  } else if (current.tool === "draw" && current.page !== undefined) {
    finishDrawing(current, current.page);
  }
}

/** Boxes handle their own clicks, so a tap here only clears the selection on empty space. */
function finishTap(current: Gesture): void {
  if (current.tool !== "draw" && !current.onBox && !current.keepsSelection) {
    editor.clearSelection();
  }
}

function finishMarquee(current: Gesture): void {
  const { measures, boxes } = findMarqueeHits(current);
  if (current.additive) {
    editor.addToSelection(measures, boxes);
  } else {
    editor.setSelection(measures, boxes);
  }
}

function finishDrawing(current: Gesture, page: number): void {
  const rect = dragOnPage(current, page);
  if (rect && rect.width >= MIN_BOX_SIZE && rect.height >= MIN_BOX_SIZE) {
    pendingBox.value = clampToPage(rect);
  }
}

/** The gesture relative to a page. It may reach beyond the page. */
function dragOnPage(current: Gesture, page: number): MeasureLayout | undefined {
  const rect = pageDivRefs.get(page)?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    return undefined;
  }

  return normalizeLayout({
    page,
    x: (current.start.x - rect.left) / rect.width,
    y: (current.start.y - rect.top) / rect.height,
    width: (current.end.x - current.start.x) / rect.width,
    height: (current.end.y - current.start.y) / rect.height,
  });
}

function clampToPage(layout: MeasureLayout): MeasureLayout {
  const x = Math.max(0, layout.x);
  const y = Math.max(0, layout.y);
  return { page: layout.page, x, y, width: Math.min(1, layout.x + layout.width) - x, height: Math.min(1, layout.y + layout.height) - y };
}

function findMarqueeHits(current: Gesture): { measures: Measure[]; boxes: MeasureLayout[] } {
  const measures: Measure[] = [];
  const boxes: MeasureLayout[] = [];
  for (const page of pageDivRefs.keys()) {
    const rect = dragOnPage(current, page);
    if (rect) {
      measures.push(...visibleMeasures(page).filter(measure => intersects(layoutOf(measure)!, rect)));
      boxes.push(...(unnumberedByPage.value[page] ?? []).filter(box => intersects(box, rect)));
    }
  }

  return { measures: getReadingOrder(measures), boxes };
}

const drawnRect = computed(() => {
  const current = gesture.value;
  return current?.dragging && current.tool === "draw" && current.page !== undefined ? dragOnPage(current, current.page) : undefined;
});

const marqueeStyle = computed(() => {
  const current = gesture.value;
  const root = overlayRoot.value?.getBoundingClientRect();
  if (!current?.dragging || current.tool !== "select" || !root) {
    return undefined;
  }

  const { start, end } = current;
  return {
    left: `${Math.min(start.x, end.x) - root.left}px`,
    top: `${Math.min(start.y, end.y) - root.top}px`,
    width: `${Math.abs(end.x - start.x)}px`,
    height: `${Math.abs(end.y - start.y)}px`,
  };
});

const pendingParts = computed(() => pendingBox.value ? splitLayout(pendingBox.value, Math.max(1, pendingCount.value)) : []);

// ── Resize handles ────────────────────────────────────────────────────────────

type HandleDirection = "top" | "right" | "bottom" | "left";

const HANDLES: { direction: HandleDirection; position: string; cursor: string }[] = [
  { direction: "top", position: "top-0 left-1/2", cursor: "cursor-ns-resize" },
  { direction: "right", position: "top-1/2 left-full", cursor: "cursor-ew-resize" },
  { direction: "bottom", position: "top-full left-1/2", cursor: "cursor-ns-resize" },
  { direction: "left", position: "top-1/2 left-0", cursor: "cursor-ew-resize" },
];

const pageDivRefs = new Map<number, HTMLElement>();

function setPageDivRef(el: Element | null, pageNumber: number): void {
  if (el instanceof HTMLElement) {
    pageDivRefs.set(pageNumber, el);
  } else {
    pageDivRefs.delete(pageNumber);
  }
}

/** Layouts of a running resize drag, shown until the drag ends and the edit is saved. */
const resizePreview = shallowRef(new Map<MeasureId, MeasureLayout>());

function layoutOf(measure: Measure): MeasureLayout | undefined {
  return resizePreview.value.get(measure.id) ?? measure.layout;
}

function isSimilar(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function sameStaff(measure: Measure): Measure[] {
  const layout = layoutOf(measure)!;
  return (measuresByPage.value[layout.page] ?? []).filter((other) => {
    const otherLayout = layoutOf(other)!;
    return isSimilar(otherLayout.y, layout.y) && isSimilar(otherLayout.y + otherLayout.height, layout.y + layout.height);
  });
}

function resize(measure: Measure, change: (layout: MeasureLayout) => Partial<MeasureLayout>): void {
  const layout = layoutOf(measure)!;
  resizePreview.value = new Map(resizePreview.value).set(measure.id, { ...layout, ...change(layout) });
}

function onHandleDrag(event: any, measure: Measure, handle: HandleDirection): void {
  const pageEl = pageDivRefs.get(layoutOf(measure)!.page);
  if (!pageEl) {
    return;
  }

  const dx = event.delta.x / pageEl.clientWidth;
  const dy = event.delta.y / pageEl.clientHeight;
  const staff = sameStaff(measure);

  switch (handle) {
    case "top":
      staff.forEach(other => resize(other, layout => ({ y: layout.y + dy, height: layout.height - dy })));
      break;
    case "bottom":
      staff.forEach(other => resize(other, layout => ({ height: layout.height + dy })));
      break;
    case "left": {
      const left = staff[staff.indexOf(measure) - 1];
      if (left) {
        resize(left, layout => ({ width: layout.width + dx }));
      }

      resize(measure, layout => ({ x: layout.x + dx, width: layout.width - dx }));
      break;
    }

    case "right": {
      const right = staff[staff.indexOf(measure) + 1];
      resize(measure, layout => ({ width: layout.width + dx }));
      if (right) {
        resize(right, layout => ({ x: layout.x + dx, width: layout.width - dx }));
      }

      break;
    }
  }
}

/** Saves the drag as one edit. The neighbours it moved stay unselected, so the handles stay on the dragged box. */
async function onHandleDragEnd(measure: Measure): Promise<void> {
  const changes = editor.measures.value.flatMap((measure) => {
    const layout = resizePreview.value.get(measure.id);
    return layout ? [[measure, layout] as [Measure, MeasureLayout]] : [];
  });

  try {
    if (changes.length > 0) {
      await editor.apply(planLayouts(changes));
      editor.selectOnly(measure);
    }
  } catch (error) {
    notifyError("Could not save the measure boxes", error);
  } finally {
    resizePreview.value = new Map();
  }
}
// ── Section range handles ────────────────────────────────────────────────────

type RangeEnd = "first" | "last";

type RangeHandle = { end: RangeEnd; position: number; layout: MeasureLayout; name: string; valueText: string };

const RANGE_STEP_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

/** The run a handle is being dragged to, shown on the score until it is dropped. */
const handleDrag = shallowRef<{ end: RangeEnd; run: SelectedRun }>();

/** The section the inspector edits gets handles at both ends, unless the score is busy with another tool. */
const handleTarget = computed(() => {
  const match = props.editMode && activeTool.value !== "draw" && !previewing.value ? editor.selectedSection.value : undefined;
  const run = match && props.song ? getSectionRun(props.song.getTimeline(), match.section) : undefined;
  return match && run ? { ...match, run } : undefined;
});

const handleLane = computed(() => sectionOverlays.value.find(overlay => overlay.index === handleTarget.value?.index)?.lane ?? 0);

const rangeHandles = computed<RangeHandle[]>(() => {
  const target = handleTarget.value;
  const run = handleDrag.value?.run ?? target?.run;
  const song = props.song;
  if (!target || !run || !song) {
    return [];
  }

  const name = formatSectionName(song.getMeasures(), target.section);
  const subject = name.charAt(0).toLowerCase() + name.slice(1);
  return (["first", "last"] as const).flatMap((end) => {
    const position = end === "first" ? run.first : run.last;
    const entry = song.getTimeline()[position];
    const layout = entry && song.findMeasure(entry.measure)?.layout;
    const label = end === "first" ? "First" : "Last";
    return entry && layout ? [{ end, position, layout, name: `${label} measure of ${subject}`, valueText: formatLocation(song, entry) }] : [];
  });
});

const handlePreviewBoxes = computed(() => {
  const run = handleDrag.value?.run;
  const song = props.song;
  if (!run || !song) {
    return [];
  }

  const ids = new Set(song.getTimeline().slice(run.first, run.last + 1).map(entry => entry.measure));
  return [...ids].flatMap(id => song.findMeasure(id)?.layout ?? []);
});

function rangeHandleStyle({ end, layout }: RangeHandle): Record<string, string> {
  const x = end === "first" ? layout.x : layout.x + layout.width;
  return { left: `${x * 100}%`, top: `calc(${layout.y * 100}% - ${BAR_OFFSET_PX + handleLane.value * LANE_HEIGHT_PX}px)` };
}

function movedRun(run: SelectedRun, end: RangeEnd, position: number): SelectedRun {
  return end === "first" ? { first: position, last: run.last } : { first: run.first, last: position };
}

function measureUnder(event: PointerEvent): MeasureId | undefined {
  return document.elementsFromPoint(event.clientX, event.clientY)
    .map(element => (element as HTMLElement).dataset?.measure)
    .find(id => id !== undefined);
}

function onHandlePointerDown(event: PointerEvent, end: RangeEnd): void {
  const run = handleTarget.value?.run;
  if (!run || event.button !== 0) {
    return;
  }

  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  handleDrag.value = { end, run };
}

/** The handle snaps to the box under the pointer, at the occurrence closest to where it started. */
function onHandlePointerMove(event: PointerEvent): void {
  const drag = handleDrag.value;
  const base = handleTarget.value?.run;
  const measure = drag && measureUnder(event);
  if (!drag || !base || !props.song || !measure) {
    return;
  }

  const timeline = props.song.getTimeline();
  const position = drag.end === "first"
    ? findNearestPosition(timeline, measure, base.first, 0, base.last)
    : findNearestPosition(timeline, measure, base.last, base.first, timeline.length - 1);
  if (position !== undefined) {
    handleDrag.value = { ...drag, run: movedRun(base, drag.end, position) };
  }
}

async function onHandlePointerUp(): Promise<void> {
  const drag = handleDrag.value;
  handleDrag.value = undefined;
  if (drag) {
    await moveSection(drag.run, drag.end);
  }
}

function getKeyTarget(key: string, current: number, min: number, max: number): number | undefined {
  const step = RANGE_STEP_KEYS[key];
  if (step !== undefined) {
    return current + step;
  }

  if (key === "Home") {
    return min;
  }

  return key === "End" ? max : undefined;
}

function onHandleKeydown(event: KeyboardEvent, end: RangeEnd): void {
  const base = handleTarget.value?.run;
  if (!base) {
    return;
  }

  const [min, max] = end === "first" ? [0, base.last] : [base.first, (props.song?.getTimeline().length ?? 0) - 1];
  const current = end === "first" ? base.first : base.last;
  const target = getKeyTarget(event.key, current, min, max);
  if (target === undefined) {
    return;
  }

  // Arrow keys also step the playhead, which must not happen while a handle moves.
  event.preventDefault();
  event.stopPropagation();
  const position = Math.max(min, Math.min(max, target));
  if (position !== current) {
    moveSection(movedRun(base, end, position), end);
  }
}

/** Saves the section over whole measures of the new run and keeps it selected, so its handles stay. */
async function moveSection(run: SelectedRun, end: RangeEnd): Promise<void> {
  const target = handleTarget.value;
  const song = props.song;
  if (!target || !song || (run.first === target.run.first && run.last === target.run.last)) {
    return;
  }

  const measures = song.getMeasures();
  const timeline = song.getTimeline();
  const moved = withRun(measures, timeline, target.section, run);
  const [issue] = validateSections(measures, timeline, song.getSections().map((section, i) => i === target.index ? moved : section));
  if (issue) {
    notifyError("Could not move the section", new Error(issue.reason));
    return;
  }

  const hadFocus = !!document.activeElement?.closest(`[data-range-handle="${end}"]`);
  try {
    await song.updateSection(target.index, moved);
    player.syncWarp();
    editor.selectSection(song.getSections().findIndex(section => getSectionRun(timeline, section)?.first === run.first));
    if (hadFocus) {
      await nextTick();
      overlayRoot.value?.querySelector<HTMLElement>(`[data-range-handle="${end}"]`)?.focus();
    }
  } catch (error) {
    notifyError("Could not move the section", error);
  }
}
</script>

<template>
  <PdfViewer
    ref="pdfViewer"
    class="@container"
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    :pannable="!editMode || activeTool === 'move'"
    :insets="viewInsets"
    role="region"
    aria-label="Score"
    @loading-change="emit('pdf-loading', $event)"
  >
    <template #default="{ visiblePages }">
      <!-- While editing, the overlay takes every press on the score and turns it into a gesture -->
      <div
        ref="overlayRoot"
        class="absolute inset-0"
        :class="editMode ? ['pointer-events-auto', TOOL_CURSORS[activeTool]] : 'pointer-events-none'"
        @pointerdown.capture="rememberPointerType"
        @pointerdown="editMode && onPointerDown($event)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="gesture = undefined"
      >
        <div
          v-for="page of visiblePages"
          :key="page.pageNumber"
          :ref="(el) => setPageDivRef(el as Element | null, page.pageNumber)"
          class="absolute"
          :style="{
            left: `${page.x * 100}%`,
            top: `${page.y * 100}%`,
            width: `${page.width * 100}%`,
            height: `${page.height * 100}%`,
          }"
          role="group"
          :aria-label="`Page ${page.pageNumber + 1}`"
          :data-page="page.pageNumber"
        >
          <div hidden>
            <span
              v-for="measure of visibleMeasures(page.pageNumber).filter(descriptionId)"
              :id="descriptionId(measure)"
              :key="measure.id"
            >{{ overlayDescriptions.get(measure.id) }}</span>
          </div>

          <div
            v-for="(layout, i) of onPage(cutBoxes, page.pageNumber, box => box.page)"
            :key="`cut-${i}`"
            class="pointer-events-none absolute hatch-section-cut"
            :style="boxStyle(layout)"
          />

          <div
            v-for="measure of visibleMeasures(page.pageNumber)"
            :key="measure.id"
            class="pointer-events-auto absolute transition-colors select-none"
            :class="boxClass(measure)"
            :style="boxStyle(layoutOf(measure)!)"
            role="button"
            :aria-label="`Measure ${measure.label}`"
            :aria-pressed="editMode ? editor.isSelected(measure) : undefined"
            :aria-current="currentMeasureId === measure.id ? 'location' : undefined"
            :aria-describedby="descriptionId(measure)"
            :data-measure="measure.id"
            @contextmenu.stop.prevent
            @click="onBoxClick($event, measure)"
          >
            <span
              v-if="editMode"
              :class="chipClass(measure.layout, true)"
            >{{ measure.label }}</span>

            <!-- Playbar -->
            <div
              v-if="currentMeasureId === measure.id"
              class="pointer-events-none absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-primary"
              :style="{ left: `${currentPositionProgress * 100}%` }"
            />

            <span
              v-if="currentMeasureId === measure.id && currentOccurrenceTag"
              class="pointer-events-none absolute bottom-0.5 left-1.5 rounded-sm bg-primary px-1 text-[0.625rem] leading-4 font-semibold whitespace-nowrap text-primary-contrast"
              aria-hidden="true"
            >{{ currentOccurrenceTag }}</span>

            <template v-if="editMode && hasHandles(measure)">
              <Draggable
                v-for="handle in HANDLES"
                :key="handle.direction"
                @drag="onHandleDrag($event, measure, handle.direction)"
                @dragend="onHandleDragEnd(measure)"
              >
                <template #default="{ passRef }">
                  <div
                    :ref="(el) => el && passRef(el)"
                    class="absolute flex size-5 -translate-1/2 items-center justify-center"
                    :class="[handle.position, handle.cursor]"
                    aria-hidden="true"
                    @pointerdown.stop
                    @click.stop
                    @touchstart.stop
                    @touchmove.stop
                  >
                    <span class="pointer-events-none size-2.5 rounded-full bg-primary ring-2 ring-surface-0 dark:ring-surface-900" />
                  </div>
                </template>
              </Draggable>
            </template>
          </div>

          <div
            v-for="(box, i) of unnumberedByPage[page.pageNumber] ?? []"
            :key="`unnumbered-${i}`"
            class="pointer-events-auto absolute transition-colors select-none"
            :class="unnumberedClass(box)"
            :style="boxStyle(box)"
            role="button"
            aria-label="Box without a number"
            :aria-pressed="editor.isBoxSelected(box)"
            :data-unnumbered-box="i"
            @contextmenu.stop.prevent
            @click="onUnnumberedClick($event, box)"
          >
            <span :class="chipClass(box, false)">?</span>
          </div>

          <div
            v-for="(box, i) of previewByPage[page.pageNumber] ?? []"
            :key="`preview-${i}`"
            class="pointer-events-none absolute border-2 border-dashed"
            :class="previewClass(box)"
            :style="boxStyle(box.layout)"
            role="img"
            :aria-label="box.label === undefined ? 'Detected box without a number' : `Detected measure ${box.label}`"
          >
            <span :class="chipClass(box.layout, box.label !== undefined)">{{ box.label ?? "?" }}</span>
          </div>

          <!-- Box waiting for the panel to say what it holds -->
          <div
            v-for="(part, i) in pendingBox?.page === page.pageNumber ? pendingParts : []"
            :key="`pending-${i}`"
            class="pointer-events-none absolute border border-dashed border-primary bg-primary/20"
            :style="boxStyle(part)"
          />

          <div
            v-if="drawnRect?.page === page.pageNumber"
            class="pointer-events-none absolute border border-primary bg-primary/20"
            :style="boxStyle(drawnRect)"
          />

          <div
            v-for="bar of onPage(sectionBars, page.pageNumber, item => item.run.page)"
            :key="bar.key"
            class="pointer-events-none absolute h-[3px] rounded-full"
            :class="SECTION_COLORS[bar.kind].background"
            :style="sectionBarStyle(bar)"
          >
            <span
              class="absolute bottom-full left-0 mb-0.5 rounded-sm px-1.5 text-[0.625rem] leading-4 font-semibold whitespace-nowrap shadow-sm"
              :class="[SECTION_COLORS[bar.kind].background, SECTION_CONTRAST_TEXT]"
              :role="bar.name ? 'img' : undefined"
              :aria-label="bar.name"
              :aria-hidden="bar.name ? undefined : 'true'"
            >{{ bar.chip }}</span>
          </div>

          <span
            v-for="glyph of onPage(recordedGlyphs, page.pageNumber, item => item.layout.page)"
            :key="glyph.key"
            class="pointer-events-none absolute inline-flex -translate-x-full items-center gap-1 rounded-sm border border-slate-700 bg-white/95 px-1 text-[0.625rem] leading-4 font-bold text-slate-800 shadow-sm"
            :style="recordedGlyphStyle(glyph)"
            role="img"
            :aria-label="glyph.name"
          >
            <svg
              class="h-2.5 w-[0.4375rem]"
              viewBox="0 0 7 12"
              aria-hidden="true"
            >
              <circle
                cx="1.2"
                cy="4"
                r="1.1"
                fill="currentColor"
              />
              <circle
                cx="1.2"
                cy="8"
                r="1.1"
                fill="currentColor"
              />
              <rect
                x="3.2"
                width="1"
                height="12"
                fill="currentColor"
              />
              <rect
                x="5.2"
                width="1.8"
                height="12"
                fill="currentColor"
              />
            </svg>
            <span aria-hidden="true">{{ glyph.text }}</span>
          </span>

          <span
            v-for="chip of onPage(jumpChips, page.pageNumber, item => item.layout.page)"
            :key="chip.key"
            class="pointer-events-none absolute -translate-x-full rounded-sm border border-slate-700 bg-white/95 px-1 text-[0.625rem] leading-4 font-bold whitespace-nowrap text-slate-800 shadow-sm"
            :style="jumpChipStyle(chip)"
            role="img"
            :aria-label="chip.name"
          >{{ chip.text }}</span>

          <div
            v-for="(layout, i) of onPage(handlePreviewBoxes, page.pageNumber, box => box.page)"
            :key="`handle-preview-${i}`"
            class="pointer-events-none absolute border-2 border-dashed"
            :class="handleTarget && SECTION_COLORS[handleTarget.section.kind].border"
            :style="boxStyle(layout)"
          />

          <div
            v-for="handle of onPage(rangeHandles, page.pageNumber, item => item.layout.page)"
            :key="`range-handle-${handle.end}`"
            class="pointer-events-auto absolute z-10 flex h-6 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
            :style="rangeHandleStyle(handle)"
            role="slider"
            tabindex="0"
            :aria-label="handle.name"
            aria-orientation="horizontal"
            :aria-valuemin="1"
            :aria-valuemax="song?.getTimeline().length"
            :aria-valuenow="handle.position + 1"
            :aria-valuetext="handle.valueText"
            :data-range-handle="handle.end"
            @pointerdown.stop="onHandlePointerDown($event, handle.end)"
            @pointermove="onHandlePointerMove"
            @pointerup="onHandlePointerUp"
            @pointercancel="handleDrag = undefined"
            @click.stop
            @touchstart.stop
            @touchmove.stop
            @keydown="onHandleKeydown($event, handle.end)"
          >
            <span
              class="pointer-events-none h-4 w-2 rounded-sm ring-2 ring-surface-0 dark:ring-surface-900"
              :class="handleTarget && SECTION_COLORS[handleTarget.section.kind].background"
            />
          </div>

          <span
            v-for="marker of onPage(markerChips, page.pageNumber, item => item.layout.page)"
            :key="marker.key"
            class="pointer-events-none absolute inline-flex max-w-32 -translate-y-full items-center gap-1 rounded-full bg-primary px-1.5 text-[0.625rem] leading-4 font-semibold whitespace-nowrap text-primary-contrast shadow-sm"
            :style="markerChipStyle(marker)"
            aria-hidden="true"
          >
            <i class="pi pi-bookmark text-[0.5625rem]" />
            <span class="truncate">{{ marker.text }}</span>
          </span>

          <i
            v-for="pin of onPage(syncPins, page.pageNumber, item => item.layout.page)"
            :key="pin.key"
            class="pi pi-map-marker pointer-events-none absolute -translate-x-1/2 text-[0.625rem]"
            :class="SYNC_POINT_COLORS.onScore"
            :style="syncPinStyle(pin)"
            aria-hidden="true"
          />
        </div>

        <div
          v-if="marqueeStyle"
          class="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
          :style="marqueeStyle"
        />
      </div>

      <SelectButton
        v-if="editMode"
        ref="toolbar"
        :model-value="activeTool"
        class="absolute top-2 left-1/2 -translate-x-1/2 shadow-sm"
        :options="TOOL_OPTIONS"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        :disabled="previewing"
        aria-label="Score tool"
        size="small"
        @update:model-value="editor.setTool($event)"
      >
        <template #option="{ option }">
          <i
            :class="option.icon"
            aria-hidden="true"
          />
          <span class="sr-only @sm:not-sr-only">{{ option.label }}</span>
        </template>
      </SelectButton>
    </template>
  </PdfViewer>
</template>
