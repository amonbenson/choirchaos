import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default defineConfig(configEnv => mergeConfig(
  viteConfig(configEnv),
  defineConfig({
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
      root: fileURLToPath(new URL("./", import.meta.url)),
      setupFiles: ["src/test/setup.ts"],
    },
  }),
));
