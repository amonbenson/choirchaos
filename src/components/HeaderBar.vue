<script setup lang="ts">
import Toolbar from "primevue/toolbar";
import { useRoute } from "vue-router";

import UserMenuButton from "./UserMenuButton.vue";

const route = useRoute();
</script>
<template>
  <div class="relative">
    <Toolbar>
      <template #start>
        <h1 class="overflow-hidden text-2xl font-bold text-ellipsis whitespace-nowrap">
          Choir Chaos
        </h1>

        <template v-if="route.name === 'edit'">
          TODO: Edit
        </template>
      </template>

      <template #end>
        <UserMenuButton class="-m-1 -ml-4" />
      </template>
    </Toolbar>
  </div>
</template>
