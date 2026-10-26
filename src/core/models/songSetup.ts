import type Measure from "./measure";
import { countReviewItems } from "./measureReview";
import { findUnplayedMeasures } from "./recording";
import type Song from "./song";

export type SetupStepId = "score" | "playback" | "measures" | "review" | "sync";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  done: boolean;
};

/** Something worth a look that does not keep the song from being ready. */
export type SetupHint = {
  id: "unplayed";
  label: string;
  measures: Measure[];
};

export type SongSetup = {
  steps: SetupStep[];
  next?: SetupStep & { action: string };
  hints: SetupHint[];
};

// Audio sync needs at least a start and an end anchor before measures line up with the recording.
const MIN_SYNC_MARKERS = 2;

function getPlacedMeasureCount(song: Song): number {
  return song.getMeasures().filter(measure => measure.layout).length;
}

function getMeasuresAction(song: Song): string {
  const total = song.getMeasures().length;
  return total === 0 ? "Add measures" : `Place measures (${getPlacedMeasureCount(song)} of ${total})`;
}

function isAudioSynced(song: Song): boolean {
  return song.getWarpMarkers().length >= MIN_SYNC_MARKERS;
}

/**
 * Until an audio song is synced, the measure highlighted on the score follows a guessed tempo and
 * drifts away from the recording.
 */
export function hasUnsyncedAudio(song: Song): boolean {
  return song.playerMode === "audio" && getPlacedMeasureCount(song) > 0 && !isAudioSynced(song);
}

function getReviewCount(song: Song): number {
  return countReviewItems(song.getMeasures(), song.getUnnumberedBoxes());
}

/**
 * What still needs to happen before a song is fully usable in rehearsal, in the order an editor
 * would naturally do it. The first open step is offered as the next action.
 */
export function getSongSetup(song: Song): SongSetup {
  const placeable = song.getMeasures().length;
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

  return { steps, next, hints: getHints(song) };
}

/** "8a to 8h, 12", grouping measures that follow each other in the score. */
function formatMeasureRuns(score: readonly Measure[], measures: readonly Measure[]): string {
  const runs: Measure[][] = [];
  for (const measure of measures) {
    const run = runs.at(-1);
    if (run && score.indexOf(run.at(-1)!) + 1 === score.indexOf(measure)) {
      run.push(measure);
    } else {
      runs.push([measure]);
    }
  }

  return runs.map(run => run.length > 1 ? `${run[0]!.label} to ${run.at(-1)!.label}` : run[0]!.label).join(", ");
}

function getHints(song: Song): SetupHint[] {
  const unplayed = findUnplayedMeasures(song.getMeasures(), song.getTimeline());
  if (unplayed.length === 0) {
    return [];
  }

  const noun = unplayed.length > 1 ? "measures" : "measure";
  return [{ id: "unplayed", label: `The recording never plays ${noun} ${formatMeasureRuns(song.getMeasures(), unplayed)}`, measures: unplayed }];
}

export function isFileStep(id: SetupStepId): boolean {
  return id === "score" || id === "playback";
}
