import type { ShortcutAction } from "@/composables/useGlobalShortcuts";

import { isPlainObject, SettingsBase } from "./base";

// Kept in sync with the ShortcutAction union — the `satisfies` produces a
// compile error if the two ever diverge.
const SHORTCUT_ACTIONS = [
  "playPause",
  "previousMeasure",
  "nextMeasure",
  "rewind",
  "forward",
  "toggleVamp",
  "toggleSegue",
] as const satisfies readonly ShortcutAction[];

function isShortcutAction(v: unknown): v is ShortcutAction {
  return (SHORTCUT_ACTIONS as readonly unknown[]).includes(v);
}

const DEFAULT_BINDINGS: Record<string, ShortcutAction> = {
  " ": "playPause",
  "ArrowLeft": "previousMeasure",
  "ArrowRight": "nextMeasure",
  "Mod+ArrowLeft": "rewind",
  "Mod+ArrowRight": "forward",
  "v": "toggleVamp",
  "s": "toggleSegue",
};

export class ShortcutSettings extends SettingsBase {
  constructor(
    public readonly bindings: Record<string, ShortcutAction> = DEFAULT_BINDINGS,
  ) {
    super();
  }

  // Overrides the generic fromPartial to validate each binding individually.
  // Entries mapping to unknown actions are dropped rather than failing the load.
  override fromPartial(raw: unknown): this {
    if (!isPlainObject(raw) || !isPlainObject(raw.bindings)) {
      return this;
    }

    const bindings = Object.fromEntries(
      Object.entries(raw.bindings)
        .filter((entry): entry is [string, ShortcutAction] => isShortcutAction(entry[1])),
    );
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { bindings }) as this;
  }
}
