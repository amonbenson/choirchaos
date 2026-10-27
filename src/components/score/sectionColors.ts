import type { SectionKind } from "@/core/models/sections";

export type SectionColor = {
  /** Tailwind class for a fill in the kind's color. */
  background: string;
  /** Tailwind class for a border in the kind's color. */
  border: string;
  /** Tailwind class for an outline in the kind's color. */
  outline: string;
  /** The theme variable, for inline styles and canvases. */
  variable: string;
};

/** The only place that names section colors. Tailwind needs the full class names written out here. */
export const SECTION_COLORS: Record<SectionKind, SectionColor> = {
  repeat: { background: "bg-section-repeat", border: "border-section-repeat", outline: "outline-section-repeat", variable: "--color-section-repeat" },
  vamp: { background: "bg-section-vamp", border: "border-section-vamp", outline: "outline-section-vamp", variable: "--color-section-vamp" },
  cut: { background: "bg-section-cut", border: "border-section-cut", outline: "outline-section-cut", variable: "--color-section-cut" },
};

/** Text and icons drawn on a section color. */
export const SECTION_CONTRAST_TEXT = "text-section-contrast";
