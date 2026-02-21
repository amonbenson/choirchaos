import { type Ref, ref } from "vue";

export function usePromise<T, E>(promise: Promise<T>): [Ref<T | null>, Ref<boolean>, Ref<E | null>] {
  const result: Ref<T | null> = ref(null);
  const loading = ref(true);
  const error: Ref<E | null> = ref(null);

  (async () => {
    try {
      result.value = await promise;
    } catch (err) {
      error.value = err as E;
    } finally {
      loading.value = false;
    }
  })();

  return [result, loading, error];
}
