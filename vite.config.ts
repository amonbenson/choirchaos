import { fileURLToPath, URL } from "node:url";

import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
// import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import svgLoader from "vite-svg-loader";

// load vite environment variables
const viteEnv = loadEnv(process.env.NODE_ENV, process.cwd());

// https://vite.dev/config/
export default defineConfig({
  base: viteEnv.VITE_BASE_URL,
  plugins: [
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
