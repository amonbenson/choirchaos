import { pb, type PbRecord } from "@/pocketbase";

export type UrlOrFile = string | File;

export function resolveFilename(file: UrlOrFile) {
  if (file instanceof File) {
    return file.name;
  } else {
    return file;
  }
}

export function resolveUrl<R extends PbRecord, K extends keyof R & string>(record: R, property: K) {
  const file: UrlOrFile = record[property];

  if (file instanceof File) {
    return URL.createObjectURL(file);
  } else {
    return pb.files.getURL(record, file);
  }
}
