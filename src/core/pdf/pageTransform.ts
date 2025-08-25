import type p5 from "p5";

export type ScreenCoordinate = {
  x: number;
  y: number;
}

export type ViewportCoordinate = {
  x: number;
  y: number;
}

export type PageCoordinate = {
  p: number;
  x: number;
  y: number;
}

export default class PageTransform {
  public static PAGE_GAP = 0.02;

  constructor(
    public pan: ScreenCoordinate = { x: 0, y: 0 },
    public zoom: number = 1,
  ) {}

  public viewportToScreen(vc: ViewportCoordinate, scale: boolean = false): ScreenCoordinate {
    return {
      x: vc.x * this.zoom + (scale ? 0 : this.pan.x),
      y: vc.y * this.zoom + (scale ? 0 : this.pan.y),
    };
  }

  public screenToViewport(sc: ScreenCoordinate, scale: boolean = false): ViewportCoordinate {
    return {
      x: (sc.x - (scale ? 0 : this.pan.x)) / this.zoom,
      y: (sc.y - (scale ? 0 : this.pan.y)) / this.zoom,
    };
  }

  public pageToScreen(pc: PageCoordinate, scale: boolean = false): ScreenCoordinate {
    const pViewport = pc.p * (Math.SQRT1_2 + PageTransform.PAGE_GAP);

    const vc = {
      x: pc.x * Math.SQRT1_2 + (scale ? 0 : pViewport),
      y: pc.y,
    };
    return this.viewportToScreen(vc, scale);
  }

  public screenToPage(sc: ScreenCoordinate, scale: boolean = false): PageCoordinate {
    const vc = this.screenToViewport(sc, scale);

    const p = Math.floor(vc.x / (Math.SQRT1_2 + PageTransform.PAGE_GAP));
    const pViewport = p * (Math.SQRT1_2 + PageTransform.PAGE_GAP);

    return {
      p,
      x: (vc.x - (scale ? 0 : pViewport)) / Math.SQRT1_2,
      y: vc.y,
    };
  }

  public setZoom(zoom: number, origin?: ScreenCoordinate) {
    const previousZoom = this.zoom;
    this.zoom = zoom;

    // translate so that the origin stays at the same point
    if (origin) {
      this.pan.x += (previousZoom - this.zoom) * (origin.x - this.pan.x) / previousZoom;
      this.pan.y += (previousZoom - this.zoom) * (origin.y - this.pan.y) / previousZoom;
    }
  }

  public pushViewportTransform(s: p5) {
    s.push();

    const translation = this.viewportToScreen({ x: 0, y: 0 });
    s.translate(translation.x, translation.y);

    const scale = this.viewportToScreen({ x: 1, y: 1 }, true);
    s.scale(scale.x, scale.y);
  }

  public pushPageTransform(s: p5, p: number) {
    s.push();

    const translation = this.pageToScreen({ p, x: 0, y: 0 });
    s.translate(translation.x, translation.y);

    const scale = this.pageToScreen({ p, x: 1, y: 1 }, true);
    s.scale(scale.x, scale.y);
  }

  public getVisiblePageRange(screenWidth: number, numPages: number) {
    const left = this.screenToPage({ x: 0, y: 0 });
    const right = this.screenToPage({ x: screenWidth, y: 0 });

    return [Math.max(0, left.p), Math.min(numPages, right.p + 1)];
  }
}
