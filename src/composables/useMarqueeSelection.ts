import { useEventListener } from "@vueuse/core";
import { type Ref, shallowRef } from "vue";

const LEFT_BUTTON = 0;
// Below this a shift press is a shift-click, which selects a range instead.
const MIN_DRAG_PX = 4;

/** A rectangle in fractions of the target, for drawing the box. */
export type MarqueeArea = { x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };

/**
 * Shift and a mouse drag draw a selection box over the target. The press stops there, so whatever pans the
 * target never sees it. The pointer is captured only once the drag starts, so a shift-click still reaches
 * the element under it.
 */
export function useMarqueeSelection(
  target: Ref<HTMLElement | undefined>,
  options: {
    canStart: () => boolean;
    onStart?: (event: PointerEvent) => void;
    /** The box in client coordinates, after every move. */
    onChange: (box: DOMRect) => void;
    onCancel?: () => void;
  },
): { area: Readonly<Ref<MarqueeArea | undefined>>; cancel: () => boolean } {
  const area = shallowRef<MarqueeArea>();
  let press: { pointerId: number; start: Point } | undefined;
  let swallowClick = false;

  function reset(): void {
    if (press && target.value?.hasPointerCapture(press.pointerId)) {
      target.value.releasePointerCapture(press.pointerId);
    }

    press = undefined;
    area.value = undefined;
  }

  useEventListener(target, "pointerdown", (event: PointerEvent) => {
    swallowClick = false;
    if (event.pointerType !== "mouse" || event.button !== LEFT_BUTTON || !event.shiftKey || !options.canStart()) {
      return;
    }

    event.stopPropagation();
    press = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY } };
  });

  useEventListener(target, "pointermove", (event: PointerEvent) => {
    const element = target.value;
    if (!press || !element || event.pointerId !== press.pointerId) {
      return;
    }

    const { start } = press;
    if (!area.value) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < MIN_DRAG_PX) {
        return;
      }

      element.setPointerCapture(event.pointerId);
      options.onStart?.(event);
    }

    const box = new DOMRect(
      Math.min(start.x, event.clientX),
      Math.min(start.y, event.clientY),
      Math.abs(event.clientX - start.x),
      Math.abs(event.clientY - start.y),
    );
    const bounds = element.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    area.value = {
      x: (box.left - bounds.left) / bounds.width,
      y: (box.top - bounds.top) / bounds.height,
      width: box.width / bounds.width,
      height: box.height / bounds.height,
    };
    options.onChange(box);
  });

  useEventListener(target, "pointerup", (event: PointerEvent) => {
    if (press?.pointerId !== event.pointerId) {
      return;
    }

    swallowClick = !!area.value;
    reset();
  });

  useEventListener(target, "pointercancel", reset);

  // The click ending a drag would otherwise select the range up to the box it ends on.
  useEventListener(target, "click", (event: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false;
      event.stopPropagation();
    }
  }, { capture: true });

  /** Ends a running box and gives the caller the chance to restore the selection. True when one was running. */
  function cancel(): boolean {
    if (!area.value) {
      return false;
    }

    reset();
    swallowClick = true;
    options.onCancel?.();
    return true;
  }

  return { area, cancel };
}
