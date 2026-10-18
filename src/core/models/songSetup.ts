import { countReviewItems } from "./measureReview";
import type Song from "./song";

export type SetupStepId = "score" | "playback" | "measures" | "review" | "sync";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  done: boolean;
};

export type SongSetup = {
  steps: SetupStep[];
  next?: SetupStep & { action: string };
};

// Audio sync needs at least a start and an end anchor before measures line up with the recording.
const MIN_SYNC_MARKERS = 2;

// A MIDI beat map ends on a terminal bar that only marks the length of the last real bar and is
// never drawn on the score, so it does not count as a measure to place.
function getPlaceableMeasureCount(song: Song): number {
  const count = song.measures.items().length;
  return song.playerMode === "midi" ? Math.max(0, count - 1) : count;
}

function getPlacedMeasureCount(song: Song): number {
  return song.measures.items().slice(0, getPlaceableMeasureCount(song)).filter(m => m.layout).length;
}

function getMeasuresAction(song: Song): string {
  const total = getPlaceableMeasureCount(song);
  return total === 0 ? "Add measures" : `Place measures (${getPlacedMeasureCount(song)} of ${total})`;
}

function isAudioSynced(song: Song): boolean {
  return song.warpMarkers.length >= MIN_SYNC_MARKERS;
}

/**
 * Until an audio song is synced, the measure highlighted on the score follows a guessed tempo and
 * drifts away from the recording.
 */
export function hasUnsyncedAudio(song: Song): boolean {
  return song.playerMode === "audio" && getPlacedMeasureCount(song) > 0 && !isAudioSynced(song);
}

function getReviewCount(song: Song): number {
  return countReviewItems(song.measures.items(), song.getUnnumberedBoxes());
}

/**
 * What still needs to happen before a song is fully usable in rehearsal, in the order an editor
 * would naturally do it. The first open step is offered as the next action.
 */
export function getSongSetup(song: Song): SongSetup {
  const placeable = getPlaceableMeasureCount(song);
  const steps: SetupStep[] = [
    { id: "score", label: "Score", done: !!song.pdfFile },
    { id: "playback", label: "Playback", done: song.playerMode !== "none" },
    { id: "measures", label: "Measures on score", done: placeable > 0 && getPlacedMeasureCount(song) === placeable },
  ];

  // Only detection leaves boxes to check, so songs set up by hand never see this step.
  const reviewCount = getReviewCount(song);
  if (reviewCount > 0) {
    steps.push({ id: "review", label: "Detected measures checked", done: false });
  }

  if (song.playerMode === "audio") {
    steps.push({ id: "sync", label: "Audio sync", done: isAudioSynced(song) });
  }

  const actions: Record<SetupStepId, string> = {
    score: "Add score",
    playback: "Add playback",
    measures: getMeasuresAction(song),
    review: `Check measures (${reviewCount} left)`,
    sync: "Sync audio",
  };

  const nextStep = steps.find(step => !step.done);
  const next = nextStep && { ...nextStep, action: actions[nextStep.id] };

  return { steps, next };
}

export function isFileStep(id: SetupStepId): boolean {
  return id === "score" || id === "playback";
}
