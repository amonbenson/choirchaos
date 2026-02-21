<script setup lang="ts">
import Show from "@/core/show/show";
import { resolveUrl } from "@/core/utils/file";
import Card from "primevue/card";
import { onMounted, ref, type Ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const shows: Ref<Show[]> = ref([]);

onMounted(async () => {
  shows.value = await Show.list();
});
</script>

<template>
  <div class="size-full flex justify-center items-center overflow-hidden">
    <Card
      v-for="show in shows"
      :key="show.id"
      class="overflow-hidden w-64 cursor-pointer"
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
