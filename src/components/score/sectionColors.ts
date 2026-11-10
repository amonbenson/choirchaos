import type { SectionKind } from "@/core/models/sections";

export type SectionColor = {
  /** Tailwind classes for a styling kind's color (bg and text) */
  background: string;
  /** Tailwind class for an outline in the kind's color. */
  border: string;
  /** Tailwind class for text in the kind's color, readable on the page background. */
  text: string;
  /** The theme variable, for inline styles and canvases. */
  variable: string;
};

/** The only place that names section colors. Tailwind needs the full class names written out here. */
export const SECTION_COLORS: Record<SectionKind, SectionColor> = {
  repeat: { background: "bg-section-repeat", border: "border-section-repeat", text: "text-section-repeat-text", variable: "--color-section-repeat" },
  vamp: { background: "bg-section-vamp", border: "border-section-vamp", text: "text-section-vamp-text", variable: "--color-section-vamp" },
  cut: { background: "bg-section-cut", border: "border-section-cut", text: "text-section-cut-text", variable: "--color-section-cut" },
  caesura: { background: "bg-section-caesura", border: "border-section-caesura", text: "text-section-caesura-text", variable: "--color-section-caesura" },
};

/** Text and icons drawn on a section color. */
export const SECTION_CONTRAST_TEXT = "text-section-contrast";

/** Markers have one color of their own. */
export const MARKER_COLORS = {
  background: "bg-marker",
  /** Text and icons drawn on the marker color. */
  contrast: "text-marker-contrast",
  border: "border-marker",
  /** Text and icons in the marker color, readable on the page background. */
  text: "text-marker-text",
};
