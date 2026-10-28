import type { SectionKind } from "@/core/models/sections";

export type SectionColor = {
  /** Tailwind classes for a styling kind's color (bg and text) */
  background: string;
  /** The theme variable, for inline styles and canvases. */
  variable: string;
};

/** The only place that names section colors. Tailwind needs the full class names written out here. */
export const SECTION_COLORS: Record<SectionKind, SectionColor> = {
  repeat: { background: "bg-section-repeat", variable: "--color-section-repeat" },
  vamp: { background: "bg-section-vamp", variable: "--color-section-vamp" },
  cut: { background: "bg-section-cut", variable: "--color-section-cut" },
};

/** Text and icons drawn on a section color. */
export const SECTION_CONTRAST_TEXT = "text-section-contrast";

/** Markers have one color of their own. */
export const MARKER_COLORS = {
  background: "bg-marker",
  /** Text and icons drawn on the marker color. */
  contrast: "text-marker-contrast",
};
