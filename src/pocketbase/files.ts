import { File } from "buffer";
import { pb, type PbRecord } from ".";
import { URL } from "url";

export type PbFile = string;
export type GenericFile = PbFile | File;

export function resolveFilename(file: GenericFile) {
  if (file instanceof File) {
    return file.name;
  } else {
    return file;
  }
}

export function resolveUrl<R extends PbRecord, K extends keyof R & string>(record: R, property: R[K] extends GenericFile ? K : never) {
  const file: GenericFile = record[property];

  if (file instanceof File) {
    return URL.createObjectURL(file);
  } else {
    return pb.files.getURL(record, file);
  }
}
