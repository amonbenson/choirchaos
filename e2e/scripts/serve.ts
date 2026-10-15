import { readEnvironment, SUPERUSER } from "../config";
import { COMPOUND_METER, CONDUCTOR, MINIMAL } from "../generators/score/presets";
import { buildSongBundle } from "../generators/song";
import { type Backend, createSuperuserClient, ensureBackendImage, startBackend } from "../harness/backend";
import { createFactory } from "../harness/factories";
import { startFrontendDevServer } from "../harness/frontend";

const BACKEND_PORT = Number(process.env.E2E_SERVE_BACKEND_PORT ?? 8091);
const FRONTEND_PORT = Number(process.env.E2E_SERVE_FRONTEND_PORT ?? 5174);
const SEED = process.env.E2E_SERVE_SEED !== "0";

async function seed(backendUrl: string): Promise<string[]> {
  const admin = await createSuperuserClient(backendUrl);
  const factory = createFactory(backendUrl, admin);

  const owner = await factory.createUser({ name: "Demo Owner", email: "owner@choirchaos.test" });
  const editor = await factory.createUser({ name: "Demo Editor", email: "editor@choirchaos.test" });
  const viewer = await factory.createUser({ name: "Demo Viewer", email: "viewer@choirchaos.test" });
  const show = await factory.createShow(owner, { title: "Demo Show", editors: [editor], viewers: [viewer] });

  await factory.createSong(owner, show, await buildSongBundle(MINIMAL, { mode: "audio" }));
  await factory.createSong(owner, show, await buildSongBundle(CONDUCTOR, { mode: "midi" }));
  await factory.createSong(owner, show, await buildSongBundle(COMPOUND_METER, { mode: "audio" }));

  return [
    `Users (password '${owner.password}'): ${[owner, editor, viewer].map(user => user.email).join(", ")}`,
    `Demo show: ${show.id}`,
  ];
}

async function startBackendOnFixedPort(image: string): Promise<Backend> {
  try {
    return await startBackend({ image, hostPort: BACKEND_PORT });
  } catch (error) {
    // A container from a previous run keeps the port for a few seconds until Testcontainers reaps it.
    throw new Error(`Could not start the backend on port ${BACKEND_PORT}. If a previous run just stopped, wait a few seconds; otherwise set E2E_SERVE_BACKEND_PORT.`, { cause: error });
  }
}

const image = await ensureBackendImage(readEnvironment().backendSource);
const backend = await startBackendOnFixedPort(image);
const seedSummary = SEED ? await seed(backend.url) : [];
const frontend = await startFrontendDevServer({ backendUrl: backend.url, port: FRONTEND_PORT });

console.log([
  "",
  `Frontend:  ${frontend.url}`,
  `Backend:   ${backend.url}  (dashboard ${backend.url}/_/)`,
  `Superuser: ${SUPERUSER.email} / ${SUPERUSER.password}`,
  ...seedSummary,
  "",
  "The backend keeps its data in memory and is removed on exit. Press Ctrl+C to stop.",
].join("\n"));

const shutdown = async (): Promise<void> => {
  await frontend.stop();
  await backend.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
