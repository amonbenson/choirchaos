/**
 * Sync points look the same everywhere (score pins, timeline lines). The colors themselves are
 * theme tokens in main.css.
 */
export const SYNC_POINT_COLORS = {
  /** Tailwind class for a line on the timeline. */
  line: "bg-sync",
  /** Tailwind class for the number of a synced measure on the timeline. */
  text: "text-sync",
  /** Tailwind class for a pin on the score page. */
  onScore: "text-score-sync",
} as const;
