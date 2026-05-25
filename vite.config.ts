import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

// import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";
import svgLoader from "vite-svg-loader";

// load vite environment variables
const viteEnv = loadEnv(process.env.NODE_ENV as string, process.cwd());

// https://vite.dev/config/
export default defineConfig({
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
    vue(),
    // vueDevTools(),
    tailwindcss(),
    svgLoader(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
