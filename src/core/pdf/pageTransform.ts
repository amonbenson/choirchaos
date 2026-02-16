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

  public pageToViewport(pc: PageCoordinate): ViewportCoordinate {
    const pViewport = pc.p * (Math.SQRT1_2 + PageTransform.PAGE_GAP);
    return {
      x: pc.x * Math.SQRT1_2 + pViewport,
      y: pc.y,
    };
  }

  public viewportToPage(vc: ViewportCoordinate): PageCoordinate {
    const p = Math.floor(vc.x / (Math.SQRT1_2 + PageTransform.PAGE_GAP));
    const pViewport = p * (Math.SQRT1_2 + PageTransform.PAGE_GAP);
    return {
      p,
      x: (vc.x - pViewport) / Math.SQRT1_2,
      y: vc.y,
    };
  }

  public pageToScreen(pc: PageCoordinate, scale: boolean = false): ScreenCoordinate {
    const vc = this.pageToViewport(pc);

    if (scale) {
      vc.x -= pc.p * (Math.SQRT1_2 + PageTransform.PAGE_GAP);
    }

    return this.viewportToScreen(vc, scale);
  }

  public screenToPage(sc: ScreenCoordinate, scale: boolean = false): PageCoordinate {
    const vc = this.screenToViewport(sc, scale);
    const pc = this.viewportToPage(vc);

    if (scale) {
      pc.x += pc.p * (Math.SQRT1_2 + PageTransform.PAGE_GAP) / Math.SQRT1_2;
    }

    return pc;
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

  public getVisiblePageRange(screenWidth: number, numPages: number): [number, number] {
    const left = this.screenToPage({ x: 0, y: 0 });
    const right = this.screenToPage({ x: screenWidth, y: 0 });

    return [Math.max(0, left.p), Math.min(numPages, right.p + 1)];
  }

  public contains(pc: PageCoordinate, screenWidth: number, screenHeight: number) {
    const sc = this.pageToScreen(pc);

    return sc.x >= 0 && sc.x < screenWidth && sc.y >= 0 && sc.y < screenHeight;
  }
}
