import type { Locator, Page } from "@playwright/test";

export type UploadFile = { name: string; mimeType: string; buffer: Buffer };

/** Vue reports render errors through console.error, so uncaught exceptions alone miss them. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

export async function toUploadFile(file: File, name = file.name): Promise<UploadFile> {
  return { name, mimeType: file.type || "application/octet-stream", buffer: Buffer.from(await file.arrayBuffer()) };
}

/**
 * The app opens file dialogs from buttons without a permanent input element, so files are passed
 * through Playwright's file chooser event.
 */
export async function chooseFiles(page: Page, opener: Locator, files: UploadFile[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await opener.click();
  await (await chooser).setFiles(files);
}
