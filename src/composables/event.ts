import { computed, getCurrentScope,onScopeDispose, ref } from "vue";

type EventEmitterLike = {
  on: (eventName: string | symbol, handler: (...args: any) => void) => void;
  off: (eventName: string | symbol, handler: (...args: any) => void) => void;
}

export type EventEmitterOptions<E, T> = {
  initial?: T,
  getter?: (emitter: E, ...params: any[]) => T;
  setter?: (emitter: E, value: T) => void;
};

export function useEvent<E extends EventEmitterLike, T>(emitter: E, event: string, options: EventEmitterOptions<E, T> = {}) {
  if (!getCurrentScope()) {
    throw new Error("No active effect scope.");
  }

  const initial = options.initial ?? null;
  const getter = options.getter ?? ((_, ...params) => params[0]);
  const setter = options.setter ?? null;

  const receiverValue = ref(initial);

  // register emitter -> receiver synchronization
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
