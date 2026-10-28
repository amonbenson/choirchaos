<script setup lang="ts">
import { computed } from "vue";

import type { SectionKind } from "@/core/models/sections";

import { MARKER_COLORS, SECTION_COLORS, SECTION_CONTRAST_TEXT } from "./sectionColors";

export type BadgeTone = "primary" | "marker" | "review" | "unnumbered" | "neutral" | SectionKind;

const props = defineProps<{
  tone: BadgeTone;
  /** What screen readers hear instead of the short text. Without it the badge is hidden from them. */
  name?: string;
  /** A selectable badge selects its own object. Every other badge leaves the click to the box below it. */
  selectable?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const TONES: Record<Exclude<BadgeTone, SectionKind>, string> = {
  primary: "bg-primary text-primary-contrast",
  marker: `${MARKER_COLORS.background} ${MARKER_COLORS.contrast}`,
  review: "bg-review-fill text-review-contrast",
  unnumbered: "bg-unnumbered text-unnumbered-contrast",
  neutral: "bg-score-chip/95 text-score-chip-contrast inset-ring inset-ring-score-chip-border",
};

function isSectionTone(tone: BadgeTone): tone is SectionKind {
  return tone in SECTION_COLORS;
}

const toneClass = computed(() => isSectionTone(props.tone)
  ? [SECTION_COLORS[props.tone].background, SECTION_CONTRAST_TEXT]
  : TONES[props.tone]);

const stateClass = computed(() => [
  props.selectable ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary" : "",
  props.selected ? "ring-2 ring-primary" : "",
]);

/**
 * A selectable badge with a name is a button. Without a name it repeats another badge, such as a section's
 * chip on its second row, so it only takes the pointer and stays hidden from screen readers.
 */
const isButton = computed(() => props.selectable && !!props.name);

const ariaAttrs = computed(() => isButton.value
  ? { "type": "button", "aria-label": props.name, "aria-pressed": props.selected }
  : { "role": props.name ? "img" : undefined, "aria-label": props.name, "aria-hidden": props.name ? undefined : "true" as const });

function onClick(event: MouseEvent): void {
  if (!props.selectable) {
    return;
  }

  event.stopPropagation();
  emit("select");
}
</script>

<template>
  <component
    :is="isButton ? 'button' : 'span'"
    v-bind="ariaAttrs"
    class="pointer-events-auto inline-flex h-4 max-w-32 shrink-0 items-center gap-1 rounded-sm px-1 text-[0.625rem]/4 font-semibold whitespace-nowrap shadow-sm select-none"
    :class="[toneClass, stateClass]"
    @click="onClick"
  >
    <slot />
  </component>
</template>
