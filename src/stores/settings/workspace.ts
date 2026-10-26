import { type DataOf, SettingsBase } from "./base";

export class PanelVisibleSettings extends SettingsBase {
  constructor(
    public readonly markers: boolean = true,
    public readonly mixer: boolean = true,
    public readonly warp: boolean = true,
  ) {
    super();
  }
}

/** Which groups of the song editor's inspector the user collapsed. */
export class InspectorCollapsedSettings extends SettingsBase {
  constructor(
    public readonly rehearsal: boolean = false,
    public readonly marker: boolean = false,
    public readonly recording: boolean = false,
    public readonly sync: boolean = false,
    public readonly boxes: boolean = false,
  ) {
    super();
  }
}

export type InspectorGroupId = keyof DataOf<InspectorCollapsedSettings>;

export class WorkspaceSettings extends SettingsBase {
  constructor(
    public readonly selectedTab: "markers" | "pdf" | "timeline" | "mixer" = "pdf",
    public readonly panelVisible: PanelVisibleSettings = new PanelVisibleSettings(),
    public readonly inspectorCollapsed: InspectorCollapsedSettings = new InspectorCollapsedSettings(),
  ) {
    super();
  }
}
