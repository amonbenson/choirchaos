<script setup lang="ts">
import { useDropZone, useFileDialog } from "@vueuse/core";
import Button from "primevue/button";
import Divider from "primevue/divider";
import InputText from "primevue/inputtext";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import Panel from "primevue/panel";
import ProgressSpinner from "primevue/progressspinner";
import { useConfirm } from "primevue/useconfirm";
import { computed, type Ref, ref, useTemplateRef, watch } from "vue";
import { type RouteLocationRaw, useRouter } from "vue-router";

import HeaderBar from "@/components/header/HeaderBar.vue";
import CoverPicker from "@/components/show/CoverPicker.vue";
import DeleteShowDialog from "@/components/show/DeleteShowDialog.vue";
import ShareDialog from "@/components/show/ShareDialog.vue";
import NewSongDialog from "@/components/song/NewSongDialog.vue";
import SongImportDialog from "@/components/song/SongImportDialog.vue";
import SongSetupStatus from "@/components/song/SongSetupStatus.vue";
import { useNotify } from "@/composables/useNotify";
import { RECORDING_FILE_ACCEPT } from "@/core/import/songImport";
import Show from "@/core/models/show";
import type Song from "@/core/models/song";
import { getSongSetup, isFileStep } from "@/core/models/songSetup";
import { displayFilename } from "@/core/utils/file";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  showId: string;
}>();

const auth = useAuthStore();
const settings = useSettingsStore();
const router = useRouter();
const confirm = useConfirm();
const { notifyError } = useNotify();

const VISIBILITY_SUMMARY = {
  private: { icon: "pi-lock", label: "Only people added" },
  unlisted: { icon: "pi-link", label: "Anyone with the link" },
  public: { icon: "pi-globe", label: "Public" },
};

const show = ref() as Ref<Show | undefined>;
const loading = ref(true);
const title = ref("");
const shareVisible = ref(false);
const deleteVisible = ref(false);
const importFiles = ref<File[]>([]);
const importVisible = ref(false);
const newSongVisible = ref(false);
const songMenu = ref();
const songMenuItems = ref<MenuItem[]>([]);

const role = computed(() => show.value?.getRole(auth.user?.id));
const isOwner = computed(() => role.value === "owner");
const songs = computed(() => show.value?.songs ?? []);

const accessSummary = computed(() => {
  if (!show.value) {
    return undefined;
  }

  const { visibility, editors, viewers } = show.value.permissions;
  const people = [
    editors.length > 0 ? `${editors.length} ${editors.length === 1 ? "editor" : "editors"}` : "",
    viewers.length > 0 ? `${viewers.length} ${viewers.length === 1 ? "viewer" : "viewers"}` : "",
  ].filter(Boolean).join(", ");

  return { ...VISIBILITY_SUMMARY[visibility], people: people || "Not shared with anyone yet" };
});

async function loadShow(): Promise<void> {
  loading.value = true;
  try {
    const loaded = await Show.get(props.showId);
    if (!loaded.getAccess(auth.user?.id).editor) {
      router.replace({ name: "show", params: { showId: props.showId } });
      return;
    }

    show.value = loaded;
    title.value = loaded.title;
  } catch {
    router.replace({ name: "not-found", params: { pathMatch: ["show", props.showId, "edit"] } });
  } finally {
    loading.value = false;
  }
}

watch(() => [props.showId, auth.user?.id], loadShow, { immediate: true });

async function saveTitle(): Promise<void> {
  const trimmed = title.value.trim();
  if (!show.value || !trimmed || trimmed === show.value.title) {
    title.value = show.value?.title ?? "";
    return;
  }

  try {
    await show.value.updateTitle(trimmed);
  } catch (error) {
    title.value = show.value.title;
    notifyError("Could not rename the show", error);
  }
}

async function updateCover(file: File | undefined): Promise<void> {
  try {
    await show.value?.updateThumbnail(file);
  } catch (error) {
    notifyError("Could not change the cover", error);
  }
}

