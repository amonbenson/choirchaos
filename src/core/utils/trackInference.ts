import type { TrackClassification } from "../models/track";

export function inferTrackTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
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
