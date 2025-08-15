import PocketBase from "pocketbase";

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PbRecord = { [key: string]: any };

export { pb };
