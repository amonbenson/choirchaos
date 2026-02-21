import { pb } from "@/pocketbase";

export type UrlOrFile = string | File;

export function resolveFilename(file: UrlOrFile): string {
  if (file instanceof File) {
    return file.name;
  } else {
    return file;
  }
}

export function resolveUrl(file: UrlOrFile, collectionIdOrName: string, recordId: string): string {
  if (file instanceof File) {
    return URL.createObjectURL(file);
  } else {
    return pb.buildURL(`/api/files/${collectionIdOrName}/${recordId}/${file}`);
  }
}
