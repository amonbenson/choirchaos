import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const E2E_ROOT = fileURLToPath(new URL(".", import.meta.url));
export const CACHE_DIR = fileURLToPath(new URL("./.cache", import.meta.url));
export const FRONTEND_DIST_DIR = fileURLToPath(new URL("./.cache/dist", import.meta.url));
export const SCORE_ASSETS_DIR = fileURLToPath(new URL("./assets/scores", import.meta.url));
export const MUSESCORE_STYLE_FILE = fileURLToPath(new URL("./assets/conductor.mss", import.meta.url));

// Bump this together with frontend changes that depend on a newer backend schema.
export const BACKEND_REPOSITORY = "https://github.com/amonbenson/choirchaos-pb.git";
export const BACKEND_COMMIT = "6e578c4611a9e1aa56d5ab8995d69ccf3ff2e2d5";

export const BACKEND_CONTAINER_PORT = 8090;

export const SUPERUSER = Object.freeze({
  email: "admin@choirchaos.test",
  password: "choirchaos-e2e-admin",
});

export const DEFAULT_USER_PASSWORD = "choirchaos-e2e-user";

export type E2eEnvironment = {
  backendSource: string | undefined;
  skipFrontendBuild: boolean;
  isCi: boolean;
};

export function readEnvironment(): E2eEnvironment {
  return {
    backendSource: process.env.E2E_BACKEND_SOURCE || undefined,
    skipFrontendBuild: process.env.E2E_SKIP_BUILD === "1",
    isCi: !!process.env.CI,
  };
}
