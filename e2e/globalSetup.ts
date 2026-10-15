import { existsSync } from "node:fs";

import { FRONTEND_DIST_DIR, readEnvironment } from "./config";
import { ensureBackendImage } from "./harness/backend";
import { buildFrontend } from "./harness/frontend";

/**
 * Runs once per `playwright test` invocation, before any worker starts. Workers inherit the
 * environment variables set here.
 */
export default async function globalSetup(): Promise<void> {
  const environment = readEnvironment();

  const [image] = await Promise.all([
    ensureBackendImage(environment.backendSource),
    prepareFrontend(environment.skipFrontendBuild),
  ]);

  process.env.E2E_BACKEND_IMAGE = image;
}

async function prepareFrontend(skipBuild: boolean): Promise<void> {
  if (skipBuild && existsSync(FRONTEND_DIST_DIR)) {
    return;
  }

  await buildFrontend(FRONTEND_DIST_DIR);
}
