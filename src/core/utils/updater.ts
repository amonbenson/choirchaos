type UpdateProvider = "setTimeout" | "requestAnimationFrame";
export type UpdateProviderOption = UpdateProvider | "auto";

export type UpdateCallback = (delta: number) => void;
export type TimeProvider = () => number;

export type UpdaterOptions = {
  interval: number;
  maximumLag: number;
  timeProvider: TimeProvider;
};

export abstract class Updater {
  protected readonly options: UpdaterOptions;
  private updateCallback: UpdateCallback;
  private lastUpdate: number = 0;
  private running: boolean = false;

  constructor(updateCallback: UpdateCallback, options: Partial<UpdaterOptions> = {}) {
    this.options = {
      interval: 1 / 50,
      maximumLag: 1.5,
      timeProvider: () => new Date().getTime() / 1000,
    };
    Object.assign(this.options, options);
    this.updateCallback = updateCallback;
  }

  getLastUpdate(): number {
    return this.lastUpdate;
  }

  isRunning(): boolean {
    return this.running;
  }

  now(): number {
    return this.options.timeProvider();
  }

  protected update(): void {
    const now = this.now();
    let delta = now - this.lastUpdate;
    this.lastUpdate = now;

    if (delta < 0) {
      console.error("Negative delta time! Make sure your timeProvider returns monotonic increasing values!");
      delta = 0;
    } else if (delta / this.options.interval > this.options.maximumLag) {
      console.warn(`Experiencing significant lag! (Update took ${delta / this.options.interval} times longer than usual)`);
    }

    this.updateCallback(delta);
    this.updateCompleteImpl();
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.lastUpdate = this.options.timeProvider();
    this.running = true;
    this.startImpl();
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.stopImpl();
  }

  protected abstract startImpl(): void;
  protected abstract stopImpl(): void;
  protected abstract updateCompleteImpl(): void;
}

export class SetIntervalUpdater extends Updater {
  private intervalHandle?: ReturnType<typeof setInterval>;

  protected startImpl(): void {
    this.intervalHandle = setInterval(() => this.update(), this.options.interval * 1000);
  }

  protected stopImpl(): void {
    clearInterval(this.intervalHandle);
  }

  protected updateCompleteImpl(): void {}
}

export class AnimationFrameUpdater extends Updater {
  private animationFrameHandle?: number;

  protected startImpl(): void {
    this.animationFrameHandle = requestAnimationFrame(() => this.update());
  }

  protected stopImpl(): void {
    cancelAnimationFrame(this.animationFrameHandle!);
  }

  protected updateCompleteImpl(): void {
    if (this.isRunning()) {
      this.animationFrameHandle = requestAnimationFrame(() => this.update());
    }
  }
}
