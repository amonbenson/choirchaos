import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MUSESCORE_STYLE_FILE } from "../config";
import { computeScoreHash, SCORE_FILES, scoreAssetDir, toScoreLayout } from "../generators/score/assets";
import { convertWithMuseScore, findMuseScore, getMuseScoreVersion, parseMpos } from "../generators/score/musescore";
import { toMusicXml } from "../generators/score/musicxml";
import { findScorePreset, SCORE_PRESETS } from "../generators/score/presets";
import { buildTimeline } from "../generators/score/timeline";
import type { ScoreSpec } from "../generators/score/types";

async function generate(spec: ScoreSpec, executable: string, museScoreVersion: string): Promise<void> {
  const dir = scoreAssetDir(spec.id);
  mkdirSync(dir, { recursive: true });

  const timeline = buildTimeline(spec);
  const musicXml = toMusicXml(timeline);
  const musicXmlPath = join(dir, SCORE_FILES.musicXml);
  const mposPath = join(dir, SCORE_FILES.mpos);
  writeFileSync(musicXmlPath, musicXml);

  await convertWithMuseScore({
    executable,
    input: musicXmlPath,
    outputs: [join(dir, SCORE_FILES.museScore), join(dir, SCORE_FILES.pdf), mposPath],
    styleFile: MUSESCORE_STYLE_FILE,
  });

  const layout = toScoreLayout(timeline, parseMpos(readFileSync(mposPath, "utf8")), computeScoreHash(musicXml), museScoreVersion);
  rmSync(mposPath);
  writeFileSync(join(dir, SCORE_FILES.layout), `${JSON.stringify(layout, null, 2)}\n`);

  console.log(`${spec.id}: ${timeline.measures.length} bars on ${layout.pageCount} page(s) -> ${dir}`);
}

const requestedIds = process.argv.slice(2);
const specs = requestedIds.length > 0 ? requestedIds.map(findScorePreset) : SCORE_PRESETS;
const executable = await findMuseScore();
const museScoreVersion = await getMuseScoreVersion(executable);
console.log(`Using ${museScoreVersion} (${executable})`);

for (const spec of specs) {
  await generate(spec, executable, museScoreVersion);
}
