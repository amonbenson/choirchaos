import { SettingsBase } from "./base";

export class PanelVisibleSettings extends SettingsBase {
  constructor(
    public readonly markers: boolean = true,
    public readonly mixer: boolean = true,
    public readonly warp: boolean = true,
  ) {
    super();
  }
}

export class WorkspaceSettings extends SettingsBase {
  constructor(
    public readonly selectedTab: "markers" | "pdf" | "timeline" | "mixer" = "pdf",
    public readonly panelVisible: PanelVisibleSettings = new PanelVisibleSettings(),
  ) {
    super();
  }
}
