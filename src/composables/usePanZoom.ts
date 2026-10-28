import { useEventListener } from "@vueuse/core";
import { type Ref, ref } from "vue";

import type PageTransform from "@/core/pdf/pageTransform";

const TAP_MAX_MOVEMENT = 10;
const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

type Point = { x: number; y: number };

type Press = { pointerId: number; start: Point; last: Point; moved: boolean };

export function usePanZoom(
  container: Ref<HTMLElement | undefined>,
  transform: PageTransform,
  options: {
    onRedraw: () => void;
    /** Whether a left-button or one-finger drag pans. The middle button, the wheel and pinching always do. */
    canPan: () => boolean;
    onInteract?: () => void;
  },
): { isGrabbing: Readonly<Ref<boolean>> } {
  const { onRedraw, canPan } = options;

  function containerPos(clientX: number, clientY: number): Point {
    const rect = container.value!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Suppresses the next click event when a pan/zoom gesture was detected.
  let didGesture = false;

  useEventListener(container, "click", (e: MouseEvent) => {
    if (didGesture) {
      e.stopPropagation();
      e.preventDefault();
      didGesture = false;
    }
  }, { capture: true });

  // A mouse press that pans when it moves. On empty space it grabs at once. On something a click acts on it keeps
  // the pointer, since releasing there still clicks, and grabs once the press has moved far enough to pan instead.
  let press: Press | undefined;
  const isGrabbing = ref(false);

  /** The hover cursor says whether the element under the pointer takes clicks, as each such element sets it. */
  function showsPointer(target: EventTarget | null): boolean {
    return target instanceof Element && getComputedStyle(target).cursor === "pointer";
  }

  function endPress(): void {
    press = undefined;
    isGrabbing.value = false;
  }

  useEventListener(container, "pointerdown", (e: PointerEvent) => {
    const pans = e.button === MIDDLE_BUTTON || (e.button === LEFT_BUTTON && canPan());
    if (e.pointerType !== "mouse" || !pans) {
      return;
    }

    // The pointer is captured only once it moves, since a capture retargets the click of a tap to the
    // container, away from the box or page under the pointer.
    const point = { x: e.clientX, y: e.clientY };
    press = { pointerId: e.pointerId, start: point, last: point, moved: false };
    isGrabbing.value = e.button === MIDDLE_BUTTON || !showsPointer(e.target);
  });

  // Keeps the browser from starting its own autoscroll on a middle-button drag.
  useEventListener(container, "mousedown", (e: MouseEvent) => {
    if (e.button === MIDDLE_BUTTON) {
      e.preventDefault();
    }
  });

  useEventListener(container, "pointermove", (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) {
      return;
    }

    // The button was released outside the window, where no pointerup reaches the page.
    if (e.buttons === 0) {
      endPress();
      return;
    }

    transform.pan.x += e.clientX - press.last.x;
    transform.pan.y += e.clientY - press.last.y;
    press.last = { x: e.clientX, y: e.clientY };

    if (!press.moved && Math.hypot(e.clientX - press.start.x, e.clientY - press.start.y) > TAP_MAX_MOVEMENT) {
      press.moved = true;
      isGrabbing.value = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      options.onInteract?.();
    }

    onRedraw();
  });

  // On the window, so a press released outside the score before it was captured still ends.
  useEventListener(window, "pointerup", (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) {
      return;
    }

    if (press.moved) {
      didGesture = true;
    }

    endPress();
  });

  useEventListener(window, "pointercancel", (e: PointerEvent) => {
    if (press?.pointerId === e.pointerId) {
      endPress();
    }
  });

  useEventListener(container, "wheel", (e: WheelEvent) => {
    e.preventDefault();
    const pos = containerPos(e.clientX, e.clientY);
    if (e.metaKey || e.ctrlKey) {
      transform.setZoom(transform.zoom * Math.exp(-0.005 * e.deltaY), pos);
    } else {
      transform.pan.x -= e.deltaX;
      transform.pan.y -= e.deltaY;
    }

    options.onInteract?.();

    onRedraw();
  }, { passive: false });
  // touch-action: none on the wrapper prevents browser scroll/zoom without
  // needing preventDefault here, which allows synthetic click events to fire
  // naturally on tapped HTML elements.

  let activeTouches: { id: number; x: number; y: number }[] = [];

  const syncTouches = (e: TouchEvent): void => {
    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  };

  useEventListener(container, "touchstart", (e: TouchEvent) => {
    if (e.touches.length >= 2) {
      didGesture = true;
    }

    syncTouches(e);
  });

  useEventListener(container, "touchmove", (e: TouchEvent) => {
    if (e.touches.length === 1 && canPan()) {
      const touch = e.touches[0]!;
      const prev = activeTouches.find(p => p.id === touch.identifier);
      if (prev) {
        const dx = touch.clientX - prev.x;
        const dy = touch.clientY - prev.y;
        transform.pan.x += dx;
        transform.pan.y += dy;

        if (Math.hypot(dx, dy) > TAP_MAX_MOVEMENT) {
          didGesture = true;
          options.onInteract?.();
        }
      }
    } else if (e.touches.length === 2) {
      didGesture = true;
      const t1 = e.touches[0]!;
      const t2 = e.touches[1]!;
      const p1 = activeTouches.find(p => p.id === t1.identifier);
      const p2 = activeTouches.find(p => p.id === t2.identifier);
      if (p1 && p2) {
        const prevDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const currDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const prevCenter = containerPos((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        const currCenter = containerPos((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
        if (prevDist > 0) {
          transform.setZoom(transform.zoom * (currDist / prevDist), prevCenter);
          transform.pan.x += currCenter.x - prevCenter.x;
          transform.pan.y += currCenter.y - prevCenter.y;
          options.onInteract?.();
        }
      }
    }

    syncTouches(e);
    onRedraw();
  });

  useEventListener(container, "touchend", (e: TouchEvent) => {
    syncTouches(e);
  });

  useEventListener(container, "touchcancel", () => {
    didGesture = true;
    activeTouches = [];
  });

  return { isGrabbing };
}
