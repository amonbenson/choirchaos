import { useEventListener } from "@vueuse/core";
import { type Ref } from "vue";

import type PageTransform from "@/core/pdf/pageTransform";

const TAP_MAX_MOVEMENT = 10;

export function usePanZoom(
  container: Ref<HTMLElement | undefined>,
  transform: PageTransform,
  options: {
    onRedraw: () => void;
    panZone?: Ref<HTMLElement | undefined>;
  },
): void {
  const { onRedraw } = options;

  function containerPos(clientX: number, clientY: number): { x: number; y: number } {
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

  // ── Mouse ──────────────────────────────────────────────────────────────────

  let lastPos: { x: number; y: number } | undefined;
  let movedBeyondTap = false;

  useEventListener(container, "pointerdown", (e: PointerEvent) => {
    // Only pan when the click originates inside the pan zone, not on UI overlays.
    const zone = options.panZone?.value ?? container.value;
    if (e.pointerType !== "mouse" || !zone?.contains(e.target as Node)) {
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastPos = { x: e.clientX, y: e.clientY };
    movedBeyondTap = false;
  });

  useEventListener(container, "pointermove", (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !lastPos) {
      return;
    }

    transform.pan.x += e.clientX - lastPos.x;
    transform.pan.y += e.clientY - lastPos.y;
    lastPos = { x: e.clientX, y: e.clientY };

    if (!movedBeyondTap && Math.hypot(e.movementX, e.movementY) > TAP_MAX_MOVEMENT) {
      movedBeyondTap = true;
    }

    onRedraw();
  });

  useEventListener(container, "pointerup", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      return;
    }

    if (movedBeyondTap) {
      didGesture = true;
    }

    lastPos = undefined;
    movedBeyondTap = false;
  });

  useEventListener(container, "pointercancel", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      return;
    }

    lastPos = undefined;
    movedBeyondTap = false;
  });

  // ── Wheel ──────────────────────────────────────────────────────────────────

  useEventListener(container, "wheel", (e: WheelEvent) => {
    e.preventDefault();
    const pos = containerPos(e.clientX, e.clientY);
    if (e.metaKey || e.ctrlKey) {
      transform.setZoom(transform.zoom * Math.exp(-0.005 * e.deltaY), pos);
    } else {
      transform.pan.x -= e.deltaX;
      transform.pan.y -= e.deltaY;
    }

    onRedraw();
  }, { passive: false });

  // ── Touch ──────────────────────────────────────────────────────────────────
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
    if (e.touches.length === 1) {
      const touch = e.touches[0]!;
      const prev = activeTouches.find(p => p.id === touch.identifier);
      if (prev) {
        const dx = touch.clientX - prev.x;
        const dy = touch.clientY - prev.y;
        transform.pan.x += dx;
        transform.pan.y += dy;

        if (Math.hypot(dx, dy) > TAP_MAX_MOVEMENT) {
          didGesture = true;
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
}
