export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (value: T) => void) => Disposable;

export type Emitters = Record<string, Emitter<any>>;

export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class Property<T> {
  private value: T;
  private readonly emitter = new Emitter<T>();
  readonly onChange: Event<T> = this.emitter.event;

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    if (this.value === value) {
      return;
    }

    this.value = value;
    this.emitter.fire(value);
  }
}
