import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import PocketBase from "pocketbase";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import {
  BACKEND_COMMIT,
  BACKEND_CONTAINER_PORT,
  BACKEND_REPOSITORY,
  PROJECT_ROOT,
  SUPERUSER,
} from "../config";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = "choirchaos-pb-e2e";
const DOCKER_BUILD_TIMEOUT_MS = 10 * 60 * 1000;

export type Backend = {
  url: string;
  stop: () => Promise<void>;
};

export type StartBackendOptions = {
  image: string;
  hostPort?: number;
};

async function imageExists(tag: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["image", "inspect", tag]);
    return true;
  } catch {
    return false;
  }
}

async function dockerBuild(tag: string, context: string): Promise<void> {
  try {
    await execFileAsync("docker", ["build", "--tag", tag, context], {
      timeout: DOCKER_BUILD_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`Building the backend image from '${context}' failed. Is Docker running?\n${stderr}`);
  }
}

/**
 * Builds the PocketBase image either from a local choirchaos-pb checkout or from the pinned
 * commit on GitHub, and returns its tag. Pinned images are cached by commit; local checkouts are
 * always rebuilt so that new migrations are picked up (Docker's layer cache keeps this fast).
 */
export async function ensureBackendImage(localSource?: string): Promise<string> {
  if (localSource) {
    const tag = `${IMAGE_NAME}:local`;
    await dockerBuild(tag, resolve(PROJECT_ROOT, localSource));
    return tag;
  }

  const tag = `${IMAGE_NAME}:${BACKEND_COMMIT.slice(0, 12)}`;
  if (!(await imageExists(tag))) {
    await dockerBuild(tag, `${BACKEND_REPOSITORY}#${BACKEND_COMMIT}`);
  }

  return tag;
}

/**
 * Starts a fresh PocketBase container with an in-memory data directory. The superuser is created
 * before the server starts, so its credentials are always `SUPERUSER`. Testcontainers removes the
 * container when the process exits, even after a crash.
 */
export async function startBackend({ image, hostPort }: StartBackendOptions): Promise<Backend> {
  const startCommand = [
    `/pb/pocketbase superuser upsert "$E2E_SUPERUSER_EMAIL" "$E2E_SUPERUSER_PASSWORD"`,
    `exec /pb/pocketbase serve --http=0.0.0.0:${BACKEND_CONTAINER_PORT}`,
  ].join(" && ");

  const exposedPort = hostPort === undefined
    ? BACKEND_CONTAINER_PORT
    : { container: BACKEND_CONTAINER_PORT, host: hostPort };

  const container: StartedTestContainer = await new GenericContainer(image)
    .withCommand(["sh", "-c", startCommand])
    .withEnvironment({
      E2E_SUPERUSER_EMAIL: SUPERUSER.email,
      E2E_SUPERUSER_PASSWORD: SUPERUSER.password,
    })
    .withTmpFs({ "/pb/pb_data": "rw" })
    .withExposedPorts(exposedPort)
    .withLabels({ "org.choirchaos.e2e": "backend" })
    .withWaitStrategy(Wait.forHttp("/api/health", BACKEND_CONTAINER_PORT).forStatusCode(200))
    .withStartupTimeout(60_000)
    .start();

  const url = `http://${container.getHost()}:${container.getMappedPort(BACKEND_CONTAINER_PORT)}`;

  return {
    url,
    stop: async () => {
      await container.stop();
    },
  };
}

export function createClient(backendUrl: string): PocketBase {
  const client = new PocketBase(backendUrl);
  client.autoCancellation(false);
  return client;
}

export async function createSuperuserClient(backendUrl: string): Promise<PocketBase> {
  const client = createClient(backendUrl);
  await client.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
  return client;
}
