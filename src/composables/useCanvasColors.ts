import { useMutationObserver } from "@vueuse/core";
import { onScopeDispose } from "vue";

export type CanvasColors = {
  /** Resolves a CSS color, e.g. "var(--p-primary-color)", to a plain rgb() value. */
  resolve: (cssColor: string) => string;
};

/**
 * Canvases cannot parse var() references or color-mix() expressions, so theme colors go through a
 * hidden probe element whose computed color is always plain rgb(). The theme switches by a class on
 * the root element, after which onThemeChange has to redraw with freshly resolved colors.
 */
export function useCanvasColors(onThemeChange: () => void): CanvasColors {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.appendChild(probe);
  onScopeDispose(() => probe.remove());

  useMutationObserver(document.documentElement, onThemeChange, { attributes: true, attributeFilter: ["class"] });

  function resolve(cssColor: string): string {
    probe.style.color = cssColor;
    return getComputedStyle(probe).color;
  }

  return { resolve };
}
