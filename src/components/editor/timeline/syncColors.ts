/**
 * Sync points look the same everywhere (score pins, waveform lines). The colors themselves are
 * theme tokens in main.css.
 */
export const SYNC_POINT_COLORS = {
  /** Theme variable of the point, for canvases. */
  variable: "--color-sync",
  /** Tailwind class for a pin on the score page. */
  onScore: "text-score-sync",
} as const;
