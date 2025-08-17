import type EventEmitter from "events";
import { ref, computed, onScopeDispose, getCurrentScope } from "vue";

export type EventEmitterOptions<E, T> = {
  initial?: T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getter?: (emitter: E, ...params: any[]) => T;
  setter?: (emitter: E, value: T) => void;
};

export function useEvent<E extends EventEmitter, T>(emitter: E, event: string, options: EventEmitterOptions<E, T> = {}) {
  if (!getCurrentScope()) {
    throw new Error("No active effect scope.");
  }

  const initial = options.initial ?? null;
  const getter = options.getter ?? ((_, ...params) => params[0]);
  const setter = options.setter ?? null;

  const receiverValue = ref(initial);

  // register emitter -> receiver synchronization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncEmitterToReceiver = (...params: any[]) => {
    receiverValue.value = getter(emitter, ...params);
  };
  emitter.on(event, syncEmitterToReceiver);
  onScopeDispose(() => emitter.off(event, syncEmitterToReceiver));

  const syncReceiverToEmitter = (param: T) => {
    if (!setter) {
      throw new Error("Value is read only");
    }

    // let the setter handle the new value
    setter(emitter, param);
  };

  // wrap in a computed reference to allow setting the value
  return computed<T>({
    get: () => receiverValue.value,
    set: (value) => syncReceiverToEmitter(value),
  });
}
