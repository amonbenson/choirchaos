import type PlayerEngine from "../core/player/engine";
import { type UpdateCallback, Updater } from "../core/utils/updater";

const STEP_DURATION = 1 / 50;

export class ManualUpdater extends Updater {
  private mockTime = 0;

  constructor(callback: UpdateCallback) {
    super(callback, {
      interval: STEP_DURATION,
      maximumLag: 1000,
      timeProvider: () => this.mockTime,
    });
  }

  protected startImpl(): void {}
  protected stopImpl(): void {}
  protected updateCompleteImpl(): void {}

  step(delta: number): void {
    if (!this.isRunning()) {
      return;
    }

    this.mockTime += delta;
    this.update();
  }
}

const MAX_STEPS = 10_000;

export function stepUntil(updater: ManualUpdater, isDone: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !isDone() && updater.isRunning(); i++) {
    updater.step(STEP_DURATION);
  }
}

// End-of-song and segue fire one step after the overshoot, so one extra step flushes them.
export function stepPast(updater: ManualUpdater, player: PlayerEngine, targetTick: number): void {
  stepUntil(updater, () => player.getPosition() > targetTick);
  updater.step(STEP_DURATION);
}
