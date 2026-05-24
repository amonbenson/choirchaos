import { computed, type ComputedRef, getCurrentScope, onScopeDispose, shallowRef, type WritableComputedRef } from "vue";

import type { Event } from "@/core/utils/events";

export type UseEventOptions<T> = {
  getter?: () => T;
  setter?: (value: T) => void;
};

// With setter: return WritableComputedRef
export function useEvent<T>(event: Event<any>, initial: T, options: { getter?: () => T; setter: (v: T) => void }): WritableComputedRef<T>;

// Standard: event payload is T, no setter: return ComputedRef
export function useEvent<T>(event: Event<T>, initial: T, options?: { getter?: never }): ComputedRef<T>;

// Custom getter: event is trigger only, no setter: return ComputedRef
export function useEvent<T>(event: Event<any>, initial: T, options: { getter: () => T; setter?: never }): ComputedRef<T>;

export function useEvent<T>(event: Event<any>, initial: T, options: UseEventOptions<T> = {}): WritableComputedRef<T> {
  if (!getCurrentScope()) {
    throw new Error("No active effect scope.");
  }

  const value = shallowRef<T>(initial);
  const d = event((v: T) => {
    value.value = options.getter ? options.getter() : v;
  });
  onScopeDispose(() => d.dispose());

  return computed({
    get: () => value.value,
    set: options.setter ?? (() => {
      throw new Error("Value is read only.");
    }),
  });
}
