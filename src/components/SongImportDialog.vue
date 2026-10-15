<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import Tag from "primevue/tag";
import { computed, ref, watch } from "vue";

import { getErrorMessage } from "@/composables/useNotify";
import {
  type ExistingSong,
  hasImportableFiles,
  type ImportRow,
  planImport,
  type ResolvedImportRow,
  resolveImportRow,
  type SkippedFile,
} from "@/core/import/songImport";
import type Show from "@/core/models/show";
import Song from "@/core/models/song";
import { isNumbering } from "@/core/utils/numbering";

const props = defineProps<{
  show: Show;
  files: File[];
}>();

const emit = defineEmits<{
  imported: [songs: Song[]];
}>();

const visible = defineModel<boolean>({ required: true });

type RowStatus = "idle" | "running" | "done" | "error";

type EditableRow = ImportRow & {
  include: boolean;
  status: RowStatus;
  error?: string;
};

const rows = ref<EditableRow[]>([]);
const skipped = ref<SkippedFile[]>([]);
const planning = ref(false);
const importing = ref(false);
const finished = ref(false);

function toExistingSong(song: Song): ExistingSong {
  return { id: song.id, number: song.number, hasScore: !!song.pdfFile, playback: song.playerMode };
}

const existingByNumber = computed(() => new Map(props.show.songs.map(song => [song.number, toExistingSong(song)])));

function resolve(row: EditableRow): ResolvedImportRow {
  return resolveImportRow(row, existingByNumber.value.get(row.number.trim()));
}

const numberCounts = computed(() => {
  const counts = new Map<string, number>();
  rows.value.filter(row => row.include).forEach(row => counts.set(row.number.trim(), (counts.get(row.number.trim()) ?? 0) + 1));
  return counts;
});

function getRowProblem(row: EditableRow): string | undefined {
  if (!isNumbering(row.number.trim())) {
    return "Needs a number";
  }

  if ((numberCounts.value.get(row.number.trim()) ?? 0) > 1) {
    return "Number used twice";
  }

  if (!row.title.trim()) {
    return "Needs a title";
  }

  return hasImportableFiles(resolve(row).files) ? undefined : "Nothing to import";
}

const includedRows = computed(() => rows.value.filter(row => row.include));
const canImport = computed(() => includedRows.value.length > 0 && includedRows.value.every(row => !getRowProblem(row)));
const fileCount = computed(() => props.files.length);

watch(visible, async (value) => {
  if (!value) {
    return;
  }

  planning.value = true;
  finished.value = false;
  try {
    const plan = await planImport(props.files);
    skipped.value = plan.skipped;
    rows.value = plan.rows.map(row => ({ ...row, include: true, status: "idle" }));
    rows.value.forEach((row) => {
      row.include = isNumbering(row.number) && hasImportableFiles(resolve(row).files);
    });
  } finally {
    planning.value = false;
  }
}, { immediate: true });

async function importRow(row: EditableRow): Promise<Song> {
  const resolved = resolve(row);
  const details = { number: row.number.trim(), title: row.title.trim() };
  const existing = props.show.songs.find(song => song.id === resolved.existingSongId);

  if (existing) {
    await existing.addFiles(resolved.files);
    return existing;
  }

  const song = await Song.create(props.show.id, details, resolved.files, props.show.permissions);
  props.show.addSong(song);
  return song;
}

async function runImport(): Promise<void> {
  if (!canImport.value || importing.value) {
    return;
  }

  importing.value = true;
  const songs: Song[] = [];

  // One at a time keeps memory and bandwidth bounded for large recordings.
  for (const row of includedRows.value) {
    row.status = "running";
    try {
      songs.push(await importRow(row));
      row.status = "done";
    } catch (error) {
      row.status = "error";
      row.error = getErrorMessage(error);
    }
  }

  importing.value = false;
  finished.value = true;
  emit("imported", songs);

  if (rows.value.every(row => !row.include || row.status === "done")) {
    visible.value = false;
  }
}

function resultTag(row: EditableRow): { value: string; severity: string } {
  const problem = getRowProblem(row);
  if (problem) {
    return { value: problem, severity: "warn" };
  }

  const resolved = resolve(row);
  return resolved.action === "create"
    ? { value: "New song", severity: "success" }
    : { value: `Update #${row.number.trim()}`, severity: "info" };
}

