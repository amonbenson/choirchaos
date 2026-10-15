import { resolve } from "node:path";

import { build, createServer, preview, type ProxyOptions } from "vite";

import { PROJECT_ROOT } from "../config";

export type Frontend = {
  url: string;
  stop: () => Promise<void>;
};

export type StartFrontendOptions = {
  backendUrl: string;
  port?: number;
};

// The app talks to PocketBase on its own origin and the server proxies to the backend. This lets
// one build serve any number of backends on random ports.
const FRONTEND_ENV = {
  VITE_BASE_URL: "/",
  VITE_PB_URL: "/",
  VITE_DRY_RUN: "",
  VITE_PB_AUTOLOGIN_EMAIL: "",
  VITE_PB_AUTOLOGIN_PASS: "",
  VITE_PB_AUTOLOGIN_SHOW: "",
  VITE_PB_AUTOLOGIN_SONG: "",
};

const BACKEND_PATHS = ["/api", "/_"];

function backendProxy(backendUrl: string): Record<string, ProxyOptions> {
  return Object.fromEntries(BACKEND_PATHS.map(path => [path, { target: backendUrl, changeOrigin: true }]));
}

async function withFrontendEnv<T>(action: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(FRONTEND_ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, FRONTEND_ENV);

  try {
    return await action();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function resolveServerUrl(urls: { local: string[] } | null, kind: string): string {
  const url = urls?.local[0];
  if (!url) {
    throw new Error(`The ${kind} server did not report a local URL.`);
  }

  return url.replace(/\/$/, "");
}

export async function buildFrontend(outDir: string): Promise<void> {
  await withFrontendEnv(() => build({
    root: PROJECT_ROOT,
    configFile: resolve(PROJECT_ROOT, "vite.config.ts"),
    mode: "production",
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  }));
}

/**
 * Serves a production build created by `buildFrontend()`. Port 0 picks a free port.
 */
export async function startFrontendPreview(outDir: string, { backendUrl, port = 0 }: StartFrontendOptions): Promise<Frontend> {
  const server = await preview({
    root: PROJECT_ROOT,
    configFile: false,
    logLevel: "warn",
    build: { outDir },
    preview: {
      host: "127.0.0.1",
      port,
      strictPort: port !== 0,
      proxy: backendProxy(backendUrl),
    },
  });

  return {
    url: resolveServerUrl(server.resolvedUrls, "preview"),
    stop: () => server.close(),
  };
}

/**
 * Runs the Vite dev server against a backend, for interactive debugging with hot reload.
 */
export async function startFrontendDevServer({ backendUrl, port = 5174 }: StartFrontendOptions): Promise<Frontend> {
  const server = await withFrontendEnv(async () => {
    const devServer = await createServer({
      root: PROJECT_ROOT,
      configFile: resolve(PROJECT_ROOT, "vite.config.ts"),
      server: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        proxy: backendProxy(backendUrl),
      },
    });
    return devServer.listen();
  });

  return {
    url: resolveServerUrl(server.resolvedUrls, "dev"),
    stop: () => server.close(),
  };
}
