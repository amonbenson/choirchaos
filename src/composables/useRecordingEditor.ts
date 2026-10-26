import { useConfirm } from "primevue/useconfirm";
import { type Ref, ref } from "vue";

import { formatOccurrence } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { formatSectionName } from "@/core/models/measureSelection";
import type { RecordingSpan } from "@/core/models/recording";
import type Song from "@/core/models/song";
import type { DroppedReferences, RecordingPreview } from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

import { useNotify } from "./useNotify";

function formatMeasureCount(count: number): string {
  return count === 1 ? "1 measure" : `${count} measures`;
}

/** "The recording will play 37 measures instead of 33." */
export function describeLength(song: Song, preview: RecordingPreview): string {
  const before = song.getTimeline().length;
  return preview.length === before
    ? `The recording keeps playing ${formatMeasureCount(before)}.`
    : `The recording will play ${formatMeasureCount(preview.length)} instead of ${before}.`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The references a change would remove, named with the song as it is before the change, e.g. "the sync point at 20, 4th time". */
export function describeDropped(song: Song, dropped: DroppedReferences): string[] {
  const label = (id: MeasureId): string => song.findMeasure(id)?.label ?? "?";
  return [
    ...dropped.warpMarkers.map(marker => `the sync point at ${formatOccurrence(label(marker.measure), marker.occurrence)}`),
    ...dropped.markers.map(marker => `marker ${marker.text}`),
    ...dropped.sections.map(section => lowerFirst(formatSectionName(song.getMeasures(), section))),
  ];
}

function isSameRecording(a: readonly RecordingSpan[], b: readonly RecordingSpan[]): boolean {
  return a.length === b.length && a.every((span, i) => span.from === b[i]!.from && span.to === b[i]!.to);
}

export type RecordingEditor = {
  saving: Ref<boolean>;
  /** What the last saved change did, for a status line. */
  status: Ref<string>;
  /** Previews new spans, asks before removing references, saves and reloads the player. False when nothing was saved. */
  setSpans: (spans: readonly RecordingSpan[]) => Promise<boolean>;
  playDuplicatesAsRepeat: (duplicates: readonly MeasureId[], originals: readonly MeasureId[]) => Promise<boolean>;
};

/**
 * Saves recording changes the same way from every place that offers one. A change that would remove
 * sync points, markers or sections is only saved once the user confirms it.
 */
export function useRecordingEditor(getSong: () => Song): RecordingEditor {
  const confirm = useConfirm();
  const player = usePlayerStore();
  const { notifyError } = useNotify();
  const saving = ref(false);
  const status = ref("");

  function confirmDropped(song: Song, preview: RecordingPreview): Promise<boolean> {
    const dropped = describeDropped(song, preview.dropped);
    if (dropped.length === 0) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      confirm.require({
        header: "Change the recording",
        message: `${describeLength(song, preview)} The new recording no longer plays some places that are referenced, so this removes ${dropped.join(", ")}.`,
        icon: "pi pi-exclamation-triangle",
        rejectProps: { label: "Cancel", severity: "secondary", text: true },
        acceptProps: { label: "Change recording", severity: "danger" },
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      });
    });
  }

  // The timeline changed, so the player needs it again. The playhead stays at the same time.
  async function reloadPlayer(song: Song): Promise<void> {
    const position = player.position;
    await player.load(song);
    player.seek(position);
  }

  async function commit(song: Song, preview: () => RecordingPreview, save: () => Promise<void>, failure: string): Promise<boolean> {
    let planned: RecordingPreview;
    try {
      planned = preview();
    } catch (error) {
      notifyError(failure, error);
      return false;
    }

    if (!await confirmDropped(song, planned)) {
      return false;
    }

    saving.value = true;
    try {
      await save();
      status.value = `The recording now plays ${formatMeasureCount(planned.length)}.`;
      await reloadPlayer(song);
      return true;
    } catch (error) {
      notifyError(failure, error);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function setSpans(spans: readonly RecordingSpan[]): Promise<boolean> {
    const song = getSong();
    if (isSameRecording(spans, song.getRecording())) {
      return true;
    }

    return commit(song, () => song.previewRecordingSpans(spans), () => song.setRecordingSpans(spans), "Could not change the recording");
  }

  async function playDuplicatesAsRepeat(duplicates: readonly MeasureId[], originals: readonly MeasureId[]): Promise<boolean> {
    const song = getSong();
    return commit(
      song,
      () => song.previewDuplicatesAsRepeat(duplicates, originals),
      () => song.playDuplicatesAsRepeat(duplicates, originals),
      "Could not play the measures as a repeat",
    );
  }

  return { saving, status, setSpans, playDuplicatesAsRepeat };
}
