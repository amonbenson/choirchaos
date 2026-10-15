<script setup lang="ts">
import Button from "primevue/button";
import Toolbar from "primevue/toolbar";

import UserMenuButton from "./UserMenuButton.vue";

defineProps<{
  title?: string;
  backTo?: object;
}>();
</script>

<template>
  <div class="relative">
    <Toolbar
      pt:root="flex-nowrap gap-4"
      pt:start="min-w-0 gap-2"
    >
      <template #start>
        <RouterLink
          v-if="backTo"
          v-slot="{ navigate }"
          :to="backTo"
          custom
        >
          <Button
            icon="pi pi-arrow-left"
            severity="secondary"
            aria-label="Back"
            text
            rounded
            @click="navigate"
          />
        </RouterLink>
        <h1 class="truncate text-xl font-bold sm:text-2xl">
          {{ title ?? "Choir Chaos" }}
        </h1>
      </template>

      <template #end>
        <div class="flex items-center gap-4">
          <slot name="end" />
          <UserMenuButton class="-m-1" />
        </div>
      </template>
    </Toolbar>
  </div>
</template>