function startImport(files: File[]): void {
  if (files.length === 0) {
    return;
  }

  importFiles.value = files;
  importVisible.value = true;
}

const dropZone = useTemplateRef<HTMLElement>("dropZone");
const { isOverDropZone } = useDropZone(dropZone, {
  onDrop: files => startImport(files ?? []),
  multiple: true,
  preventDefaultForUnhandled: true,
});

const fileDialog = useFileDialog({ multiple: true, reset: true, accept: `.pdf,.mid,.midi,.json,application/pdf,audio/midi,application/json,${RECORDING_FILE_ACCEPT}` });
fileDialog.onChange(files => startImport(Array.from(files ?? [])));

function songRoute(song: Song, name: "song" | "song-edit"): RouteLocationRaw {
  return { name, params: { showId: props.showId, songId: song.id } };
}

function continueSetup(song: Song): void {
  const next = getSongSetup(song).next;
  settings.update({ workspace: { editorTab: next && isFileStep(next.id) ? "details" : "measures" } });
  router.push(songRoute(song, "song-edit"));
}

function confirmDeleteSong(song: Song): void {
  confirm.require({
    header: "Delete song",
    message: `Song ${song.number} "${song.title}" will be deleted permanently, including its score and recordings.`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Delete song", severity: "danger" },
    accept: async () => {
      try {
        await show.value?.deleteSong(song);
      } catch (error) {
        notifyError("Could not delete the song", error);
      }
    },
  });
}

function openSongMenu(event: Event, song: Song): void {
  songMenuItems.value = [
    { label: "Edit", icon: "pi pi-pencil", command: () => router.push(songRoute(song, "song-edit")) },
    { separator: true },
    { label: "Delete song", icon: "pi pi-trash", command: () => confirmDeleteSong(song) },
  ];
  songMenu.value.toggle(event);
}

function playbackSummary(song: Song): { icon: string; label: string } | undefined {
  if (song.playerMode === "midi") {
    return { icon: "pi-sliders-h", label: `MIDI, ${song.tracks.length} ${song.tracks.length === 1 ? "track" : "tracks"}` };
  }

  if (song.playerMode === "audio") {
    const count = song.audioFiles.length;
    return { icon: "pi-volume-up", label: `${count} ${count === 1 ? "recording" : "recordings"}` };
  }

  return undefined;
}
</script>

