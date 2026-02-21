import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import App from "./App.vue";
import { router } from "./router/router";
import "./main.css";
import webAudioFontUrl from "webaudiofont/npm/dist/WebAudioFontPlayer.js?url";

// Load WebAudioFont as a global script (the library uses top-level var declarations,
// so it must be executed as a classic script, not bundled as an ES module).
async function init() {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = webAudioFontUrl;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const app = createApp(App);
  app.use(createPinia());
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        prefix: "p",
        darkModeSelector: "system",
        cssLayer: {
          name: "primevue",
          order: "theme, base, primevue",
        },
      },
    },
  });
  app.use(router);
  app.mount("#app");
}

init();
