import PocketBase from "pocketbase";
export type PbRecord = { [key: string]: any };

const pb = new PocketBase(import.meta.env.VITE_PB_URL);

// Clear a stored token that has already expired so the app starts in a clean state.
if (pb.authStore.record && !pb.authStore.isValid) {
  pb.authStore.clear();
}

export { pb };