<template>
  <div
    ref="dropZone"
    class="relative flex size-full flex-col gap-2 p-2"
  >
    <HeaderBar
      class="relative z-10"
      :show="show"
    />

    <div
      v-if="loading && !show"
      class="flex flex-1 items-center justify-center"
    >
      <ProgressSpinner />
    </div>

    <div
      v-else-if="show"
      class="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto lg:grid-cols-[22rem_1fr] lg:overflow-hidden"
    >
      <!-- Show details -->
      <Panel
        header="Show"
        pt:root="flex flex-col lg:overflow-y-auto"
        pt:content-container="flex-1"
        pt:content="flex flex-col gap-5 h-full"
      >
        <div class="flex gap-4 lg:flex-col">
          <CoverPicker
            class="w-24 flex-none lg:w-full"
            :show-id="show.id"
            :thumbnail="show.thumbnail"
            @select="updateCover"
            @remove="updateCover(undefined)"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <label
              for="show-title"
              class="text-sm font-medium text-muted-color"
            >Title</label>
            <InputText
              id="show-title"
              v-model="title"
              fluid
              @blur="saveTitle"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium text-muted-color">Access</span>
          <div class="flex items-center gap-3 rounded-md border border-(--p-content-border-color) p-3">
            <span class="flex size-9 flex-none items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
              <i
                :class="`pi ${accessSummary!.icon}`"
                aria-hidden="true"
              />
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-medium">
                {{ accessSummary!.label }}
              </div>
              <div class="truncate text-sm text-muted-color">
                {{ accessSummary!.people }}
              </div>
            </div>
          </div>
          <Button
            label="Share"
            icon="pi pi-user-plus"
            severity="secondary"
            fluid
            @click="shareVisible = true"
          />
        </div>

        <div
          v-if="isOwner"
          class="mt-auto"
        >
          <Divider />
          <Button
            label="Delete show"
            icon="pi pi-trash"
            severity="danger"
            size="small"
            text
            @click="deleteVisible = true"
          />
        </div>
      </Panel>

      <!-- Songs -->
      <Panel
        pt:root="flex flex-col lg:min-h-0"
        pt:header="flex-none"
        pt:content-container="flex-1 lg:min-h-0 lg:overflow-y-auto"
        pt:content-wrapper="min-w-0"
        pt:content="h-full"
      >
        <template #header>
          <div class="flex w-full items-center justify-between gap-2">
            <span class="font-semibold">Songs <span
              v-if="songs.length > 0"
              class="font-normal text-muted-color"
            >&middot; {{ songs.length }}</span></span>
            <div
              v-if="songs.length > 0"
              class="flex gap-2"
            >
              <Button
                label="Import files"
                aria-label="Import files"
                icon="pi pi-upload"
                severity="secondary"
                size="small"
                pt:label="hidden sm:inline"
                @click="fileDialog.open()"
              />
              <Button
                label="New song"
                aria-label="New song"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                pt:label="hidden sm:inline"
                @click="newSongVisible = true"
              />
            </div>
          </div>
        </template>

        <!-- Empty state -->
        <div
          v-if="songs.length === 0"
          class="flex h-full items-center justify-center p-4"
        >
          <div class="flex w-full max-w-2xl flex-col items-center gap-4 rounded-lg border-2 border-dashed border-surface-300 px-4 py-12 text-center sm:px-8 dark:border-surface-700">
            <i
              class="pi pi-cloud-upload text-6xl text-primary"
              aria-hidden="true"
            />
            <div class="text-xl font-semibold">
              Add the songs of this show
            </div>
            <div class="max-w-lg text-muted-color">
              Drop score PDFs, MIDI files with their beat maps and audio recordings here. Files that start with the same number become one song.
            </div>
            <div class="flex max-w-full flex-col gap-1 overflow-hidden rounded bg-surface-100 px-4 py-3 text-left font-mono text-sm text-muted-color dark:bg-surface-800">
              <span>03 Swing Low.pdf</span>
              <span>03 Swing Low - Soprano.mp3</span>
              <span>03 Swing Low - Alto.mp3</span>
              <span class="mt-1 font-sans text-color"><i
                class="pi pi-arrow-right mr-2 text-xs"
                aria-hidden="true"
              />Song 3 "Swing Low" with its score and 2 recordings</span>
            </div>
            <div class="flex flex-wrap justify-center gap-2">
              <Button
                label="Choose files"
                icon="pi pi-folder-open"
                @click="fileDialog.open()"
              />
              <Button
                label="Add song manually"
                severity="secondary"
                text
                @click="newSongVisible = true"
              />
            </div>
          </div>
        </div>

        <template v-else>
          <!-- Phone list -->
          <ul class="-mx-2 flex flex-col md:hidden">
            <li
              v-for="song in songs"
              :key="song.id"
              class="flex items-center gap-3 border-b border-(--p-content-border-color) px-2 py-3 last:border-b-0"
            >
              <span class="w-8 font-mono text-muted-color">{{ song.number }}</span>
              <RouterLink
                :to="songRoute(song, 'song')"
                class="min-w-0 flex-1 text-left"
              >
                <div class="truncate font-medium">
                  {{ song.title }}
                </div>
                <SongSetupStatus
                  :song="song"
                  compact
                />
              </RouterLink>
              <Button
                icon="pi pi-ellipsis-v"
                severity="secondary"
                :aria-label="`Options for ${song.title}`"
                text
                rounded
                @click="openSongMenu($event, song)"
              />
            </li>
          </ul>

          <!-- Desktop table -->
          <table class="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr class="text-sm text-muted-color">
                <th class="w-14 py-2 pl-2 font-medium">
                  No.
                </th>
                <th class="py-2 pr-4 font-medium">
                  Title
                </th>
                <th class="py-2 pr-4 font-medium">
                  Score
                </th>
                <th class="py-2 pr-4 font-medium">
                  Playback
                </th>
                <th class="py-2 pr-4 font-medium">
                  Status
                </th>
                <th class="w-24" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="song in songs"
                :key="song.id"
                class="group cursor-pointer border-t border-(--p-content-border-color) transition-colors hover:bg-surface-50 dark:hover:bg-surface-800/60"
                @click="router.push(songRoute(song, 'song'))"
              >
                <td class="py-3 pl-2 font-mono text-muted-color">
                  {{ song.number }}
                </td>
                <td class="py-3 pr-4 font-medium">
                  <RouterLink
                    :to="songRoute(song, 'song')"
                    class="focus-visible:underline focus-visible:outline-none"
                    @click.stop
                  >
                    {{ song.title }}
                  </RouterLink>
                </td>
                <td class="max-w-48 py-3 pr-4 text-sm">
                  <span
                    v-if="song.pdfFile"
                    class="flex items-center gap-2"
                    :title="displayFilename(song.pdfFile)"
                  ><i
                    class="pi pi-file-pdf text-muted-color"
                    aria-hidden="true"
                  /><span class="truncate">{{ displayFilename(song.pdfFile) }}</span></span>
                  <span
                    v-else
                    class="text-muted-color italic"
                  >None</span>
                </td>
                <td class="py-3 pr-4 text-sm whitespace-nowrap">
                  <span
                    v-if="playbackSummary(song)"
                    class="flex items-center gap-2"
                  ><i
                    :class="`pi ${playbackSummary(song)!.icon} text-muted-color`"
                    aria-hidden="true"
                  />{{ playbackSummary(song)!.label }}</span>
                  <span
                    v-else
                    class="text-muted-color italic"
                  >None</span>
                </td>
                <td class="py-3 pr-4">
                  <SongSetupStatus
                    :song="song"
                    @continue="continueSetup(song)"
                  />
                </td>
                <td class="py-3 pr-2">
                  <div class="flex justify-end gap-1 transition-opacity mouse:opacity-0 mouse:group-focus-within:opacity-100 mouse:group-hover:opacity-100">
                    <Button
                      icon="pi pi-ellipsis-v"
                      severity="secondary"
                      size="small"
                      :aria-label="`Options for ${song.title}`"
                      text
                      rounded
                      @click.stop="openSongMenu($event, song)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="mt-4 hidden rounded-md border border-dashed border-surface-300 p-3 text-center text-sm text-muted-color md:block dark:border-surface-700">
            <i
              class="pi pi-upload mr-2"
              aria-hidden="true"
            />Drop files anywhere to add songs or update existing ones
          </div>
        </template>
      </Panel>
    </div>

    <!-- Drop overlay -->
    <div
      v-if="isOverDropZone && show"
      class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm"
    >
      <div class="flex flex-col items-center gap-2 text-primary">
        <i
          class="pi pi-cloud-upload text-6xl"
          aria-hidden="true"
        />
        <span class="text-xl font-semibold">Drop to import into "{{ show.title }}"</span>
      </div>
    </div>

    <Menu
      ref="songMenu"
      :model="songMenuItems"
      popup
    />

    <template v-if="show">
      <ShareDialog
        v-model="shareVisible"
        :show="show"
      />
      <DeleteShowDialog
        v-model="deleteVisible"
        :show="show"
        @deleted="router.replace({ name: 'home' })"
      />
      <SongImportDialog
        v-if="importVisible"
        v-model="importVisible"
        :show="show"
        :files="importFiles"
      />
      <NewSongDialog
        v-model="newSongVisible"
        :show="show"
        @created="show.addSong($event)"
      />
    </template>
  </div>
</template>
