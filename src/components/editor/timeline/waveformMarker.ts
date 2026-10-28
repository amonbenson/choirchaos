import Konva from "konva";
import type { CreatePointMarkerOptions, PointMarker } from "peaks.js";

const LINE_WIDTH = 2;

/** A vertical line in the theme's color. The Measures lane names its measure, the timeline handles the pointer. */
class LinePointMarker implements PointMarker {
  private line?: Konva.Line;

  constructor(private readonly options: CreatePointMarkerOptions, private readonly color: string) {}

  public init(group: object): void {
    this.line = new Konva.Line({
      points: this.getLinePoints(),
      stroke: this.color,
      strokeWidth: LINE_WIDTH,
    });

    (group as Konva.Group).add(this.line);
  }

  public fitToView(): void {
    this.line?.points(this.getLinePoints());
  }

  public update(): void {}

  public destroy(): void {}

  private getLinePoints(): number[] {
    return [0, 0, 0, this.options.layer.getHeight()];
  }
}

export function createLinePointMarkerFactory(color: string): (options: CreatePointMarkerOptions) => PointMarker {
  return options => new LinePointMarker(options, color);
}
