import PocketBase from "pocketbase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PbRecord = { [key: string]: any };

const pb = new PocketBase(import.meta.env.VITE_PB_URL);

export { pb };
