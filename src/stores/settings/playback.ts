import { SettingsBase } from "./base";

export class PlaybackSettings extends SettingsBase {
  constructor(
    public readonly speed: number = 1.0,
    public readonly transposition: number = 0,
    public readonly segueEnabled: boolean = true,
    public readonly vampsEnabled: boolean = true,
  ) {
    super();
  }
}
