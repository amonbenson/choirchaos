import { type Disposable, Property } from "../utils/events";
import { isSameSnapshot, type LayerSnapshot } from "./layers";
import type Song from "./song";
import type { LayersChange } from "./song";

/** Older changes are forgotten, so a long session keeps a bounded number of snapshots. */
export const MAX_HISTORY_LENGTH = 100;

export type HistoryState = { canUndo: boolean; canRedo: boolean };

type HistoryEntry = { before: LayerSnapshot; after: LayerSnapshot };

/** Undo or redo would overwrite a change that did not go through this history. */
export class HistoryConflictError extends Error {}

/**
 * Undo and redo of the song's score, recording and arrangement for one editing session. Every saved layer
 * change becomes an entry, and undo and redo write the snapshot back through the same mutation path.
 * Files, details and tracks are not covered.
 */
export default class SongHistory {
  private readonly undoEntries: HistoryEntry[] = [];
  private readonly redoEntries: HistoryEntry[] = [];
  private readonly state = new Property<HistoryState>({ canUndo: false, canRedo: false });
  private readonly subscription: Disposable;
  private busy = false;

  readonly onStateChange = this.state.onChange;

  constructor(private readonly song: Song) {
    this.subscription = song.onLayersChange(change => this.record(change));
  }

  getState(): HistoryState {
    return this.state.get();
  }

  dispose(): void {
    this.subscription.dispose();
    this.clear();
  }

  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.publish();
  }

  /** Restores the layers before the last change. Throws, and keeps the history, when the save fails. */
  async undo(): Promise<void> {
    await this.step(this.undoEntries, this.redoEntries, entry => ({ expected: entry.after, target: entry.before }));
  }

  /** Restores the layers after the last undone change. */
  async redo(): Promise<void> {
    await this.step(this.redoEntries, this.undoEntries, entry => ({ expected: entry.before, target: entry.after }));
  }

  private record(change: LayersChange): void {
    if (change.origin === "history") {
      return;
    }

    this.undoEntries.push({ before: change.before, after: change.after });
    this.undoEntries.splice(0, Math.max(0, this.undoEntries.length - MAX_HISTORY_LENGTH));
    this.redoEntries.length = 0;
    this.publish();
  }

  private async step(from: HistoryEntry[], to: HistoryEntry[], pick: (entry: HistoryEntry) => { expected: LayerSnapshot; target: LayerSnapshot }): Promise<void> {
    const entry = from.at(-1);
    if (!entry || this.busy) {
      return;
    }

    this.busy = true;
    try {
      const { expected, target } = pick(entry);
      await this.assertUnchanged(expected);
      await this.song.restoreLayers(target);
      from.pop();
      to.push(entry);
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  // A stale history would overwrite what changed in between, so it is dropped instead.
  private async assertUnchanged(expected: LayerSnapshot): Promise<void> {
    if (!isSameSnapshot(this.song.getLayerSnapshot(), expected)) {
      this.clear();
      throw new HistoryConflictError("The song changed in another way since the last edit.");
    }

    if (await this.song.isChangedElsewhere()) {
      this.clear();
      throw new HistoryConflictError("Someone else changed the song since your last edit. Reload the page to see their changes.");
    }
  }

  private publish(): void {
    const { canUndo, canRedo } = this.state.get();
    const next = { canUndo: this.undoEntries.length > 0, canRedo: this.redoEntries.length > 0 };
    if (next.canUndo !== canUndo || next.canRedo !== canRedo) {
      this.state.set(next);
    }
  }
}
