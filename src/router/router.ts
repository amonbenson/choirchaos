import { createRouter, createWebHistory } from "vue-router";

import HomeView from "@/views/HomeView.vue";
import ShowView from "@/views/ShowView.vue";

const routes = [
  { name: "home", path: "/", component: HomeView },
  { name: "show", path: "/show/:showId", component: ShowView, props: true },
  { name: "song", path: "/show/:showId/song/:songId", component: ShowView, props: true },
  // { name: "mti", path: "/mti", component: () => import("@/views/MTIImportView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
