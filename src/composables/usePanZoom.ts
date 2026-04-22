import { useGesture } from "@vueuse/gesture";
import { onMounted, onUnmounted, type Ref } from "vue";

import type PageTransform from "@/core/pdf/pageTransform";

// Attaches pan, zoom, and tap gesture handling to a container element.
// - Mouse drag / single-finger pan and tap: handled by @vueuse/gesture onDrag
// - Wheel scroll / Ctrl+scroll zoom: handled by @vueuse/gesture onWheel
// - Two-finger touch pinch/zoom: handled by native touch listeners
//   (touch preventDefault stops pointer events so onDrag ignores touch)
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

  // ── Mouse drag + tap (via @vueuse/gesture) ──────────────────────────────────

  // Track which button started the gesture so middle-button taps don't trigger onTap.
  // useGesture clears `buttons` to 0 before firing the tap callback, so we need this
  // separately.
  let gestureStartButton = 0;

  function onPointerDown(e: PointerEvent): void {
    gestureStartButton = e.button;
  }

  useGesture(
    {
      onDrag: ({ tap, xy, delta }) => {
        if (tap) {
          if (gestureStartButton !== 1) {
            const pos = containerPos(xy[0], xy[1]);
            onTap?.(pos.x, pos.y);
          }

          return;
        }

        transform.pan.x += delta[0];
        transform.pan.y += delta[1];
        onRedraw();
      },

      onWheel: ({ delta, event }) => {
        event.preventDefault();
        const pos = containerPos(event.clientX, event.clientY);

        if (event.metaKey || event.ctrlKey) {
          transform.setZoom(transform.zoom * Math.exp(-0.005 * delta[1]), pos);
        } else {
          transform.pan.x -= delta[0];
          transform.pan.y -= delta[1];
        }

        onRedraw();
      },
    },
    {
      domTarget: container,
      drag: { filterTaps: true },
      eventOptions: { passive: false },
    },
  );

  // ── Touch: single-finger pan + two-finger pinch/zoom ────────────────────────
  // Calling preventDefault() on touchstart suppresses the synthetic pointer
  // events for touch, so onDrag above only ever sees mouse input.

  let activeTouches: { id: number; x: number; y: number }[] = [];
  let tapStart: { id: number; x: number; y: number } | undefined;
  const TAP_MAX_MOVEMENT = 10;

  function onTouchStart(e: TouchEvent): void {
    e.preventDefault();

    if (e.touches.length === 1) {
      const t = e.touches[0]!;
      tapStart = { id: t.identifier, x: t.clientX, y: t.clientY };
    } else {
      tapStart = undefined;
    }

    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  }

  function onTouchMove(e: TouchEvent): void {
    e.preventDefault();

    if (e.touches.length === 1) {
      const touch = e.touches[0]!;
      const prev = activeTouches.find(t => t.id === touch.identifier);
      if (prev) {
        transform.pan.x += touch.clientX - prev.x;
        transform.pan.y += touch.clientY - prev.y;
        if (tapStart && Math.hypot(touch.clientX - tapStart.x, touch.clientY - tapStart.y) > TAP_MAX_MOVEMENT) {
          tapStart = undefined;
        }
      }

      onRedraw();
    } else if (e.touches.length === 2) {
      tapStart = undefined;
      const [t1, t2] = Array.from(e.touches) as [Touch, Touch];
      const prevT1 = activeTouches.find(t => t.id === t1.identifier);
      const prevT2 = activeTouches.find(t => t.id === t2.identifier);
      if (prevT1 && prevT2) {
        const prevDist = Math.hypot(prevT2.x - prevT1.x, prevT2.y - prevT1.y);
        const currDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const prevCenter = containerPos((prevT1.x + prevT2.x) / 2, (prevT1.y + prevT2.y) / 2);
        const currCenter = containerPos((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
        if (prevDist > 0) {
          transform.setZoom(transform.zoom * (currDist / prevDist), prevCenter);
          transform.pan.x += currCenter.x - prevCenter.x;
          transform.pan.y += currCenter.y - prevCenter.y;
        }
      }

      onRedraw();
    }

    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  }

  function onTouchEnd(e: TouchEvent): void {
    e.preventDefault();

    if (tapStart) {
      const changed = Array.from(e.changedTouches).find(t => t.identifier === tapStart!.id);
      if (changed && Math.hypot(changed.clientX - tapStart.x, changed.clientY - tapStart.y) <= TAP_MAX_MOVEMENT) {
        const pos = containerPos(changed.clientX, changed.clientY);
        onTap?.(pos.x, pos.y);
      }

      tapStart = undefined;
    }

    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  }

  onMounted(() => {
    const el = container.value!;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });
  });

  onUnmounted(() => {
    const el = container.value;
    if (!el) {
      return;
    }

    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchEnd);
  });
}
