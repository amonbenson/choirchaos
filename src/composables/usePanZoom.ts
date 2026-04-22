import { useEventListener } from "@vueuse/core";
import { type Ref } from "vue";

import type PageTransform from "@/core/pdf/pageTransform";

const TAP_MAX_MOVEMENT = 10;

export function usePanZoom(
  container: Ref<HTMLElement | undefined>,
  transform: PageTransform,
  options: {
    onRedraw: () => void;
    onTap?: (x: number, y: number) => void;
  },
): void {
  const { onRedraw, onTap } = options;

  function containerPos(clientX: number, clientY: number): { x: number; y: number } {
    const rect = container.value!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // ── Mouse ──────────────────────────────────────────────────────────────────

  let lastPos: { x: number; y: number } | undefined;
  let tapOrigin: { x: number; y: number; button: number } | undefined;

  useEventListener(container, "pointerdown", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastPos = { x: e.clientX, y: e.clientY };
    tapOrigin = e.button !== 1 ? { x: e.clientX, y: e.clientY, button: e.button } : undefined;
  });

  useEventListener(container, "pointermove", (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !lastPos) {
      return;
    }

    transform.pan.x += e.clientX - lastPos.x;
    transform.pan.y += e.clientY - lastPos.y;
    lastPos = { x: e.clientX, y: e.clientY };
    if (tapOrigin && Math.hypot(e.clientX - tapOrigin.x, e.clientY - tapOrigin.y) > TAP_MAX_MOVEMENT) {
      tapOrigin = undefined;
    }

    onRedraw();
  });

  useEventListener(container, "pointerup", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      return;
    }

    if (tapOrigin && e.button === tapOrigin.button) {
      const { x, y } = containerPos(e.clientX, e.clientY);
      onTap?.(x, y);
    }

    lastPos = undefined;
    tapOrigin = undefined;
  });

  useEventListener(container, "pointercancel", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      return;
    }

    lastPos = undefined;
    tapOrigin = undefined;
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
  // preventDefault on touchstart suppresses synthetic pointer events so the
  // mouse handlers above only ever see real mouse input.

  let activeTouches: { id: number; x: number; y: number }[] = [];
  let touchTapOrigin: { id: number; x: number; y: number } | undefined;

  const syncTouches = (e: TouchEvent): void => {
    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  };

  useEventListener(container, "touchstart", (e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0]!;
    touchTapOrigin = e.touches.length === 1 ? { id: t.identifier, x: t.clientX, y: t.clientY } : undefined;
    syncTouches(e);
  }, { passive: false });

  useEventListener(container, "touchmove", (e: TouchEvent) => {
    e.preventDefault();

    if (e.touches.length === 1) {
      const touch = e.touches[0]!;
      const prev = activeTouches.find(p => p.id === touch.identifier);
      if (prev) {
        transform.pan.x += touch.clientX - prev.x;
        transform.pan.y += touch.clientY - prev.y;
      }

      if (touchTapOrigin && Math.hypot(touch.clientX - touchTapOrigin.x, touch.clientY - touchTapOrigin.y) > TAP_MAX_MOVEMENT) {
        touchTapOrigin = undefined;
      }
    } else if (e.touches.length === 2) {
      touchTapOrigin = undefined;
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
  }, { passive: false });

  useEventListener(container, "touchend", (e: TouchEvent) => {
    e.preventDefault();
    if (touchTapOrigin) {
      const changed = Array.from(e.changedTouches).find(t => t.identifier === touchTapOrigin!.id);
      if (changed && Math.hypot(changed.clientX - touchTapOrigin.x, changed.clientY - touchTapOrigin.y) <= TAP_MAX_MOVEMENT) {
        const { x, y } = containerPos(changed.clientX, changed.clientY);
        onTap?.(x, y);
      }

      touchTapOrigin = undefined;
    }

    syncTouches(e);
  }, { passive: false });

  useEventListener(container, "touchcancel", () => {
    touchTapOrigin = undefined;
    activeTouches = [];
  });
}
