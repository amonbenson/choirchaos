<script setup lang="ts">
import { computed, type Ref, ref, watch } from "vue";
import { useRouter } from "vue-router";

import DeleteShowDialog from "@/components/DeleteShowDialog.vue";
import HeaderBar from "@/components/HeaderBar.vue";
import NewShowDialog from "@/components/NewShowDialog.vue";
import ShareDialog from "@/components/ShareDialog.vue";
import ShowCard from "@/components/ShowCard.vue";
import { useNotify } from "@/composables/useNotify";
import Show from "@/core/models/show";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const { notifyError } = useNotify();

const shows = ref([]) as Ref<Show[]>;
const loaded = ref(false);
const newShowVisible = ref(false);
const sharedShow = ref() as Ref<Show | undefined>;
const deletedShow = ref() as Ref<Show | undefined>;

const shareVisible = computed({
  get: () => !!sharedShow.value,
  set: (value) => {
    if (!value) {
      sharedShow.value = undefined;
    }
  },
});

const deleteVisible = computed({
  get: () => !!deletedShow.value,
  set: (value) => {
    if (!value) {
      deletedShow.value = undefined;
    }
  },
});

const sections = computed(() => {
  const userId = auth.user?.id;
  const sectionOf = (show: Show): "mine" | "shared" | "public" => {
    const role = show.getRole(userId);
    if (role === "owner") {
      return "mine";
    }

    return role ? "shared" : "public";
  };

  return [
    { id: "mine", title: "My shows", shows: shows.value.filter(s => sectionOf(s) === "mine") },
    { id: "shared", title: "Shared with me", shows: shows.value.filter(s => sectionOf(s) === "shared") },
    { id: "public", title: "Public", shows: shows.value.filter(s => sectionOf(s) === "public") },
  ];
});

// "My shows" stays visible with only the new show tile, so signed in users always find the way to create one.
const visibleSections = computed(() => sections.value.filter(section => section.shows.length > 0 || (section.id === "mine" && auth.user)));

// Section headings only help when there is more than one section to tell apart.
const showHeadings = computed(() => visibleSections.value.length > 1);

async function loadShows(): Promise<void> {
  try {
    shows.value = await Show.list();
  } catch (error) {
    notifyError("Could not load shows", error);
  } finally {
    loaded.value = true;
  }

  if (!auth.user && shows.value.length === 0) {
    router.push({ name: "login" });
  }
}

watch(() => auth.user, loadShows, { immediate: true });

function openShow(show: Show): void {
  router.push({ name: "show", params: { showId: show.id } });
}

function editShow(show: Show): void {
  router.push({ name: "show-edit", params: { showId: show.id } });
}

function onShowDeleted(show: Show): void {
  shows.value = shows.value.filter(s => s !== show);
}
</script>

<template>
  <div class="flex size-full flex-col gap-2 p-2">
    <HeaderBar class="relative z-10" />

    <div class="relative z-0 flex-1 overflow-y-auto">
      <div
        v-if="loaded"
        class="mx-auto flex min-h-full max-w-6xl flex-col gap-8 p-4"
        :class="showHeadings ? '' : 'justify-center'"
      >
        <section
          v-for="section in visibleSections"
          :key="section.id"
          class="flex flex-col gap-3"
          :aria-label="section.title"
        >
          <h2
            v-if="showHeadings"
            class="text-lg font-semibold text-muted-color"
          >
            {{ section.title }}
          </h2>
          <div
            class="flex flex-wrap gap-4 sm:gap-6"
            :class="showHeadings ? 'justify-center sm:justify-start' : 'justify-center'"
          >
            <ShowCard
              v-for="show in section.shows"
              :key="show.id"
              :show="show"
              :role="show.getRole(auth.user?.id)"
              :show-role="section.id === 'shared'"
              @open="openShow(show)"
              @edit="editShow(show)"
              @share="sharedShow = show"
              @delete="deletedShow = show"
            />
            <button
              v-if="section.id === 'mine' && auth.user"
              type="button"
              class="flex aspect-square w-40 cursor-pointer flex-col items-center justify-center gap-2 self-start rounded border-2 border-dashed border-surface-300 text-muted-color transition-colors hover:border-primary hover:text-primary sm:w-52 dark:border-surface-700"
              @click="newShowVisible = true"
            >
              <i class="pi pi-plus text-3xl" />
              <span class="font-medium">New show</span>
            </button>
          </div>
        </section>
      </div>
    </div>

    <NewShowDialog v-model="newShowVisible" />
    <ShareDialog
      v-if="sharedShow"
      v-model="shareVisible"
      :show="sharedShow"
    />
    <DeleteShowDialog
      v-if="deletedShow"
      v-model="deleteVisible"
      :show="deletedShow"
      @deleted="onShowDeleted(deletedShow!)"
    />
  </div>
</template>
