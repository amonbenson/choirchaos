import { copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

// import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import svgLoader from "vite-svg-loader";

const PDFJS_ASSET_DIRECTORIES = ["standard_fonts", "cmaps", "wasm"];
const BACKEND_PATHS = ["/api", "/_"];

function backendProxy(backendUrl: string): Record<string, ProxyOptions> {
  return Object.fromEntries(BACKEND_PATHS.map(path => [path, { target: backendUrl, changeOrigin: true }]));
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const viteEnv = loadEnv(mode, process.cwd());
  // Open tabs compare this with the deployed version.json to notice that a newer build is out.
  const buildId = new Date().toISOString();
  if (command === "build") {
    process.env.VITE_BUILD_ID = buildId;
  }

  // Other devices only get AudioWorklet (rubberband) over HTTPS, and an HTTPS page cannot reach
  // an HTTP backend, so the app talks to PocketBase on its own origin through the proxy.
  const https = mode === "https";
  if (https) {
    process.env.VITE_PB_URL = "/";
  }

  return {
    base: viteEnv.VITE_BASE_URL,
    plugins: [
      {
        name: "copy-rubberband-processor",
        buildStart() {
          copyFileSync(
            "node_modules/rubberband-web/public/rubberband-processor.js",
            "public/rubberband-processor.js",
          );
          // Fix: channelData views are cached Float32Array subarrays into the WASM heap.
          // When a pitch change causes RubberBand to reallocate internally, WASM memory grows,
          // detaching the old ArrayBuffer and invalidating those views. Recompute dynamically instead.
          const dest = "public/rubberband-processor.js";
          writeFileSync(
            dest,
            readFileSync(dest, "utf8").replace(
              "return this.channelData[A]",
              "return this.module.HEAPF32.subarray((this.dataPtr>>2)+A*this.length,(this.dataPtr>>2)+(A+1)*this.length)",
            ),
          );
        },
      },
      {
        name: "copy-pdfjs-assets",
        // Runs in config() so the files exist before the dev server indexes the public directory.
        config() {
          for (const directory of PDFJS_ASSET_DIRECTORIES) {
            cpSync(`node_modules/pdfjs-dist/${directory}`, `public/pdfjs/${directory}`, { recursive: true });
          }
        },
      },
      {
        name: "emit-build-version",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) });
        },
      },
      vue(),
      // vueDevTools(),
      tailwindcss(),
      svgLoader(),
      https && basicSsl(),
    ],
    server: https ? { host: true, proxy: backendProxy(viteEnv.VITE_PB_URL) } : undefined,
    // Pre-bundling moves these packages away from the files they load relative to themselves
    // (the measure-detection worker, the onnxruntime WASM binaries).
    optimizeDeps: {
      exclude: ["measure-detection", "onnxruntime-web"],
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
