import { useEventListener } from "@vueuse/core";

// Returns true when focus is inside an interactive text control, so shortcuts
// don't fire while the user is typing.
function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }

  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Returns true if the keyboard event matches the shortcut string.
//
// Shortcut format: optional modifiers joined by "+", then the key name.
//   "v"                  – plain key (case-insensitive)
//   "ArrowRight"         – named key, no modifiers
//   "Mod+ArrowRight"     – Cmd on macOS, Ctrl elsewhere
//   "Shift+ArrowRight"   – shift + named key
//   "Meta+k"             – explicit Cmd key (macOS only)
//   "Ctrl+k"             – explicit Ctrl key
//
// All specified modifiers must be active; unspecified modifiers must be inactive.
function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1]!;

  const wantsMod   = parts.includes("Mod");
  const wantsMeta  = parts.includes("Meta") || (wantsMod && isMac);
  const wantsCtrl  = parts.includes("Ctrl") || (wantsMod && !isMac);
  const wantsShift = parts.includes("Shift");
  const wantsAlt   = parts.includes("Alt");

  if (e.metaKey  !== wantsMeta)  return false;
  if (e.ctrlKey  !== wantsCtrl)  return false;
  if (e.shiftKey !== wantsShift) return false;
  if (e.altKey   !== wantsAlt)   return false;

  // Single-character keys are matched case-insensitively.
  const normalizedKey      = key.length === 1 ? key.toLowerCase() : key;
  const normalizedEventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return normalizedEventKey === normalizedKey;
}

// Registers global keyboard shortcuts from a keymap of shortcut → action.
// preventDefault is called for every matched shortcut.
export function useGlobalShortcuts(keymap: Record<string, () => void>) {
  useEventListener(window, "keydown", (e: KeyboardEvent) => {
    if (isInputFocused()) {
      return;
    }

    for (const [shortcut, action] of Object.entries(keymap)) {
      if (matchesShortcut(e, shortcut)) {
        e.preventDefault();
        action();
        break;
      }
    }
  });
}
