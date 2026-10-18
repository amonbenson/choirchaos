import "./main.css";

import Aura from "@primeuix/themes/aura";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";
import { createApp } from "vue";
import webAudioFontUrl from "webaudiofont/npm/dist/WebAudioFontPlayer.js?url";

import App from "./App.vue";
import { router } from "./router/router";

// PrimeVue renders icon font glyphs without hiding them, so screen readers would announce them next to the label.
const HIDDEN = { "aria-hidden": "true" };
const DECORATIVE_ICONS_PT = {
  avatar: { icon: HIDDEN },
  button: { icon: HIDDEN },
  contextmenu: { itemIcon: HIDDEN },
  menu: { itemIcon: HIDDEN },
  message: { icon: HIDDEN },
  tag: { icon: HIDDEN },
};

// Load WebAudioFont as a global script (the library uses top-level var declarations,
// so it must be executed as a classic script, not bundled as an ES module).
async function init(): Promise<void> {
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
    pt: DECORATIVE_ICONS_PT,
    theme: {
      preset: Aura,
      options: {
        prefix: "p",
        darkModeSelector: ".dark",
        cssLayer: {
          name: "primevue",
          order: "theme, base, primevue",
        },
      },
    },
  });
  app.use(ToastService);
  app.use(ConfirmationService);
  app.directive("tooltip", Tooltip);
  app.use(router);
  app.mount("#app");
}

init();
