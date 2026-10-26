<script setup lang="ts">
import InputNumber from "primevue/inputnumber";
import ToggleSwitch from "primevue/toggleswitch";
import { computed, useId } from "vue";

import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import TempoStepper from "./TempoStepper.vue";
import TranspositionStepper from "./TranspositionStepper.vue";

defineProps<{
  timeSignatureText: string;
}>();

const emit = defineEmits<{
  toggleSegue: [];
}>();

const player = usePlayerStore();
const settingsStore = useSettingsStore();
const visibleButtons = computed(() => settingsStore.current.appearance.transportButtonVisible);

const id = useId();
</script>

<template>
  <div class="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-3">
    <!-- The bar hides the beat on phones -->
    <template v-if="visibleButtons.measure && player.mode === 'midi'">
      <label
        :for="`${id}-beat`"
        class="sm:hidden"
      >Beat</label>
      <InputNumber
        :model-value="(player.currentLocation?.beat ?? 0) + 1"
        :input-id="`${id}-beat`"
        class="w-20 sm:hidden"
        :disabled="!player.ready"
        fluid
        @update:model-value="player.setBeat($event - 1)"
      />
    </template>

    <template v-if="visibleButtons.transposition">
      <span>Transposition</span>
      <TranspositionStepper />
    </template>

    <template v-if="visibleButtons.tempo">
      <span>Tempo</span>
      <TempoStepper />
    </template>

    <template v-if="visibleButtons.timeSignature">
      <span>Time signature</span>
      <span>{{ timeSignatureText }}</span>
    </template>

    <template v-if="visibleButtons.segue">
      <label :for="`${id}-segue`">Segue</label>
      <ToggleSwitch
        :model-value="!!player.currentSegue?.enabled"
        :input-id="`${id}-segue`"
        :disabled="player.currentSegue === undefined"
        @update:model-value="emit('toggleSegue')"
      />
    </template>
  </div>
</template>
