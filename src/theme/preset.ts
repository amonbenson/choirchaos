import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";
import type { PaletteDesignToken, Preset } from "@primeuix/themes/types";

/** Names of the Tailwind palettes in Aura's primitive tokens, e.g. "emerald" or "slate". */
export type ThemePalettes = {
  accent: string;
  lightSurface: string;
  darkSurface: string;
};

export const DEFAULT_PALETTES: ThemePalettes = {
  accent: "emerald",
  lightSurface: "slate",
  darkSurface: "zinc",
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

function palette(name: string): PaletteDesignToken {
  return Object.fromEntries(SHADES.map(shade => [shade, `{${name}.${shade}}`]));
}

/**
 * The only place that picks the accent and surface palettes. Tailwind's primary and surface classes
 * and every token in main.css derive from them, so another theme or a chosen accent only changes
 * the palettes passed here.
 */
export function createPreset(palettes: ThemePalettes): Preset {
  return definePreset(Aura, {
    semantic: {
      primary: palette(palettes.accent),
      colorScheme: {
        light: { surface: { 0: "#ffffff", ...palette(palettes.lightSurface) } },
        dark: { surface: { 0: "#ffffff", ...palette(palettes.darkSurface) } },
      },
    },
  });
}
