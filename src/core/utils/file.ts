import { pb } from "@/pocketbase";

export type UrlOrFile = string | File;

export function resolveFilename(file: UrlOrFile): string {
  if (file instanceof File) {
    return file.name;
  } else {
    return file;
  }
}

// PocketBase appends "_" and a random 10 character suffix to every stored file name.
const STORED_SUFFIX = /_[a-z0-9]{10}(\.[^.]+)?$/i;

export function displayFilename(file: UrlOrFile): string {
  const name = resolveFilename(file);
  return file instanceof File ? name : name.replace(STORED_SUFFIX, "$1");
}

export function resolveUrl(file: UrlOrFile, collectionIdOrName: string, recordId: string): string {
  if (file instanceof File) {
    return URL.createObjectURL(file);
  } else {
    return pb.buildURL(`/api/files/${collectionIdOrName}/${recordId}/${file}`);
  }
}
