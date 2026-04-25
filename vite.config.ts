import { copyFileSync } from "node:fs";
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
