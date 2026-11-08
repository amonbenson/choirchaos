import "./main.css";

import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";
import { createApp } from "vue";
import webAudioFontUrl from "webaudiofont/npm/dist/WebAudioFontPlayer.js?url";

import App from "./App.vue";
import { router } from "./router/router";
import { createPreset, DEFAULT_PALETTES } from "./theme/preset";

// PrimeVue renders icon font glyphs without hiding them, so screen readers would announce them next to the label.
const HIDDEN = { "aria-hidden": "true" };
// These controls have a fixed size but no in-flow content, so a flex row with wrapping text would squeeze them.
const FIXED_SIZE = { class: "shrink-0" };
const PASS_THROUGH = {
  avatar: { root: FIXED_SIZE, icon: HIDDEN },
  button: { icon: HIDDEN },
  checkbox: { root: FIXED_SIZE },
  contextmenu: { itemIcon: HIDDEN },
  menu: { itemIcon: HIDDEN },
  message: { icon: HIDDEN },
  radiobutton: { root: FIXED_SIZE },
  tag: { icon: HIDDEN },
  toggleswitch: { root: FIXED_SIZE },
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
    pt: PASS_THROUGH,
    theme: {
      preset: createPreset(DEFAULT_PALETTES),
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
