import { deserializeLocation, type Location, serializeLocation, type StoredLocation } from "./recording";

export type Marker = { at: Location; text: string };

export type StoredMarker = { at: StoredLocation; text: string };

export function serializeMarker({ at, text }: Marker): StoredMarker {
  return { at: serializeLocation(at), text };
}

export function deserializeMarker({ at, text }: StoredMarker): Marker {
  return { at: deserializeLocation(at), text };
}

export function addMarker(markers: readonly Marker[], marker: Marker): Marker[] {
  return [...markers, marker];
}

// Markers can share a location, so they are found by identity instead of by position.
export function replaceMarker(markers: readonly Marker[], marker: Marker, next: Marker): Marker[] {
  return markers.map(other => other === marker ? next : other);
}

export function removeMarker(markers: readonly Marker[], marker: Marker): Marker[] {
  return markers.filter(other => other !== marker);
}
