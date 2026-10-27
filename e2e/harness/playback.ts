import { expect, type Page } from "@playwright/test";

/** What the player shows at one moment: the header's measure and section, the position and the highlighted box. */
export type PlaybackSample = {
  measure: string | undefined;
  /** The header's section button, e.g. "Vamp 2" or "Repeat 1/3". Plain "Vamp" while no section plays. */
  section: string;
  /** Recording milliseconds in audio mode, MIDI ticks in MIDI mode. */
  position: number;
  /** Label of the box marked as the current location, if the song has a score. */
  box: string | undefined;
};

const CURRENT_MEASURE = /^Current measure/;
const SECTION_BUTTON = /^(Vamp|Repeat|Exiting)( \d+(\/\d+)?)?$/;
const SAMPLE_INTERVAL_MS = 50;

export async function waitForPlayer(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Play / Pause" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: CURRENT_MEASURE })).toBeEnabled({ timeout: 30_000 });
}

/**
 * Reads every field in one evaluation, so a sample never mixes two moments of playback. The player updates
 * them together, but separate reads can straddle a pass boundary under load.
 */
export async function readPlayback(page: Page): Promise<PlaybackSample> {
  const raw = await page.evaluate(({ currentMeasure, sectionButton }) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const measure = buttons.find(button => new RegExp(currentMeasure).test(button.getAttribute("aria-label") ?? ""));
    const section = buttons.find(button => new RegExp(sectionButton).test(button.textContent?.trim() ?? ""));
    return {
      measure: measure?.getAttribute("aria-label") ?? undefined,
      section: section?.textContent?.trim() ?? "",
      position: document.querySelector("[role='slider'][aria-label='Position']")?.getAttribute("aria-valuenow"),
      box: document.querySelector("[aria-current='location'][aria-label^='Measure ']")?.getAttribute("aria-label") ?? undefined,
    };
  }, { currentMeasure: CURRENT_MEASURE.source, sectionButton: SECTION_BUTTON.source });

  return {
    measure: raw.measure?.replace(CURRENT_MEASURE, "").trim() || undefined,
    section: raw.section,
    position: Number(raw.position),
    box: raw.box?.replace(/^Measure /, ""),
  };
}

/**
 * Samples the player until `isDone` accepts a sample. Bars of the generated songs last a second or
 * more, so sampling every few tens of milliseconds sees every bar and every pass.
 */
export async function recordPlayback(page: Page, isDone: (sample: PlaybackSample) => boolean, timeoutMs = 45_000): Promise<PlaybackSample[]> {
  const samples: PlaybackSample[] = [];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const sample = await readPlayback(page);
    samples.push(sample);
    if (isDone(sample)) {
      return samples;
    }

    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }

  throw new Error(`Playback did not reach the expected state within ${timeoutMs} ms. Last samples: ${JSON.stringify(samples.slice(-5))}`);
}

/** The values of one sample field with consecutive repetitions collapsed, e.g. the measures in playing order. */
export function sequenceOf<K extends keyof PlaybackSample>(samples: PlaybackSample[], key: K): PlaybackSample[K][] {
  return samples.map(sample => sample[key]).filter((value, i, values) => i === 0 || value !== values[i - 1]);
}
