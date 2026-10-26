<script setup lang="ts">
import { computed, useId } from "vue";

import { useSettingsStore } from "@/stores/settings";
import type { InspectorGroupId } from "@/stores/settings/workspace";

const props = defineProps<{
  id: InspectorGroupId;
  title: string;
  /** What the group holds, shown next to the title so a collapsed group still tells it. */
  summary?: string;
  /** Keeps the group open while it holds what the user works on, e.g. the box being reviewed. */
  forceOpen?: boolean;
}>();

const settings = useSettingsStore();
const titleId = useId();
const contentId = useId();

const expanded = computed(() => props.forceOpen || !settings.current.workspace.inspectorCollapsed[props.id]);

function toggle(): void {
  settings.update({ workspace: { inspectorCollapsed: { [props.id]: expanded.value } } });
}
</script>

<template>
  <section class="flex flex-col border-t border-surface-200 py-3 dark:border-surface-700">
    <h3 class="m-0">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-sm text-left text-xs font-semibold tracking-wide text-muted-color uppercase focus-visible:outline-2 focus-visible:outline-primary"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        @click="toggle"
      >
        <i
          class="pi text-[0.625rem]"
          :class="expanded ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span :id="titleId">{{ title }}</span>
        <span
          v-if="summary"
          class="ml-auto min-w-0 truncate font-normal tracking-normal normal-case"
        >{{ summary }}</span>
      </button>
    </h3>
    <!-- The content stays mounted while collapsed, so keyboard actions on the score still reach its forms. -->
    <div
      v-show="expanded"
      :id="contentId"
      role="region"
      :aria-labelledby="titleId"
      class="mt-3 flex flex-col gap-3"
    >
      <slot />
    </div>
  </section>
</template>
