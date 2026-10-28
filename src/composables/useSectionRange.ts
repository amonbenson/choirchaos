import { computed, type ComputedRef, type MaybeRefOrGetter, nextTick, type ShallowRef, shallowRef, toValue } from "vue";

import { formatLocation } from "@/core/models/locationFormat";
import type { RecordedPass } from "@/core/models/recording";
import { formatSectionName } from "@/core/models/scoreOverlays";
import { getSectionRun, replaceSections, type Section, validateSections, withRun } from "@/core/models/sections";
import type Song from "@/core/models/song";
import { lowerFirst } from "@/core/utils/text";

import { injectEditorSelection } from "./useEditorSelection";
import { useNotify } from "./useNotify";

export type RangeEnd = "first" | "last";

export type RangeHandle = {
  end: RangeEnd;
  /** The timeline position the handle is at. */
  position: number;
  name: string;
  valueText: string;
};

type Focusable = { focus: () => void; hasFocus: () => boolean };

export type SectionRange = {
  /** The section's own range, its first recorded pass. */
  run: ComputedRef<RecordedPass | undefined>;
  /** The section's own range, or where a handle is being dragged to. */
  shownRun: ComputedRef<RecordedPass | undefined>;
  /** The section as it would be saved after the drag, for the preview. */
  shownSection: ComputedRef<Section>;
  dragged: Readonly<ShallowRef<{ end: RangeEnd; run: RecordedPass } | undefined>>;
  handles: ComputedRef<RangeHandle[]>;
  /** The positions a handle can move to: the first up to the last measure, the last from the first on. */
  getLimits: (end: RangeEnd) => [number, number];
  /** Previews the handle at a position until it is dropped. */
  dragTo: (end: RangeEnd, position: number) => void;
  drop: () => Promise<void>;
  onKeydown: (event: KeyboardEvent, end: RangeEnd) => void;
  setHandleElement: (end: RangeEnd, handle: Focusable | null) => void;
};

const RANGE_STEP_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

function movedRun(run: RecordedPass, end: RangeEnd, position: number): RecordedPass {
  return end === "first" ? { first: position, last: run.last } : { first: run.first, last: position };
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

/**
 * The range handles of the selected section, shared by the score and the timeline. A handle moves the
 * section's first or last measure to any position of the recording, previews the move while dragged and
 * saves it once, over whole measures. A move that `validateSections()` rejects is explained, not saved.
 */
export function useSectionRange(song: MaybeRefOrGetter<Song>, section: MaybeRefOrGetter<Section>): SectionRange {
  const { notifyError } = useNotify();
  const editorSelection = injectEditorSelection();
  const dragged = shallowRef<{ end: RangeEnd; run: RecordedPass }>();
  const handleElements = new Map<RangeEnd, Focusable>();

  const run = computed(() => getSectionRun(toValue(song).getTimeline(), toValue(section)));
  const shownRun = computed(() => dragged.value?.run ?? run.value);
  const shownSection = computed(() => {
    const target = toValue(song);
    const drag = dragged.value;
    return drag ? withRun(target.getMeasures(), target.getTimeline(), toValue(section), drag.run) : toValue(section);
  });

  const handles = computed<RangeHandle[]>(() => {
    const target = toValue(song);
    const shown = shownRun.value;
    if (!shown) {
      return [];
    }

    const name = lowerFirst(formatSectionName(target.getMeasures(), toValue(section)));
    return (["first", "last"] as const).map((end) => {
      const position = end === "first" ? shown.first : shown.last;
      const label = end === "first" ? "First" : "Last";
      return { end, position, name: `${label} measure of ${name}`, valueText: formatLocation(target, target.getTimeline()[position]!) };
    });
  });

  function getLimits(end: RangeEnd): [number, number] {
    const current = run.value!;
    return end === "first" ? [0, current.last] : [current.first, toValue(song).getTimeline().length - 1];
  }

  function dragTo(end: RangeEnd, position: number): void {
    const [min, max] = getLimits(end);
    dragged.value = { end, run: movedRun(run.value!, end, Math.max(min, Math.min(max, position))) };
  }

  async function drop(): Promise<void> {
    const drag = dragged.value;
    dragged.value = undefined;
    if (drag) {
      await moveSection(drag.run, drag.end);
    }
  }

  function onKeydown(event: KeyboardEvent, end: RangeEnd): void {
    const current = run.value;
    if (!current) {
      return;
    }

    const [min, max] = getLimits(end);
    const position = end === "first" ? current.first : current.last;
    const target = getKeyTarget(event.key, position, min, max);
    if (target === undefined) {
      return;
    }

    // Arrow keys also step the playhead, which must not happen while a handle moves.
    event.preventDefault();
    event.stopPropagation();
    const clamped = Math.max(min, Math.min(max, target));
    if (clamped !== position) {
      moveSection(movedRun(current, end, clamped), end);
    }
  }

  function setHandleElement(end: RangeEnd, handle: Focusable | null): void {
    if (handle) {
      handleElements.set(end, handle);
    } else {
      handleElements.delete(end);
    }
  }

  /** Saves the section over whole measures of the new run and keeps it selected, so its handles stay. */
  async function moveSection(next: RecordedPass, end: RangeEnd): Promise<void> {
    const current = run.value;
    if (!current || (next.first === current.first && next.last === current.last)) {
      return;
    }

    const target = toValue(song);
    const measures = target.getMeasures();
    const timeline = target.getTimeline();
    const moved = withRun(measures, timeline, toValue(section), next);
    const sections = replaceSections(target.getSections(), [toValue(section)], moved);
    const [issue] = validateSections(measures, timeline, sections);
    if (issue) {
      notifyError("Could not move the section", new Error(issue.reason));
      return;
    }

    // The handle may be rendered anew, on another page of the score or another part of the timeline.
    const hadFocus = handleElements.get(end)?.hasFocus() ?? false;
    try {
      await target.editLayers({ sections });
      editorSelection.select({ kind: "section", from: moved.from });
      if (hadFocus) {
        await nextTick();
        handleElements.get(end)?.focus();
      }
    } catch (error) {
      notifyError("Could not move the section", error);
    }
  }

  return { run, shownRun, shownSection, dragged, handles, getLimits, dragTo, drop, onKeydown, setHandleElement };
}
