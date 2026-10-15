import { expect, test as base } from "@playwright/test";
import type PocketBase from "pocketbase";

import { FRONTEND_DIST_DIR, SUPERUSER } from "../config";
import { createSuperuserClient, startBackend } from "./backend";
import { loginAs } from "./browser";
import { createFactory, type Factory, type TestUser } from "./factories";
import { startFrontendPreview } from "./frontend";
import {
  type BackendSnapshot,
  DEFAULT_INVARIANTS,
  findInvariantViolations,
  type Invariant,
  resetBackend,
  snapshotBackend,
  type SnapshotOptions,
} from "./state";

export type BackendInfo = {
  url: string;
  superuser: typeof SUPERUSER;
};

export type FrontendInfo = {
  url: string;
};

type WorkerFixtures = {
  backend: BackendInfo;
  frontend: FrontendInfo;
};

type TestFixtures = {
  /** PocketBase client authenticated as superuser. Bypasses all access rules. */
  admin: PocketBase;
  factory: Factory;
  loginAs: (user: TestUser) => Promise<void>;
  snapshot: (options?: SnapshotOptions) => Promise<BackendSnapshot>;
  /** Rules checked after every test. Override with `test.use({ invariants: [...] })`. */
  invariants: readonly Invariant[];
  resetBackendBeforeTest: void;
  checkInvariantsAfterTest: void;
};

function requireBackendImage(): string {
  const image = process.env.E2E_BACKEND_IMAGE;
  if (!image) {
    throw new Error("E2E_BACKEND_IMAGE is not set. Run the suite through 'npm run test:e2e' so that the global setup builds the image.");
  }

  return image;
}

/**
 * Each Playwright worker gets its own backend container and frontend server. Tests in a worker run
 * one after another and every test starts with an empty database, so tests never see each other's
 * data and may run in parallel across workers.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  backend: [async ({}, use) => {
    const backend = await startBackend({ image: requireBackendImage() });
    await use({ url: backend.url, superuser: SUPERUSER });
    await backend.stop();
  }, { scope: "worker", timeout: 120_000 }],

  frontend: [async ({ backend }, use) => {
    const frontend = await startFrontendPreview(FRONTEND_DIST_DIR, { backendUrl: backend.url });
    await use({ url: frontend.url });
    await frontend.stop();
  }, { scope: "worker" }],

  baseURL: async ({ frontend }, use) => {
    await use(frontend.url);
  },

  admin: async ({ backend }, use) => {
    await use(await createSuperuserClient(backend.url));
  },

  factory: async ({ backend, admin }, use) => {
    await use(createFactory(backend.url, admin));
  },

  loginAs: async ({ page, factory }, use) => {
    await use(user => loginAs(page, factory, user));
  },

  snapshot: async ({ admin }, use) => {
    await use(options => snapshotBackend(admin, options));
  },

  invariants: [DEFAULT_INVARIANTS, { option: true }],

  resetBackendBeforeTest: [async ({ admin }, use) => {
    await resetBackend(admin);
    await use();
  }, { auto: true }],

  checkInvariantsAfterTest: [async ({ admin, invariants }, use, testInfo) => {
    await use();

    if (testInfo.status !== testInfo.expectedStatus) {
      return;
    }

    const violations = await findInvariantViolations(admin, invariants);
    expect(violations, "The test left the backend in an inconsistent state").toEqual([]);
  }, { auto: true }],
});

export { expect };
