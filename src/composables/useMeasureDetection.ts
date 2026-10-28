import { computed, type ComputedRef, type Ref, ref, shallowRef, watch } from "vue";

import { type DetectedMeasure, type MeasureDetectionPlan, planMeasureDetection } from "@/core/models/measureDetection";
import type Song from "@/core/models/song";
import { detectMeasures, type MeasureDetectionProgress } from "@/core/pdf/measureDetector";
import { resolveUrl } from "@/core/utils/file";

export type MeasureDetection = {
  progress: Ref<MeasureDetectionProgress | undefined>;
  detected: Ref<DetectedMeasure[] | undefined>;
  replacePlaced: Ref<boolean>;
  createMissing: Ref<boolean>;
  beats: Ref<number>;
  running: ComputedRef<boolean>;
  canCreateMeasures: ComputedRef<boolean>;
  plan: ComputedRef<MeasureDetectionPlan | undefined>;
  start: () => Promise<void>;
  discard: () => void;
};

/**
 * One detection run of the song editor. Its plan is previewed on the score and in the Measures
 * panel until it is applied or discarded.
 */
export function useMeasureDetection(song: Ref<Song | undefined>, onError: (error: unknown) => void): MeasureDetection {
  const progress = ref<MeasureDetectionProgress>();
  const detected = shallowRef<DetectedMeasure[]>();
  const replacePlaced = ref(false);
  const createMissing = ref(true);
  const beats = ref(4);

  // A running detection cannot be stopped, so cancelling only drops its result.
  let currentRun = 0;

  const running = computed(() => !!progress.value && !detected.value);

  // In MIDI mode the beat map defines which measures exist, so detection only places them.
  const canCreateMeasures = computed(() => song.value?.playerMode !== "midi");

  const plan = computed(() => {
    const target = song.value;
    if (!target || !detected.value) {
      return undefined;
    }

    return planMeasureDetection(target.getMeasures(), detected.value, {
      replacePlaced: replacePlaced.value,
      createMissing: canCreateMeasures.value && createMissing.value,
      beats: beats.value,
    }, target.getUnnumberedBoxes());
  });

  function discard(): void {
    currentRun++;
    progress.value = undefined;
    detected.value = undefined;
  }

  async function start(): Promise<void> {
    const target = song.value;
    if (!target?.pdfFile) {
      return;
    }

    discard();
    progress.value = { stage: "loading", done: 0, total: 1 };
    replacePlaced.value = false;
    createMissing.value = canCreateMeasures.value;

    const run = currentRun;
    const onProgress = (value: MeasureDetectionProgress): void => {
      if (run === currentRun) {
        progress.value = value;
      }
    };

    try {
      const result = await detectMeasures(resolveUrl(target.pdfFile, "songs", target.id), onProgress);
      if (run === currentRun) {
        detected.value = result;
      }
    } catch (error) {
      if (run === currentRun) {
        progress.value = undefined;
        onError(error);
      }
    }
  }

  watch(song, discard);

  return { progress, detected, replacePlaced, createMissing, beats, running, canCreateMeasures, plan, start, discard };
}
