<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import { computed, ref, watch } from "vue";

import CollapsiblePanel from "@/components/base/CollapsiblePanel.vue";
import MeasureTab from "@/components/editor/measures/MeasureTab.vue";
import SongDetailsForm from "@/components/song/SongDetailsForm.vue";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import type Show from "@/core/models/show";
import type Song from "@/core/models/song";
import { useSettingsStore } from "@/stores/settings";
import type { EditorTab } from "@/stores/settings/workspace";

import MarkerTab from "./MarkerTab.vue";

defineProps<{
  show: Show | undefined;
  song: Song | undefined;
}>();

const emit = defineEmits<{
  saved: [song: Song, details: { created: boolean; playbackChanged: boolean }];
  deleted: [song: Song];
}>();

const TABS: { value: EditorTab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "markers", label: "Markers" },
  { value: "measures", label: "Measures" },
];

const settings = useSettingsStore();
const { selectionCount, pendingBox, tool, detection } = injectMeasureEditor();

// Below lg the panel is a bottom sheet over the score, which stays out of the way until needed.
const isSheet = useBreakpoints(breakpointsTailwind).smaller("lg");
const collapsed = ref(true);
const isContentHidden = computed(() => isSheet.value && collapsed.value);

const tab = computed<EditorTab>(() => {
  const stored = settings.current.workspace.editorTab;
  return TABS.some(({ value }) => value === stored) ? stored : "details";
});

function selectTab(value: string | number): void {
  settings.update({ workspace: { editorTab: value as EditorTab } });
}

// Other places switch the tab to point at a step, which only helps when the content is visible.
watch(tab, () => {
  collapsed.value = false;
});

const isWorkingOnMeasures = computed(() => selectionCount.value > 0 || !!pendingBox.value || tool.value === "draw" || !!detection.progress.value);

watch(isWorkingOnMeasures, (working) => {
  if (!working) {
    return;
  }

  selectTab("measures");
  collapsed.value = false;
});
</script>

<template>
  <Tabs
    :value="tab"
    class="flex flex-col"
    @update:value="selectTab"
  >
    <CollapsiblePanel
      v-model:collapsed="collapsed"
      :toggleable="isSheet"
      toggle-label="editor panel"
      :header-class="isContentHidden ? 'py-0 pl-0' : 'py-0 pl-0 border-b border-(--p-tabs-tablist-border-color)'"
      pt:root="flex min-h-0 flex-1 flex-col overflow-hidden max-lg:shadow-lg"
      pt:content-container="flex-1 min-h-0"
      pt:content-wrapper="flex min-h-0 flex-col"
      pt:content="flex min-h-0 flex-1 flex-col p-0"
    >
      <template #header>
        <TabList
          class="min-w-0 flex-1"
          pt:tab-list="border-none"
          @click="collapsed = false"
        >
          <Tab
            v-for="{ value, label } in TABS"
            :key="value"
            :value="value"
            class="flex-1 px-3 py-3 text-sm lg:flex-none lg:px-4"
          >
            {{ label }}
          </Tab>
        </TabList>
      </template>

      <TabPanels class="flex min-h-0 flex-1 flex-col p-4">
        <TabPanel
          value="details"
          class="flex min-h-0 flex-1 flex-col"
        >
          <SongDetailsForm
            v-if="show && song"
            class="flex-1"
            :show="show"
            :song="song"
            @saved="(saved, details) => emit('saved', saved, details)"
            @deleted="emit('deleted', $event)"
          />
        </TabPanel>
        <TabPanel
          value="markers"
          class="flex min-h-0 flex-1 flex-col"
        >
          <MarkerTab
            class="flex-1"
            :song="song"
          />
        </TabPanel>
        <TabPanel
          value="measures"
          class="flex min-h-0 flex-1 flex-col"
        >
          <MeasureTab
            class="flex-1"
            :song="song"
          />
        </TabPanel>
      </TabPanels>
    </CollapsiblePanel>
  </Tabs>
</template>
