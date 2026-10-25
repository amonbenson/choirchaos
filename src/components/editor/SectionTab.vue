<script setup lang="ts">
import Button from "primevue/button";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import { useConfirm } from "primevue/useconfirm";
import { computed, ref, useId, useTemplateRef } from "vue";

import { useNotify } from "@/composables/useNotify";
import type { Location, TimelineEntry } from "@/core/models/recording";
import { createSection, type Section, type SectionKind, validateSections } from "@/core/models/sections";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import SectionRow, { describeSection, SECTION_KIND_NAMES } from "./SectionRow.vue";

const props = defineProps<{
  song: Song | undefined;
}>();

const player = usePlayerStore();
const settings = useSettingsStore();
const confirm = useConfirm();
const { notifyError } = useNotify();

const headingId = useId();
const addMenu = useTemplateRef<InstanceType<typeof Menu>>("addMenu");

const sections = computed(() => props.song?.getSections() ?? []);
const hasMeasures = computed(() => (props.song?.getTimeline().length ?? 0) > 0);
const addedSection = ref<Section>();

const addMenuItems = computed<MenuItem[]>(() => (["vamp", "repeat", "cut"] as const).map(kind => ({
  label: SECTION_KIND_NAMES[kind],
  command: () => addSection(kind),
})));

// Rows keep their identity while a section is edited, so the focus stays in the edited field.
const sectionKeys = new WeakMap<Section, number>();
let nextSectionKey = 0;

function getSectionKey(section: Section): number {
  if (!sectionKeys.has(section)) {
    sectionKeys.set(section, nextSectionKey++);
  }

  return sectionKeys.get(section)!;
}

function isSectionActive(index: number): boolean {
  return player.currentSection?.section === index;
}

function getLastBeat(song: Song, entry: TimelineEntry): Location {
  return { measure: entry.measure, occurrence: entry.occurrence, beat: (song.findMeasure(entry.measure)?.beats ?? 1) - 1 };
}

function createSectionAt(song: Song, kind: SectionKind, position: number): Section | undefined {
  const timeline = song.getTimeline();
  const first = timeline[position]!;
  const last = timeline[position + 1] ?? first;
  const section = createSection(kind, { measure: first.measure, occurrence: first.occurrence, beat: 0 }, getLastBeat(song, last));
  const issues = validateSections(song.getMeasures(), timeline, [...song.getSections(), section]);
  return issues.length === 0 ? section : undefined;
}

// A new section covers two measures from where playback is, or the next free place after it.
function findNewSection(song: Song, kind: SectionKind): Section | undefined {
  const count = song.getTimeline().length;
  const current = player.currentLocation;
  const start = current && song.findMeasure(current.measure) ? current.position : 0;

  for (let offset = 0; offset < count; offset++) {
    const section = createSectionAt(song, kind, (start + offset) % count);
    if (section) {
      return section;
    }
  }

  return undefined;
}

function openAddMenu(event: MouseEvent): void {
  addMenu.value?.toggle(event);
}

async function addSection(kind: SectionKind): Promise<void> {
  const song = props.song;
  if (!song || !hasMeasures.value) {
    return;
  }

  const section = findNewSection(song, kind);
  if (!section) {
    notifyError("Could not add the section", new Error("Every measure already belongs to a section."));
    return;
  }

  try {
    await song.addSection(section);
    addedSection.value = section;
    player.syncWarp();
  } catch (error) {
    notifyError("Could not add the section", error);
  }
}

async function updateSection(previous: Section, section: Section): Promise<void> {
  const song = props.song;
  const index = sections.value.indexOf(previous);
  if (!song || index === -1) {
    return;
  }

  sectionKeys.set(section, getSectionKey(previous));
  try {
    await song.updateSection(index, section);
    player.syncWarp();
  } catch (error) {
    notifyError("Could not save the section", error);
  }
}

function removeSection(section: Section): void {
  const song = props.song;
  if (!song) {
    return;
  }

  const description = describeSection(song, section);
  confirm.require({
    header: "Delete section",
    message: `${description} will be deleted. Playback then follows the recording there.`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Delete section", severity: "danger" },
    accept: async () => {
      const index = sections.value.indexOf(section);
      if (index === -1) {
        return;
      }

      try {
        await song.removeSection(index);
        player.syncWarp();
      } catch (error) {
        notifyError("Could not delete the section", error);
      }
    },
  });
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-4">
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <template v-if="song && sections.length > 0">
        <h2
          :id="headingId"
          class="sr-only"
        >
          Sections
        </h2>
        <ul
          class="flex flex-col gap-4"
          :aria-labelledby="headingId"
        >
          <li
            v-for="(section, index) in sections"
            :key="getSectionKey(section)"
          >
            <SectionRow
              :song="song"
              :section="section"
              :index="index"
              :active="isSectionActive(index)"
              :autofocus="section === addedSection"
              @update="updated => updateSection(section, updated)"
              @remove="removeSection(section)"
            />
          </li>
        </ul>
      </template>
      <span
        v-else-if="hasMeasures"
        class="text-sm text-muted-color"
      >Sections cut, repeat or vamp a range of measures, so the rehearsal can differ from the recording.</span>
      <div
        v-else
        class="flex flex-col items-start gap-2"
      >
        <span class="text-sm text-muted-color">Sections span measures, and this song has none yet.</span>
        <Button
          label="Add measures"
          severity="secondary"
          size="small"
          @click="settings.update({ workspace: { editorTab: 'measures' } })"
        />
      </div>
    </div>

    <div
      v-if="hasMeasures"
      class="flex flex-none gap-2"
    >
      <Button
        label="Add section"
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        aria-haspopup="true"
        @click="openAddMenu"
      />
      <Menu
        ref="addMenu"
        :model="addMenuItems"
        popup
      />
    </div>
  </div>
</template>
