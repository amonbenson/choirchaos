<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { onBeforeUnmount, type Ref, ref, toRaw } from "vue";

type DraggableEvent = {
  active: boolean;
  status: "start" | "move" | "end";
  start: {
    x: number;
    y: number;
  };
  end: {
    x: number;
    y: number;
  };
  delta: {
    x: number;
    y: number;
  };
  target: HTMLElement;
  events: {
    mousedown: MouseEvent | undefined;
    mousemove: MouseEvent | undefined;
    mouseup: MouseEvent | undefined;
    touchstart: TouchEvent | undefined;
    touchmove: TouchEvent | undefined;
    touchend: TouchEvent | undefined;
  };
};

const emit = defineEmits(["dragstart", "drag", "dragend"]);

const target: Ref<HTMLElement | undefined> = ref();

const state: Ref<DraggableEvent> = ref({
  active: false,
  status: "start",
  start: {
    x: 0,
    y: 0,
  },
  end: {
    x: 0,
    y: 0,
  },
  delta: {
    x: 0,
    y: 0,
  },
  target: target.value as HTMLElement,
  events: {
    mousedown: undefined,
    mousemove: undefined,
    mouseup: undefined,
    touchstart: undefined,
    touchmove: undefined,
    touchend: undefined,
  },
});
const lastPosition = ref({
  x: 0,
  y: 0,
});

function handleMouseDown(event: MouseEvent): void {
  if (event.target !== target.value) {
    return;
  }

  state.value = {
    active: true,
    status: "start",
    start: {
      x: event.offsetX,
      y: event.offsetY,
    },
    end: {
      x: event.offsetX,
      y: event.offsetY,
    },
    delta: {
      x: 0,
      y: 0,
    },
    target: target.value as HTMLElement,
    events: {
      mousedown: event,
      mousemove: undefined,
      mouseup: undefined,
      touchstart: undefined,
      touchmove: undefined,
      touchend: undefined,
    },
  };
  emit("dragstart", toRaw(state.value));
}

function handleMouseMove(event: MouseEvent): void {
  if (!state.value.active) {
    return;
  }

  state.value.status = "move";
  state.value.end = {
    x: event.offsetX,
    y: event.offsetY,
  };
  state.value.delta = {
    x: event.movementX,
    y: event.movementY,
  };
  state.value.events.mousemove = event;
  emit("drag", toRaw(state.value));
}

function handleMouseUp(event: MouseEvent): void {
  if (!state.value.active) {
    return;
  }

  state.value.active = false;
  state.value.status = "end";
  state.value.end = {
    x: event.offsetX,
    y: event.offsetY,
  };
  state.value.delta = {
    x: 0,
    y: 0,
  };
  state.value.events.mouseup = event;
  emit("dragend", toRaw(state.value));
}

function handleTouchStart(event: TouchEvent): void {
  if (event.target !== target.value) {
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    return;
  }

  state.value = {
    active: true,
    status: "start",
    start: {
      x: touch.clientX,
      y: touch.clientY,
    },
    end: {
      x: touch.clientX,
      y: touch.clientY,
    },
    delta: {
      x: 0,
      y: 0,
    },
    target: target.value as HTMLElement,
    events: {
      mousedown: undefined,
      mousemove: undefined,
      mouseup: undefined,
      touchstart: event,
      touchmove: undefined,
      touchend: undefined,
    },
  };
  lastPosition.value = state.value.start;
  emit("dragstart", toRaw(state.value));
}

function handleTouchMove(event: TouchEvent): void {
  if (!state.value.active) {
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    return;
  }

  state.value.status = "move";
  state.value.end = {
    x: touch.clientX,
    y: touch.clientY,
  };
  state.value.delta = {
    x: state.value.end.x - lastPosition.value.x,
    y: state.value.end.y - lastPosition.value.y,
  };
  lastPosition.value = state.value.end;
  state.value.events.touchmove = event;
  emit("drag", toRaw(state.value));
}

function handleTouchEnd(event: TouchEvent): void {
  if (!state.value.active) {
    return;
  }

  state.value.active = false;
  state.value.status = "end";
  state.value.delta = {
    x: 0,
    y: 0,
  };
  state.value.events.touchend = event;
  emit("dragend", toRaw(state.value));
}

function registerListeners(): void {
  target.value?.addEventListener("mousedown", handleMouseDown);
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
  window.addEventListener("mouseleave", handleMouseUp);

  target.value?.addEventListener("touchstart", handleTouchStart);
  target.value?.addEventListener("touchmove", handleTouchMove);
  target.value?.addEventListener("touchend", handleTouchEnd);
  target.value?.addEventListener("touchcancel", handleTouchEnd);
}

function unregisterListeners(): void {
  target.value?.removeEventListener("mousedown", handleMouseDown);
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", handleMouseUp);
  window.removeEventListener("mouseleave", handleMouseUp);

  target.value?.removeEventListener("touchstart", handleTouchStart);
  target.value?.removeEventListener("touchmove", handleTouchMove);
  target.value?.removeEventListener("touchend", handleTouchEnd);
  target.value?.removeEventListener("touchcancel", handleTouchEnd);
}

function passRef(el: any): void {
  if (!(el instanceof HTMLElement)) {
    console.error("passRef() can only accept direct Element references (no Vue components)");
  }

  // unregister previous listeners if any
  if (target.value) {
    unregisterListeners();
  }

  // register new listeners
  target.value = el;
  registerListeners();
}

onBeforeUnmount(() => {
  if (target.value) {
    unregisterListeners();
  }
});
</script>

<template>
  <slot
    :pass-ref="passRef"
    :drag-state="state"
  />
</template>
