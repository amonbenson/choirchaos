<script setup lang="ts">
import Card from "primevue/card";
import { onMounted, type Ref, ref } from "vue";
import { useRouter } from "vue-router";

import Show from "@/core/models/show";
import { resolveUrl } from "@/core/utils/file";

const router = useRouter();
const shows: Ref<Show[]> = ref([]);

onMounted(async () => {
  shows.value = await Show.list();
});
</script>

<template>
  <div class="flex size-full items-center justify-center overflow-hidden">
    <Card
      v-for="show in shows"
      :key="show.id"
      class="w-64 cursor-pointer overflow-hidden"
      @click="router.push({ name: 'show', params: { showId: show.id } })"
    >
      <template
        v-if="show.thumbnail"
        #header
      >
        <img
          alt="user header"
          :src="resolveUrl(show.thumbnail, 'shows', show.id)"
        >
      </template>

      <template #title>
        {{ show.title }}
      </template>
    </Card>
  </div>
</template>
