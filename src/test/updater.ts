import { type UpdateCallback, Updater } from "../core/utils/updater";

const STEP_DURATION = 1 / 50;

export class ManualUpdater extends Updater {
  private _mockTime = 0;

  constructor(callback: UpdateCallback) {
    super(callback, {
      interval: STEP_DURATION,
      maximumLag: 1000,
      timeProvider: () => this._mockTime,
    });
  }

  protected _startImpl(): void {}
  protected _stopImpl(): void {}
  protected _updateCompleteImpl(): void {}

  step(delta: number): void {
    if (!this.running) {
      return;
    }

    this._mockTime += delta;
    this._update();
  }
}
