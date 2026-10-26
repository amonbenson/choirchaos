/**
 * Sync points are orange everywhere (score pins, waveform, timeline), so they never look like the
 * primary colored playhead. Canvases read the color from an element with these classes.
 */
export const SYNC_POINT_COLORS = {
  background: "bg-orange-600 dark:bg-orange-400",
  text: "text-white dark:text-surface-950",
  foreground: "text-orange-600 dark:text-orange-400",
  // The score page stays white in dark mode.
  onScore: "text-orange-600",
} as const;
