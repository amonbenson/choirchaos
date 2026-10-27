<script setup lang="ts">
import { useId } from "vue";

defineProps<{
  title: string;
}>();

const titleId = useId();
</script>

<template>
  <section
    class="flex flex-col gap-3 border-t border-surface-200 pt-3 dark:border-surface-700"
    :aria-labelledby="titleId"
  >
    <h3
      :id="titleId"
      class="m-0 text-xs font-semibold tracking-wide text-muted-color uppercase"
    >
      {{ title }}
    </h3>
    <slot />
  </section>
</template>
