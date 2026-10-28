import { type DataOf, SettingsBase } from "./base";

export class TransportButtonSettings extends SettingsBase {
  constructor(
    public readonly measure: boolean = true,
    public readonly transposition: boolean = true,
    public readonly tempo: boolean = true,
    public readonly timeSignature: boolean = false,
    public readonly vamp: boolean = true,
    public readonly segue: boolean = true,
  ) {
    super();
  }
}

export type TransportButtonKey = keyof DataOf<TransportButtonSettings>;

/** What the score shows of the arrangement while rehearsing. Editors always see all of it. */
export class ArrangementVisibleSettings extends SettingsBase {
  constructor(
    public readonly vamp: boolean = true,
    public readonly repeat: boolean = true,
    public readonly cut: boolean = true,
    public readonly marker: boolean = true,
  ) {
    super();
  }
}

export type ArrangementKey = keyof DataOf<ArrangementVisibleSettings>;

export class AppearanceSettings extends SettingsBase {
  constructor(
    public readonly theme: "system" | "light" | "dark" = "system",
    public readonly mergeAccompaniment: boolean = true,
    public readonly transportButtonVisible: TransportButtonSettings = new TransportButtonSettings(),
    public readonly arrangementVisible: ArrangementVisibleSettings = new ArrangementVisibleSettings(),
  ) {
    super();
  }
}
