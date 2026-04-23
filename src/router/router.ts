import { ClientResponseError } from "pocketbase";
import { markRaw } from "vue";
import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";

import Show from "@/core/models/show";
import { login } from "@/pocketbase/auth";
import HomeView from "@/views/HomeView.vue";
import WorkspaceView from "@/views/WorkspaceView.vue";

let pendingShow: Show | undefined;

export function consumePendingShow(): Show | undefined {
  const show = pendingShow;
  pendingShow = undefined;
  return show;
}

async function autoLogin(to: RouteLocationNormalized): Promise<any> {
  // Skip if we are in production
  if (!import.meta.env.DEV) {
    return;
  }

  // auto-login
  if (import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"]) {
    console.info(`Auto-login activated. Trying to log in with email '${import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"]}'`);
    const res = await login(import.meta.env["VITE_PB_AUTOLOGIN_EMAIL"], import.meta.env["VITE_PB_AUTOLOGIN_PASS"]);
    console.info(`Logged in as '${res.record.name}'`);
  }

  // auto-select show
  if (to.name === "home" && import.meta.env["VITE_PB_AUTOLOGIN_SHOW"]) {
    return {
      name: "show",
      params: {
        showId: import.meta.env["VITE_PB_AUTOLOGIN_SHOW"],
      },
    };
  }
}

async function resolveFirstSong(to: RouteLocationNormalized): Promise<any> {
  try {
    const show: Show = await Show.get(to.params.showId as string);
    pendingShow = show;

    // mark expensive/large reference properties as raw so vue doesn't try to make them reactive.
    // They cannot be changed anyway unless the whole show object is replaced
    for (const song of show.songs) {
      song.$midiSystemEvents = markRaw(song.$midiSystemEvents);

      for (const track of song.tracks) {
        track.$midiTrackEvents = markRaw(track.$midiTrackEvents);
      }

      for (const measure of song.measures.items()) {
        measure.$beatTicks = markRaw(measure.$beatTicks);
      }
    }

    // Select the first song
    const firstSongId = show.songs[0]?.id as string | undefined;

    // If a valid id was found, redirect to that song's slug
    if (firstSongId && to.name !== "song") {
      return {
        name: "song",
        params: { showId: to.params.showId, songId: firstSongId },
      };
    }
  } catch (err) {
    if (err instanceof ClientResponseError) {
      // Show was not found. Return to homepage
      if (to.name !== "home") {
        return { name: "home" };
      }
    } else {
      // Re-throw any other kind of error
      throw err;
    }
  }
}

const routes = [
  {
    name: "home",
    path: "/",
    component: HomeView,
    beforeEnter: autoLogin,
  },
  {
    name: "show",
    path: "/show/:showId",
    component: WorkspaceView,
    props: true,
    beforeEnter: resolveFirstSong,
  },
  {
    name: "song",
    path: "/show/:showId/song/:songId",
    component: WorkspaceView,
    props: true,
  },
  // { name: "mti", path: "/mti", component: () => import("@/views/MTIImportView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
