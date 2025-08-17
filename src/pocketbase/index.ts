import PocketBase from "pocketbase";
export type PbRecord = { [key: string]: any };

const pb = new PocketBase(import.meta.env.VITE_PB_URL);

export { pb };
