import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MUSESCORE_STYLE_FILE, SCORE_ASSETS_DIR } from "../../config";
import { MPOS_UNITS_PER_INCH, type MposElement } from "./musescore";
import { PAGE_SIZE_MM, toMusicXml } from "./musicxml";
import { buildTimeline, type Timeline } from "./timeline";
import type { ScoreSpec } from "./types";

const MM_PER_INCH = 25.4;

/** Same shape as `MeasureLayout` in the app: page is 0-based, the rest are fractions of the page size. */
export type MeasureLayout = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScoreLayout = {
  hash: string;
  museScoreVersion: string;
  pageCount: number;
  measures: { number: string; layout: MeasureLayout }[];
};

export type ScoreAssets = {
  pdf: Buffer;
  layout: ScoreLayout;
};

export const SCORE_FILES = Object.freeze({
  musicXml: "score.musicxml",
  museScore: "score.mscz",
  pdf: "score.pdf",
  mpos: "score.mpos",
  layout: "layout.json",
});

export function scoreAssetDir(specId: string): string {
  return join(SCORE_ASSETS_DIR, specId);
}

export function computeScoreHash(musicXml: string): string {
  return createHash("sha256")
    .update(musicXml)
    .update(readFileSync(MUSESCORE_STYLE_FILE))
    .digest("hex");
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export function toScoreLayout(timeline: Timeline, elements: MposElement[], hash: string, museScoreVersion: string): ScoreLayout {
  if (elements.length !== timeline.measures.length) {
    throw new Error(`MuseScore reported ${elements.length} measure positions, but the score has ${timeline.measures.length} bars.`);
  }

  const pageWidthUnits = (PAGE_SIZE_MM.width / MM_PER_INCH) * MPOS_UNITS_PER_INCH;
  const pageHeightUnits = (PAGE_SIZE_MM.height / MM_PER_INCH) * MPOS_UNITS_PER_INCH;

  const measures = timeline.measures.map((measure, index) => {
    const element = elements[index]!;
    return {
      number: measure.number,
      layout: {
        page: element.page,
        x: round(element.x / pageWidthUnits),
        y: round(element.y / pageHeightUnits),
        width: round(element.width / pageWidthUnits),
        height: round(element.height / pageHeightUnits),
      },
    };
  });

  const outOfPage = measures.find(({ layout }) => layout.x < 0 || layout.y < 0 || layout.x + layout.width > 1 || layout.y + layout.height > 1);
  if (outOfPage) {
    throw new Error(`Bar ${outOfPage.number} lies outside the page. The mpos unit conversion is probably wrong.`);
  }

  return {
    hash,
    museScoreVersion,
    pageCount: Math.max(...elements.map(element => element.page)) + 1,
    measures,
  };
}

/**
 * Loads the committed PDF and measure layout of a score preset. Throws when the spec changed
 * since the assets were generated, because the PDF would no longer match the MIDI and audio.
 */
export function loadScoreAssets(spec: ScoreSpec): ScoreAssets {
  const dir = scoreAssetDir(spec.id);
  const layoutPath = join(dir, SCORE_FILES.layout);
  const regenerateHint = `Run 'npm run e2e:scores -- ${spec.id}' (requires MuseScore 4).`;

  if (!existsSync(layoutPath)) {
    throw new Error(`No score assets for '${spec.id}'. ${regenerateHint}`);
  }

  const layout = JSON.parse(readFileSync(layoutPath, "utf8")) as ScoreLayout;
  const expectedHash = computeScoreHash(toMusicXml(buildTimeline(spec)));
  if (layout.hash !== expectedHash) {
    throw new Error(`Score assets for '${spec.id}' are stale. ${regenerateHint}`);
  }

  return { pdf: readFileSync(join(dir, SCORE_FILES.pdf)), layout };
}
