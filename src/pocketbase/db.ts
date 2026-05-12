import { pb, type PbRecord } from ".";

const DRY_RUN = import.meta.env.VITE_DRY_RUN === "true";

export async function dbUpdate(collection: string, id: string, data: PbRecord): Promise<PbRecord> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] update ${collection}/${id}:`, data);
    return { id, ...data };
  }

  return pb.collection(collection).update(id, data);
}

export async function dbUpdateWithFiles(collection: string, id: string, formData: FormData): Promise<PbRecord> {
  if (DRY_RUN) {
    const entries: Record<string, any> = {};
    formData.forEach((value, key) => {
      entries[key] = value;
    });
    console.log(`[DRY RUN] update ${collection}/${id} (files):`, entries);
    return { id };
  }

  return pb.collection(collection).update(id, formData);
}

export async function dbCreate(collection: string, data: PbRecord): Promise<PbRecord> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] create ${collection}:`, data);
    return { id: "dry-run", ...data };
  }

  return pb.collection(collection).create(data);
}
