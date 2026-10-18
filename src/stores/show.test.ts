import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Show from "@/core/models/show";
import { useAuthStore } from "@/stores/auth";

import { useShowStore } from "./show";

vi.mock("@/pocketbase", () => ({
  pb: { authStore: { record: { id: "editor" }, onChange: vi.fn() } },
}));

function makeShow(id: string): Show {
  return Show.deserialize({ id, title: id, owner: "owner", visibility: "private", expand: { songs_via_show: [] } });
}

describe("useShowStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(Show, "get").mockImplementation(async id => makeShow(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the loaded show for every page of that show", async () => {
    const store = useShowStore();

    const first = await store.load("a");
    store.release("a");
    const second = await store.load("a");

    expect(second).toBe(first);
    expect(store.current).toBe(first);
    expect(Show.get).toHaveBeenCalledTimes(1);
  });

  it("drops the show once the route leaves it", async () => {
    const store = useShowStore();
    await store.load("a");

    store.release(undefined);

    expect(store.current).toBeUndefined();
    await store.load("a");
    expect(Show.get).toHaveBeenCalledTimes(2);
  });

  it("refetches the show for another user", async () => {
    const store = useShowStore();
    const first = await store.load("a");

    useAuthStore().user = { id: "viewer" } as never;
    const second = await store.load("a");

    expect(second).not.toBe(first);
    expect(Show.get).toHaveBeenCalledTimes(2);
  });
});
