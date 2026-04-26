import { SettingsBase } from "./base";

export class PanelVisibleSettings extends SettingsBase {
  constructor(
    public readonly markers: boolean = true,
    public readonly mixer: boolean = true,
  ) {
    super();
  }
}

export class WorkspaceSettings extends SettingsBase {
  constructor(
    public readonly selectedTab: "markers" | "pdf" | "mixer" = "pdf",
    public readonly panelVisible: PanelVisibleSettings = new PanelVisibleSettings(),
  ) {
    super();
  }
}
