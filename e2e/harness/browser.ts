import type { Page } from "@playwright/test";

import type { Factory, TestUser } from "./factories";

const AUTH_STORAGE_KEY = "pocketbase_auth";

/**
 * Signs the page in as `user` without going through the login form, by seeding the PocketBase
 * SDK's auth store before any app script runs. Call before the first `page.goto()`.
 */
export async function loginAs(page: Page, factory: Factory, user: TestUser): Promise<void> {
  const client = await factory.clientFor(user);
  const value = JSON.stringify({ token: client.authStore.token, record: client.authStore.record });

  await page.addInitScript(([key, auth]) => {
    window.localStorage.setItem(key, auth);
  }, [AUTH_STORAGE_KEY, value] as const);
}
