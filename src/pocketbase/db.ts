import { pb, type PbRecord } from ".";

const DRY_RUN = import.meta.env.VITE_DRY_RUN === "true";

export async function dbUpdate(collection: string, id: string, data: PbRecord): Promise<PbRecord> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] update ${collection}/${id}:`, data);
    return { id, ...data };
  }

  return pb.collection(collection).update(id, data);
}

export async function dbGetOne(collection: string, id: string, fields?: string): Promise<PbRecord> {
  if (DRY_RUN) {
    return { id };
  }

  return pb.collection(collection).getOne(id, { fields });
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

export async function dbCreateWithFiles(collection: string, formData: FormData): Promise<PbRecord> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] create ${collection} (files):`, Object.fromEntries(formData.entries()));
    return { id: "dry-run" };
  }

  return pb.collection(collection).create(formData);
}

export async function dbDelete(collection: string, id: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] delete ${collection}/${id}`);
    return;
  }

  await pb.collection(collection).delete(id);
}