function fileChips(row: EditableRow): { icon: string; label: string }[] {
  const { score, midi, beatMap, recordings = [] } = row.files;
  return [
    ...(score ? [{ icon: "pi-file-pdf", label: "Score" }] : []),
    ...(midi ? [{ icon: "pi-sliders-h", label: "MIDI" }] : []),
    ...(beatMap ? [{ icon: "pi-list", label: "Beat map" }] : []),
    ...recordings.map(recording => ({ icon: "pi-volume-up", label: recording.title })),
  ];
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="`Import ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`"
    class="w-[60rem] max-w-[calc(100vw-2rem)]"
    :closable="!importing"
    modal
  >
    <div
      v-if="planning"
      class="flex justify-center p-8"
    >
      <ProgressSpinner />
    </div>
    <div
      v-else
      class="flex flex-col gap-4"
    >
      <span class="text-muted-color">Files are grouped into songs by the number at the start of each file name. Check the numbers and titles, then import.</span>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] border-collapse text-left">
          <thead>
            <tr class="text-sm text-muted-color">
              <th class="w-8" />
              <th class="w-24 pb-2 font-medium">
                No.
              </th>
              <th class="pb-2 font-medium">
                Title
              </th>
              <th class="pb-2 font-medium">
                Files
              </th>
              <th class="w-40 pb-2 font-medium">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.key"
              class="border-t border-(--p-content-border-color) align-top"
              :class="row.include ? '' : 'opacity-60'"
            >
              <td class="py-2">
                <Checkbox
                  v-model="row.include"
                  :aria-label="`Import ${row.title}`"
                  :disabled="importing || finished"
                  binary
                />
              </td>
              <td class="py-2 pr-2">
                <InputText
                  v-model="row.number"
                  size="small"
                  class="w-20 font-mono"
                  :aria-label="`Number of ${row.title}`"
                  :invalid="row.include && !isNumbering(row.number.trim())"
                  :disabled="importing || finished"
                  placeholder="?"
                />
              </td>
              <td class="py-2 pr-2">
                <InputText
                  v-model="row.title"
                  size="small"
                  :aria-label="`Title of song ${row.number}`"
                  :disabled="importing || finished"
                  fluid
                />
              </td>
              <td class="py-2 pr-2">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="chip, i in fileChips(row)"
                    :key="i"
                    class="flex items-center gap-1 rounded bg-surface-100 px-2 py-0.5 text-xs dark:bg-surface-800"
                  >
                    <i :class="`pi ${chip.icon} text-[0.7rem] text-muted-color`" />{{ chip.label }}
                  </span>
                </div>
                <div
                  v-for="warning in resolve(row).warnings"
                  :key="warning"
                  class="mt-1 text-xs text-orange-600 dark:text-orange-400"
                >
                  {{ warning }}
                </div>
              </td>
              <td class="py-2">
                <div class="flex items-center gap-2">
                  <i
                    v-if="row.status === 'running'"
                    class="pi pi-spin pi-spinner text-primary"
                  />
                  <Tag
                    v-else-if="row.status === 'done'"
                    value="Imported"
                    icon="pi pi-check"
                    severity="success"
                  />
                  <Tag
                    v-else-if="row.status === 'error'"
                    value="Failed"
                    severity="danger"
                    :title="row.error"
                  />
                  <Tag
                    v-else
                    v-bind="resultTag(row)"
                  />
                </div>
                <div
                  v-if="row.status === 'error'"
                  class="mt-1 text-xs text-red-500"
                >
                  {{ row.error }}
                </div>
                <div
                  v-for="note in resolve(row).notes"
                  v-else-if="row.include && row.status === 'idle'"
                  :key="note"
                  class="mt-1 text-xs text-muted-color"
                >
                  {{ note }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Message
        v-if="skipped.length > 0"
        severity="secondary"
        size="small"
        icon="pi pi-info-circle"
      >
        <div class="flex flex-col gap-0.5">
          <span>{{ skipped.length }} {{ skipped.length === 1 ? "file is" : "files are" }} skipped:</span>
          <span
            v-for="entry in skipped"
            :key="entry.file.name"
          >"{{ entry.file.name }}": {{ entry.reason }}</span>
        </div>
      </Message>
    </div>
    <template #footer>
      <Button
        :label="finished ? 'Close' : 'Cancel'"
        severity="secondary"
        text
        :disabled="importing"
        @click="visible = false"
      />
      <Button
        v-if="!finished"
        :label="`Import ${includedRows.length} ${includedRows.length === 1 ? 'song' : 'songs'}`"
        icon="pi pi-upload"
        :loading="importing"
        :disabled="!canImport"
        @click="runImport"
      />
    </template>
  </Dialog>
</template>
