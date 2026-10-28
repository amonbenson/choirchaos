import { formatLocation } from "./locationFormat";
import type Measure from "./measure";
import { countReviewItems } from "./measureReview";
import { findUnplayedMeasures } from "./recording";
import type Song from "./song";
import { countSyncPoints, findMeterChangesToSync, MIN_SYNC_POINTS } from "./warpEditing";

export type SetupStepId = "score" | "playback" | "measures" | "review" | "sync";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  done: boolean;
};

/** Something worth a look that does not keep the song from being ready. */
export type SetupHint = {
  id: "unplayed" | "meterChanges";
  label: string;
  /** Where the hint's control goes, a timeline position, with the control's label. */
  target?: { position: number; action: string };
};

export type SongSetup = {
  steps: SetupStep[];
  next?: SetupStep & { action: string };
  hints: SetupHint[];
};

function getPlacedMeasureCount(song: Song): number {
  return song.getMeasures().filter(measure => measure.layout).length;
}

function getMeasuresAction(song: Song): string {
  const total = song.getMeasures().length;
  return total === 0 ? "Add measures" : `Place measures (${getPlacedMeasureCount(song)} of ${total})`;
}

function isAudioSynced(song: Song): boolean {
  return countSyncPoints(song.getSyncPoints()) >= MIN_SYNC_POINTS;
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

function getUnplayedHint(song: Song): SetupHint | undefined {
  const unplayed = findUnplayedMeasures(song.getMeasures(), song.getTimeline());
  if (unplayed.length === 0) {
    return undefined;
  }

  const noun = unplayed.length > 1 ? "measures" : "measure";
  return { id: "unplayed", label: `The recording never plays ${noun} ${formatMeasureRuns(song.getMeasures(), unplayed)}` };
}

function getMeterChangesHint(song: Song): SetupHint | undefined {
  if (song.playerMode !== "audio") {
    return undefined;
  }

  const timeline = song.getTimeline();
  const [first, ...rest] = findMeterChangesToSync(timeline, song.getMeasures(), song.getSyncPoints());
  if (first === undefined) {
    return undefined;
  }

  const label = rest.length === 0
    ? "A meter change between sync points mistimes the measures around it"
    : `${rest.length + 1} meter changes between sync points mistime the measures around them`;
  return { id: "meterChanges", label, target: { position: first, action: `Go to ${formatLocation(song, timeline[first]!)}` } };
}

function getHints(song: Song): SetupHint[] {
  return [getUnplayedHint(song), getMeterChangesHint(song)].filter(hint => hint !== undefined);
}

export function isFileStep(id: SetupStepId): boolean {
  return id === "score" || id === "playback";
}
