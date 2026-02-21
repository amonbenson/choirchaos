import { onMounted, onUnmounted, type Ref, watch } from "vue";

import type PageTransform from "@/core/pdf/pageTransform";

// Attaches pan, zoom, and tap gesture handling to a container element.
// Mutates `transform` directly and calls `onRedraw` after each change.
export function usePanZoom(
  container: Ref<HTMLElement | undefined>,
  transform: PageTransform,
  options: {
    cursor?: Ref<string | undefined>;
    onRedraw: () => void;
    onTap?: (x: number, y: number) => void;
  },
) {
  const { cursor, onRedraw, onTap } = options;

  let pressing = false;

  function setCursor(value: string) {
    if (container.value) {
      container.value.style.cursor = value;
    }
  }

  function idleCursor() {
    setCursor(cursor?.value ?? "grab");
  }

  function activeCursor() {
    setCursor(cursor?.value ?? "grabbing");
  }

  if (cursor) {
    watch(cursor, () => pressing ? activeCursor() : idleCursor());
  }

  function containerPos(clientX: number, clientY: number) {
    const rect = container.value!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // ── Mouse / pointer events ──────────────────────────────────────────────────

  let lastX: number | undefined;
  let lastY: number | undefined;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "mouse") {
      return;
    }

    if (e.target !== container.value && !(container.value?.contains(e.target as Node))) {
      return;
    }

    pressing = true;
    lastX = e.clientX;
    lastY = e.clientY;
    activeCursor();
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== "mouse") {
      return;
    }

    if (pressing && lastX !== undefined && lastY !== undefined) {
      transform.pan.x += e.clientX - lastX;
      transform.pan.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      onRedraw();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType !== "mouse" || !pressing) {
      return;
    }

    pressing = false;
    lastX = undefined;
    lastY = undefined;
    idleCursor();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const pos = containerPos(e.clientX, e.clientY);
    if (e.metaKey || e.ctrlKey) {
      // metaKey: macOS Cmd+scroll; ctrlKey: trackpad/mobile pinch
      transform.setZoom(transform.zoom * Math.exp(-0.005 * e.deltaY), pos);
    } else {
      transform.pan.x -= e.deltaX;
      transform.pan.y -= e.deltaY;
    }

    onRedraw();
  }

  // ── Touch events (single-finger pan, two-finger pinch, tap) ─────────────────

  let activeTouches: { id: number; x: number; y: number }[] = [];
  let tapStart: { id: number; x: number; y: number } | undefined;
  const TAP_MAX_MOVEMENT = 10;

  function onTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1) {
      pressing = true;
      const t = e.touches[0]!;
      tapStart = { id: t.identifier, x: t.clientX, y: t.clientY };
      activeCursor();
    } else {
      tapStart = undefined;
    }

    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  }

  function onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1 && pressing) {
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
          // Zoom around the previous centroid, then pan it to the current centroid
          transform.setZoom(transform.zoom * (currDist / prevDist), prevCenter);
          transform.pan.x += currCenter.x - prevCenter.x;
          transform.pan.y += currCenter.y - prevCenter.y;
        }
      }

      onRedraw();
    }

    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  }

  function onTouchEnd(e: TouchEvent) {
    e.preventDefault();
    if (tapStart) {
      const changed = Array.from(e.changedTouches).find(t => t.identifier === tapStart!.id);
      if (changed && Math.hypot(changed.clientX - tapStart.x, changed.clientY - tapStart.y) <= TAP_MAX_MOVEMENT) {
        const pos = containerPos(changed.clientX, changed.clientY);
        onTap?.(pos.x, pos.y);
      }

      tapStart = undefined;
    }

    if (e.touches.length === 0) {
      pressing = false;
      idleCursor();
    }

    activeTouches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onMounted(() => {
    const el = container.value!;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    idleCursor();
  });

  onUnmounted(() => {
    const el = container.value;
    if (!el) {
      return;
    }

    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
  });
}
