import type { TrackClassification } from "../models/track";

export function inferTrackTitle(filename: string): string {
  return filename
    .normalize("NFC")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(?<![\p{L}\p{N}])\p{L}/gu, c => c.toUpperCase());
}

export function inferTrackClassification(name: string): TrackClassification {
  const lowerName = name.toLowerCase();

  if (/accomp|piano|inst|band|orch|keys|guitar|bass guitar|strings|mix/.test(lowerName)) {
    return "Accompaniment";
  }

  if (/drum|perc/.test(lowerName)) {
    return "Percussion";
  }

  return "Vocal";
}
