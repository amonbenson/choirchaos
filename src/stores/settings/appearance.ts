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

export class AppearanceSettings extends SettingsBase {
  constructor(
    public readonly theme: "system" | "light" | "dark" = "system",
    public readonly mergeAccompaniment: boolean = true,
    public readonly transportButtonVisible: TransportButtonSettings = new TransportButtonSettings(),
  ) {
    super();
  }
}
