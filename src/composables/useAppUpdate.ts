import { useEventListener } from "@vueuse/core";
import { useToast } from "primevue/usetoast";
import { onScopeDispose } from "vue";
import { useRouter } from "vue-router";

export const UPDATE_TOAST_GROUP = "update";

const MIN_CHECK_INTERVAL_MS = 60_000;

export async function fetchDeployedBuild(): Promise<string | undefined> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
    if (!response.ok) {
      return undefined;
    }

    const { build } = await response.json();
    return typeof build === "string" ? build : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Open tabs keep running the build they loaded, which breaks once a deploy changes the backend.
 * When the tab returns to the foreground or navigates, compares its build with the deployed one;
 * an outdated tab offers a reload and turns the next navigation into a full page load.
 */
export function useAppUpdate(): void {
  const build: string | undefined = import.meta.env["VITE_BUILD_ID"];
  if (!build) {
    return;
  }

  const router = useRouter();
  const toast = useToast();
  let isOutdated = false;
  let lastCheck = Date.now();

  async function check(): Promise<void> {
    if (isOutdated || Date.now() - lastCheck < MIN_CHECK_INTERVAL_MS) {
      return;
    }

    lastCheck = Date.now();

    const deployed = await fetchDeployedBuild();
    if (!deployed || deployed === build || isOutdated) {
      return;
    }

    isOutdated = true;
    toast.add({ severity: "info", group: UPDATE_TOAST_GROUP, summary: "A new version of choirchaos is available" });
  }

  useEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") {
      check();
    }
  });

  const removeBeforeEach = router.beforeEach((to) => {
    if (!isOutdated) {
      return;
    }

    window.location.assign(router.resolve(to).href);
    return false;
  });
  const removeAfterEach = router.afterEach(() => {
    check();
  });

  onScopeDispose(() => {
    removeBeforeEach();
    removeAfterEach();
  });
}
