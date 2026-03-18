<script setup lang="ts">
import Dialog from "primevue/dialog";

const visible = defineModel<boolean>({ default: false });
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="Settings"
    modal
    dismissable-mask
    pt:root:class="w-[50rem] max-w-[calc(100vw-2rem)]"
  >
    <p class="text-muted-color">
      Settings coming soon.
    </p>
  </Dialog>
</template>
