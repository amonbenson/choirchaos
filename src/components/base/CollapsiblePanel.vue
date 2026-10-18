<script setup lang="ts">
import Panel from "primevue/panel";
import { computed } from "vue";

const props = defineProps<{
  toggleLabel: string;
  toggleable?: boolean;
  headerClass?: string;
}>();

const collapsed = defineModel<boolean>("collapsed", { default: false });

const isCollapsed = computed(() => !!props.toggleable && collapsed.value);

const toggleButtonProps = computed(() => ({
  severity: "secondary",
  text: true,
  rounded: true,
  ariaLabel: `${isCollapsed.value ? "Expand" : "Collapse"} ${props.toggleLabel}`,
}));
</script>

<template>
  <Panel
    :collapsed="isCollapsed"
    :toggleable="toggleable"
    :toggle-button-props="toggleButtonProps"
    :pt:header="`flex-none gap-2 pr-1 ${headerClass ?? 'py-1'}`"
    @update:collapsed="collapsed = $event"
  >
    <template #header>
      <slot
        name="header"
        :collapsed="isCollapsed"
      />
    </template>

    <!-- Collapsible panels sit at the bottom of the screen, so they expand upwards. -->
    <template #toggleicon>
      <i :class="isCollapsed ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
    </template>

    <slot />
  </Panel>
</template>
