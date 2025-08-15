import { createWebHistory , createRouter } from "vue-router";
import HomeView from "@/views/HomeView.vue";
import ShowView from "@/views/ShowView.vue";

const routes = [
  { path: "/", component: HomeView },
  { path: "/show/:showId", component: ShowView },
  { path: "/show/:showId/song/:songId", component: ShowView },
  { path: "/mti", component: () => import("@/views/MTIImportView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
