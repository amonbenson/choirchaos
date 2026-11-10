<script setup lang="ts">
import Card from "primevue/card";
import { useId } from "vue";

defineProps<{
  title: string;
}>();

const titleId = useId();
</script>

<!-- A status, so screen readers announce what playback waits for, named by its title. -->
<template>
  <Card
    class="overflow-hidden rounded-xl bg-surface/75 text-center backdrop-blur"
    pt:body:class="p-2"
    role="status"
    :aria-labelledby="titleId"
  >
    <template #title>
      <span :id="titleId">{{ title }}</span>
    </template>
    <template #content>
      <i class="m-0">
        <slot />
      </i>
    </template>
  </Card>
</template>
