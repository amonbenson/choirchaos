import { SettingsBase } from "./base";

export class PanelVisibleSettings extends SettingsBase {
  constructor(
    public readonly markers: boolean = true,
    public readonly mixer: boolean = true,
    public readonly timeline: boolean = true,
  ) {
    super();
  }
}

export class WorkspaceSettings extends SettingsBase {
  constructor(
    public readonly selectedTab: "markers" | "score" | "timeline" | "mixer" = "score",
    public readonly panelVisible: PanelVisibleSettings = new PanelVisibleSettings(),
  ) {
    super();
  }
}
