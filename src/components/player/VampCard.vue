<script setup lang="ts">
import Card from "primevue/card";

defineProps<{
  title: string;
}>();

</script>

<template>
  <Card
    class="overflow-hidden rounded-xl bg-surface/75 text-center backdrop-blur"
    pt:body:class="p-2"
  >
    <template #title>
      {{ title }}
    </template>
    <template #content>
      <i class="m-0">
        <slot />
      </i>
    </template>
  </Card>
</template>
