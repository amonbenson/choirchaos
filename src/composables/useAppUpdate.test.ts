import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { UPDATE_TOAST_GROUP, useAppUpdate } from "./useAppUpdate";

const toast = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock("primevue/usetoast", () => ({ useToast: () => toast }));

const CHECK_INTERVAL_MS = 60_000;

const fetchMock = vi.fn();

function deploy(build: string): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ build })));
}

async function setUp(): Promise<{ router: Router; unmount: () => void }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => null } },
      { path: "/other", component: { render: () => null } },
    ],
  });
  await router.push("/");
  const wrapper = mount(defineComponent({ setup: () => useAppUpdate(), render: () => null }), {
    global: { plugins: [router] },
  });
  return { router, unmount: () => wrapper.unmount() };
}

async function returnToTab(): Promise<void> {
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
}

describe("useAppUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("VITE_BUILD_ID", "build-1");
    vi.stubGlobal("fetch", fetchMock);
    deploy("build-1");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not check right after loading", async () => {
    const { unmount } = await setUp();

    await returnToTab();

    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it("checks without caching when the tab returns after a while", async () => {
    const { unmount } = await setUp();

    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    await returnToTab();

    expect(fetchMock).toHaveBeenCalledWith("/version.json", { cache: "no-store" });
    expect(toast.add).not.toHaveBeenCalled();
    unmount();
  });

  it("checks at most once per interval", async () => {
    const { router, unmount } = await setUp();

    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    await returnToTab();
    await router.push("/other");
    await returnToTab();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("offers a reload and stops in-app navigation once a newer build is deployed", async () => {
    const { router, unmount } = await setUp();
    deploy("build-2");

    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    await returnToTab();

    expect(toast.add).toHaveBeenCalledOnce();
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ group: UPDATE_TOAST_GROUP }));

    await router.push("/other").catch(() => {});

    expect(router.currentRoute.value.path).toBe("/");
    unmount();
  });

  it("ignores a failed check", async () => {
    const { router, unmount } = await setUp();
    fetchMock.mockRejectedValue(new TypeError("offline"));

    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    await returnToTab();
    await router.push("/other");

    expect(toast.add).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/other");
    unmount();
  });

  it("stays inactive without a build id", async () => {
    vi.stubEnv("VITE_BUILD_ID", "");
    const { unmount } = await setUp();

    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    await returnToTab();

    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });
});
