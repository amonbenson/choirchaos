import { DEFAULT_TRACK_GAIN } from "@/core/models/track";

import { isPlainObject, SettingsBase } from "./base";

export type TrackMixerEntry = {
  gain: number;
  mute: boolean;
  solo: boolean;
};

export type ShowMixer = Record<string, TrackMixerEntry>;

export const DEFAULT_TRACK_MIXER: Readonly<TrackMixerEntry> = {
  gain: DEFAULT_TRACK_GAIN,
  mute: false,
  solo: false,
};

export function isDefaultTrackMixer(entry: TrackMixerEntry): boolean {
  return entry.gain === DEFAULT_TRACK_GAIN && !entry.mute && !entry.solo;
}

function isTrackMixerEntry(v: unknown): v is TrackMixerEntry {
  return (
    isPlainObject(v)
    && typeof v.gain === "number"
    && typeof v.mute === "boolean"
    && typeof v.solo === "boolean"
  );
}

function parseShowMixer(raw: unknown): ShowMixer {
  if (!isPlainObject(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, TrackMixerEntry] => isTrackMixerEntry(entry[1])),
  );
}

export class MixerSettings extends SettingsBase {
  constructor(
    public readonly shows: Record<string, ShowMixer> = {},
  ) {
    super();
  }

  // Overrides the generic fromPartial to validate each track entry individually.
  // Invalid entries are dropped rather than failing the whole load.
  override fromPartial(raw: unknown): this {
    if (!isPlainObject(raw) || !isPlainObject(raw.shows)) {
      return this;
    }

    const shows = Object.fromEntries(
      Object.entries(raw.shows)
        .map(([showId, tracks]): [string, ShowMixer] => [showId, parseShowMixer(tracks)])
        .filter(([, tracks]) => Object.keys(tracks).length > 0),
    );
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { shows }) as this;
  }
}
