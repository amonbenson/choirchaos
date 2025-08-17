import { pb, type PbRecord } from "@/pocketbase";

export type UrlOrFile = string | File;

export function resolveFilename(file: UrlOrFile) {
  if (file instanceof File) {
    return file.name;
  } else {
    return file;
  }
}

export function resolveUrl(file: UrlOrFile, collectionIdOrName: string, recordId: string) {
  if (file instanceof File) {
    return URL.createObjectURL(file);
  } else {
    return pb.buildURL(`/api/files/${collectionIdOrName}/${recordId}/${file}`);
  }
}
