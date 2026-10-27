import { useElementSize, useEventListener } from "@vueuse/core";
import { computed, type ComputedRef, type MaybeRefOrGetter, type Ref, shallowRef, toValue } from "vue";

import { getAnchoredOffset, normalizeWheelDelta, ZoomLadder } from "@/core/utils/zoom";

const ZOOM_STEPS_PER_DOUBLING = 4;
const BUTTON_ZOOM_STEPS = 2;
// Where a playhead that left the view comes back, as a fraction of the width from the left edge.
const REVEAL_MARGIN = 0.1;

export type AxisBlock = { left: number; width: number };

export type TimelineAxisOptions = {
  /** Length of the song in player ticks. */
  duration: MaybeRefOrGetter<number>;
  /** Player ticks per zoom unit: one sample of the recording in audio songs, one MIDI tick otherwise. */
  ticksPerUnit: MaybeRefOrGetter<number>;
  /** The closest zoom in units per pixel. */
  minScale: MaybeRefOrGetter<number>;
};

export type TimelineAxis = {
  width: Ref<number>;
  /** Zoom units per pixel, always whole, since the waveform only draws whole samples per pixel. */
  scale: ComputedRef<number>;
  /** Pixels scrolled from the start of the song, always whole, as the waveform scrolls by pixels. */
  offset: ComputedRef<number>;
  contentWidth: ComputedRef<number>;
  toX: (tick: number) => number;
  toTick: (x: number) => number;
  /** The part of a tick range inside the view, or undefined when none of it is. */
  toBlock: (start: number, end: number) => AxisBlock | undefined;
  isVisible: (tick: number) => boolean;
  scrollTo: (offset: number) => void;
  /** Scrolls a tick outside the view back into it. */
  reveal: (tick: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
};

/**
 * The time axis the timeline's lanes, waveform and playhead share. It maps player ticks to pixels of the
 * element, zooms on ctrl or pinch wheel input around the pointer and scrolls on sideways wheel input.
 */
export function useTimelineAxis(element: Ref<HTMLElement | null | undefined>, options: TimelineAxisOptions): TimelineAxis {
  const { width } = useElementSize(element);
  // Undefined while the whole song fits the width, so the view keeps fitting when the width changes.
  const zoom = shallowRef<number>();
  const rawOffset = shallowRef(0);

  const ticksPerUnit = computed(() => toValue(options.ticksPerUnit));
  const minScale = computed(() => toValue(options.minScale));
  const durationUnits = computed(() => toValue(options.duration) / ticksPerUnit.value);
  const fitScale = computed(() => Math.max(minScale.value, Math.ceil(durationUnits.value / Math.max(1, width.value))));
  const ladder = computed(() => new ZoomLadder({
    min: minScale.value,
    max: Math.max(minScale.value, durationUnits.value),
    stepsPerDoubling: ZOOM_STEPS_PER_DOUBLING,
  }));

  const scale = computed(() => Math.max(minScale.value, Math.floor(zoom.value ?? fitScale.value)));
  const ticksPerPixel = computed(() => scale.value * ticksPerUnit.value);
  const contentWidth = computed(() => Math.ceil(durationUnits.value / scale.value));
  const offset = computed(() => clampOffset(rawOffset.value));

  function clampOffset(value: number): number {
    return Math.round(Math.min(Math.max(0, contentWidth.value - width.value), Math.max(0, value)));
  }

  function toX(tick: number): number {
    return tick / ticksPerPixel.value - offset.value;
  }

  function toTick(x: number): number {
    return (x + offset.value) * ticksPerPixel.value;
  }

  function toBlock(start: number, end: number): AxisBlock | undefined {
    const left = Math.max(0, toX(start));
    const right = Math.min(width.value, toX(end));
    return right > left ? { left, width: right - left } : undefined;
  }

  function isVisible(tick: number): boolean {
    const x = toX(tick);
    return x >= 0 && x <= width.value;
  }

  function scrollTo(value: number): void {
    rawOffset.value = clampOffset(value);
  }

  function reveal(tick: number): void {
    if (!isVisible(tick)) {
      scrollTo(tick / ticksPerPixel.value - width.value * REVEAL_MARGIN);
    }
  }

  function zoomTo(next: number, anchorX = width.value / 2): void {
    const anchorTick = toTick(anchorX);
    zoom.value = next >= fitScale.value ? undefined : next;
    scrollTo(getAnchoredOffset(anchorTick, anchorX, ticksPerPixel.value));
  }

  function zoomBy(steps: number): void {
    zoomTo(ladder.value.step(zoom.value ?? fitScale.value, steps));
  }

  function fit(): void {
    zoom.value = undefined;
    rawOffset.value = 0;
  }

  function onWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const current = zoom.value ?? fitScale.value;
      const next = ladder.value.applyWheel(current, normalizeWheelDelta(event));
      if (next !== current) {
        zoomTo(next, event.clientX - element.value!.getBoundingClientRect().left);
      }

      return;
    }

    // Vertical wheel input scrolls the page, shift turns it sideways like everywhere else.
    if (!event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
      return;
    }

    event.preventDefault();
    const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    scrollTo(offset.value + normalizeWheelDelta({ deltaY: delta, deltaMode: event.deltaMode }));
  }

  useEventListener(element, "wheel", onWheel, { passive: false });

  return {
    width,
    scale,
    offset,
    contentWidth,
    toX,
    toTick,
    toBlock,
    isVisible,
    scrollTo,
    reveal,
    zoomIn: () => zoomBy(-BUTTON_ZOOM_STEPS),
    zoomOut: () => zoomBy(BUTTON_ZOOM_STEPS),
    fit,
  };
}
