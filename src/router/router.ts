import { ClientResponseError } from "pocketbase";
import { markRaw } from "vue";
import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";

import Show from "@/core/models/show";
import { pb } from "@/pocketbase";
import { login } from "@/pocketbase/auth";
import AuthView from "@/views/AuthView.vue";
import HomeView from "@/views/HomeView.vue";
import NotFoundView from "@/views/NotFoundView.vue";
import ShowEditView from "@/views/ShowEditView.vue";
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
    // Redirecting from the show to its first song enters this guard twice. Reuse the first fetch.
    const showId = to.params.showId as string;
    const show: Show = pendingShow?.id === showId ? pendingShow : await Show.get(showId);
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

    // A show without songs has nothing to play yet, so editors go straight to adding songs.
    if (show.songs.length === 0 && show.getAccess(pb.authStore.record?.id).editor) {
      pendingShow = undefined;
      return { name: "show-edit", params: { showId: to.params.showId } };
    }

    if (to.name === "song-edit" && !show.getAccess(pb.authStore.record?.id).editor) {
      return { name: "song", params: to.params };
    }

    // Select the first song
    const firstSongId = show.songs[0]?.id as string | undefined;

    // If a valid id was found, redirect to that song's slug
    if (firstSongId && to.name === "show") {
      return {
        name: "song",
        params: { showId: to.params.showId, songId: firstSongId },
      };
    }
  } catch (err) {
    if (err instanceof ClientResponseError) {
      return notFound(to);
    }

    throw err;
  }
}

// Keeps the requested address in the URL, so signing in and reloading retries the same show.
function notFound(to: RouteLocationNormalized): object {
  return {
    name: "not-found",
    params: { pathMatch: to.path.substring(1).split("/") },
    query: to.query,
    hash: to.hash,
  };
}

const routes = [
  {
    name: "login",
    path: "/login",
    component: AuthView,
  },
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
    beforeEnter: resolveFirstSong,
  },
  {
    name: "song-edit",
    path: "/show/:showId/song/:songId/edit",
    component: WorkspaceView,
    props: true,
    beforeEnter: resolveFirstSong,
  },
  {
    name: "show-edit",
    path: "/show/:showId/edit",
    component: ShowEditView,
    props: true,
  },
  // { name: "mti", path: "/mti", component: () => import("@/views/MTIImportView.vue") },
  {
    name: "not-found",
    path: "/:pathMatch(.*)*",
    component: NotFoundView,
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
