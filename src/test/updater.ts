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
