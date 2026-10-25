import { SettingsBase } from "./base";

export type EditorTab = "details" | "markers" | "measures" | "sections";

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
    public readonly selectedTab: "markers" | "pdf" | "mixer" = "pdf",
    public readonly editorTab: EditorTab = "details",
    public readonly panelVisible: PanelVisibleSettings = new PanelVisibleSettings(),
  ) {
    super();
  }
}
