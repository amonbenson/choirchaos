type UpdateProvider = "setTimeout" | "requestAnimationFrame";
export type UpdateProviderOption = UpdateProvider | "auto";

export type UpdateCallback = (delta: number) => void;
export type TimeProvider = () => number;

export type UpdaterOptions = {
  interval: number,
  maximumLag: number,
  timeProvider: TimeProvider,
}

export abstract class Updater {
  protected readonly _options: UpdaterOptions = {
    interval: 1 / 50,
    maximumLag: 1.5,
    timeProvider: () => new Date().getTime() / 1000,
  };
  private _updateCallback: UpdateCallback;
  private _lastUpdate: number = 0;
  private _running: boolean = false;

  constructor(updateCallback: UpdateCallback, options: Partial<UpdaterOptions> = {}) {
    Object.assign(this._options, {}, options);
    this._updateCallback = updateCallback;
  }

  public get lastUpdate() {
    return this._lastUpdate;
  }

  public get running() {
    return this._running;
  }

  protected _update() {
    // calculate delta time
    const now = this._options.timeProvider();
    let delta = now - this._lastUpdate;
    this._lastUpdate = now;

    // validate delta
    if (delta < 0) {
      console.error("Negative delta time! Make sure your timeProvider returns monotonic increasing values!");
      delta = 0;
    } else if (delta / this._options.interval > this._options.maximumLag) {
      console.warn(`Experiencing significant lag! (Update took ${delta / this._options.interval} times longer than usual)`);
    }

    // run update callback
    this._updateCallback(delta);

    // call update complete handler
    this._updateCompleteImpl();
  }

  start() {
    if (this._running) {
      return;
    }

    // reset time
    this._lastUpdate = this._options.timeProvider();

    this._running = true;
    this._startImpl();
  }

  stop() {
    if (!this._running) {
      return;
    }

    this._running = false;
    this._stopImpl();
  }

  protected abstract _startImpl(): void;
  protected abstract _stopImpl(): void;
  protected abstract _updateCompleteImpl(): void;
}

export class SetIntervalUpdater extends Updater {
  private _intervalHandle?: NodeJS.Timeout;

  protected _startImpl(): void {
    // setup a regular interval update handler
    this._intervalHandle = setInterval(() => this._update(), this._options.interval);
  }

  protected _stopImpl(): void {
    // stop the interval
    clearInterval(this._intervalHandle);
  }

  protected _updateCompleteImpl(): void {}
}

export class AnimationFrameUpdater extends Updater {
  private _animationFrameHandle?: number;

  protected _startImpl(): void {
    // request an animation frame to handle the update
    this._animationFrameHandle = requestAnimationFrame(() => this._update());
  }

  protected _stopImpl(): void {
    // stop any ongoing animation frame
    cancelAnimationFrame(this._animationFrameHandle!);
  }

  protected _updateCompleteImpl(): void {
    // request the next frame while we are still running
    if (this.running) {
      this._animationFrameHandle = requestAnimationFrame(() => this._update());
    }
  }
}

// export class AutoUpdater {
//   readonly _options: UpdaterOptions = {
//     interval: 1 / 50,
//     provider: "auto",
//     maximumLag: 1.5,
//   };
//   _updateCallback: UpdateCallback;
//   _currentProvider: UpdateProvider;
//   _running: boolean = false;

//   constructor(updateCallback: UpdateCallback, options: Partial<UpdaterOptions> = {}) {
//     Object.assign(this._options, options);
//     this._updateCallback = updateCallback;

//     if (this._options.provider === "auto") {
//       this._currentProvider = "requestAnimationFrame";
//     } else {
//       this._currentProvider = this._options.provider;
//     }
//   }

//   private _update() {

//   }

//   setUpdateProvider(provider: UpdateProvider) {
//     if (this._currentProvider === provider) {
//       return;
//     }

//     // stop during provider change
//     const wasRunning = this._running;
//     if (wasRunning) {
//       this.stop();
//     }

//     // restart if we were running before
//     if (wasRunning) {
//       this.start();
//     }
//   }

//   start() {

//   }

//   stop() {

//   }
// }
