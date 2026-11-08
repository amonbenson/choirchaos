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

const TOAST_SEVERITY_PALETTES = { info: "sky", success: "green", warn: "orange", error: "red" };

/**
 * Aura tints toasts translucently, so the page and colored buttons inside a toast clash with the tint.
 * Toasts here are opaque popovers that show their severity in the border, icon and summary only.
 */
function toastColorScheme(textShade: number): Record<string, unknown> {
  const severities = Object.entries(TOAST_SEVERITY_PALETTES).map(([severity, name]) => [severity, {
    background: "{overlay.popover.background}",
    borderColor: `{${name}.400}`,
    color: `{${name}.${textShade}}`,
    detailColor: "{text.color}",
    shadow: "{overlay.popover.shadow}",
    closeButton: { hoverBackground: "{content.hover.background}", focusRing: { color: `{${name}.${textShade}}` } },
  }]);
  return { root: { blur: "0" }, ...Object.fromEntries(severities) };
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
    components: {
      toast: { colorScheme: { light: toastColorScheme(600), dark: toastColorScheme(400) } },
    },
  });
}
