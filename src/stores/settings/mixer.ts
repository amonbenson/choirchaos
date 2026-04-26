import { isPlainObject, SettingsBase } from "./base";

export type TrackMixerEntry = {
  gain: number;
  mute: boolean;
  solo: boolean;
  highlight: boolean;
};

export const DEFAULT_TRACK_MIXER: Readonly<TrackMixerEntry> = {
  gain: 1.0,
  mute: false,
  solo: false,
  highlight: false,
};

export function isDefaultTrackMixer(entry: TrackMixerEntry): boolean {
  return entry.gain === 1.0 && !entry.mute && !entry.solo && !entry.highlight;
}

function isTrackMixerEntry(v: unknown): v is TrackMixerEntry {
  return (
    isPlainObject(v)
    && typeof v.gain === "number"
    && typeof v.mute === "boolean"
    && typeof v.solo === "boolean"
    && typeof v.highlight === "boolean"
  );
}

export class MixerSettings extends SettingsBase {
  constructor(
    public readonly tracks: Record<string, TrackMixerEntry> = {},
  ) {
    super();
  }

  // Overrides the generic fromPartial to validate each track entry individually.
  // Invalid entries are dropped rather than failing the whole load.
  override fromPartial(raw: unknown): this {
    if (!isPlainObject(raw) || !isPlainObject(raw.tracks)) {
      return this;
    }

    const tracks = Object.fromEntries(
      Object.entries(raw.tracks)
        .filter((entry): entry is [string, TrackMixerEntry] => isTrackMixerEntry(entry[1])),
    );
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { tracks }) as this;
  }
}
