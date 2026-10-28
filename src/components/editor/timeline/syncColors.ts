/** Sync points look the same everywhere on the timeline. The colors themselves are theme tokens in main.css. */
export const SYNC_POINT_COLORS = {
  /** Tailwind class for a line on the timeline. */
  line: "bg-sync",
  /** Tailwind class for the number of a synced measure on the timeline. */
  text: "text-sync-text",
} as const;
