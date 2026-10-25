import { deserializeLocation, type Location, serializeLocation, type StoredLocation } from "./recording";

export type Marker = { at: Location; text: string };

export type StoredMarker = { at: StoredLocation; text: string };

export function serializeMarker({ at, text }: Marker): StoredMarker {
  return { at: serializeLocation(at), text };
}

export function deserializeMarker({ at, text }: StoredMarker): Marker {
  return { at: deserializeLocation(at), text };
}
