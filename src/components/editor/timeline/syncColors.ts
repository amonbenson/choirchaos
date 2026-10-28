/**
 * Sync points look the same everywhere (score pins, waveform, timeline). The colors themselves are
 * theme tokens in main.css.
 */
export const SYNC_POINT_COLORS = {
  /** Theme variable of the point, for canvases. */
  variable: "--color-sync",
  /** Theme variable of text on the point, for canvases. */
  contrastVariable: "--color-sync-contrast",
  /** Tailwind class for a pin on the score page. */
  onScore: "text-score-sync",
} as const;
