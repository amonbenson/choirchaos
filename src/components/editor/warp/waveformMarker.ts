import Konva from "konva";
import type { CreatePointMarkerOptions, PointMarker, PointOptions } from "peaks.js";

export type MarkerColors = {
  background: string;
  text: string;
};

const LABEL_FONT_SIZE = 11;
const LABEL_PADDING = 4;
const LINE_WIDTH = 2;

/** A vertical line with a label chip at the top, drawn in the theme's colors. The timeline handles the pointer. */
class LabelledPointMarker implements PointMarker {
  private line?: Konva.Line;
  private label?: Konva.Label;
  private tag?: Konva.Tag;
  private text?: Konva.Text;

  constructor(private readonly options: CreatePointMarkerOptions, private readonly colors: MarkerColors) {}

  public init(group: object): void {
    const konvaGroup = group as Konva.Group;
    const { fontFamily, point } = this.options;

    this.line = new Konva.Line({
      points: this.getLinePoints(),
      stroke: this.colors.background,
      strokeWidth: LINE_WIDTH,
    });

    this.tag = new Konva.Tag({ fill: this.colors.background, cornerRadius: 4 });
    this.text = new Konva.Text({
      text: point.labelText ?? "",
      fontFamily,
      fontSize: LABEL_FONT_SIZE,
      fontStyle: "bold",
      fill: this.colors.text,
      padding: LABEL_PADDING,
    });
    this.label = new Konva.Label({ x: 0, y: 0 });
    this.label.add(this.tag);
    this.label.add(this.text);
    this.centerLabel();

    konvaGroup.add(this.line);
    konvaGroup.add(this.label);
  }

  public fitToView(): void {
    this.line?.points(this.getLinePoints());
  }

  public update(options: Partial<PointOptions>): void {
    if (options.labelText !== undefined) {
      this.text?.text(options.labelText);
      this.centerLabel();
    }
  }

  public destroy(): void {}

  private getLinePoints(): number[] {
    return [0, 0, 0, this.options.layer.getHeight()];
  }

  private centerLabel(): void {
    this.label?.offsetX(Math.round((this.label.width() ?? 0) / 2));
  }
}

export function createLabelledPointMarkerFactory(colors: MarkerColors): (options: CreatePointMarkerOptions) => PointMarker {
  return options => new LabelledPointMarker(options, colors);
}
