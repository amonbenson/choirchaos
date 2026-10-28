<script setup lang="ts">
defineProps<{
  /** 0 sits on the top edge of the boxes, every further lane one lane height above. */
  lane: number;
}>();
</script>

<!-- A lane holds badges above the strip of a section bar. Lanes without a bar keep the strip, so their badges line up with section chips. -->
<template>
  <div
    class="pointer-events-none absolute flex h-6 translate-y-[calc(var(--lane)*-100%)] flex-col justify-end"
    :style="{ '--lane': lane }"
  >
    <slot />
    <div class="relative my-0.5 h-0.75">
      <slot name="bar" />
    </div>
  </div>
</template>
