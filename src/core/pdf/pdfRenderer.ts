import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "/js/pdf.worker.min.mjs?url";
import JobCache from "./jobCache";
import EventEmitter from "events";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PdfPageStatus = "none" | "loading" | "loadError" | "rendering" | "renderError" | "ready";

export type ImageDataUrl = string;

type PdfPage = {
  canvas: HTMLCanvasElement;
  canvasLow: HTMLCanvasElement;
}

type PdfDocument = {
  proxy: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  pages: JobCache<PdfPage, number, [PdfDocument, number]>;
};

export class PdfRenderer extends EventEmitter {
  private docs: JobCache<PdfDocument>;

  constructor() {
    super();

    // setup document cache with callback forwarding
    this.docs = new JobCache();
    this.docs.on("run", url => this.emit("statusChanged", "loading", url, undefined));
    this.docs.on("error", url => this.emit("statusChanged", "loadError", url, undefined));
  }

  private async loadDocument(url: string): Promise<PdfDocument> {
    // load the pdf document
    const task = pdfjsLib.getDocument({ url });
    const proxy = await task.promise;

    // setup page cache with callback forwarding (limit concurrent renders to avoid UI overload)
    const pages: JobCache<PdfPage, number, [PdfDocument, number]> = new JobCache(3);
    pages.on("run", page => this.emit("statusChanged", "rendering", url, page));
    pages.on("success", page => this.emit("statusChanged", "ready", url, page));
    pages.on("error", page => this.emit("statusChanged", "renderError", url, page));

    return {
      proxy,
      numPages: proxy.numPages,
      pages,
    };
  }

  private async renderPage(doc: PdfDocument, page: number): Promise<PdfPage> {
    // get the page and viewport (note that page must be 1-indexed)
    const pageProxy = await doc.proxy.getPage(page + 1);
    const viewport = pageProxy.getViewport({ scale: 2.0 });
    const viewportLow = pageProxy.getViewport({ scale: 0.5 });

    // setup canvases
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const canvasLow = document.createElement("canvas");
    canvasLow.width = viewportLow.width;
    canvasLow.height = viewportLow.height;

    const canvasContext = canvas.getContext("2d");
    const canvasContextLow = canvasLow.getContext("2d");
    if (!canvasContext || !canvasContextLow) {
      throw new Error("Failed to get canvas context");
    }

    // invoke the render task
    const task = pageProxy.render({
      canvasContext,
      canvas,
      viewport,
    });
    await task.promise;

    // render a lower version for mipmapping (when zooming out)
    const taskLow = pageProxy.render({
      canvasContext: canvasContextLow,
      canvas: canvasLow,
      viewport: viewportLow,
    });
    await taskLow.promise;

    // free page resources
    pageProxy.cleanup();

    console.log(`Finished rendering page ${page}`);

    return {
      canvas,
      canvasLow,
    };
  }

  public async load(url: string): Promise<void> {
    // invoke the document loader
    await this.docs.get(url, (...params) => this.loadDocument(...params), url);
  }

  public async render(url: string, page: number): Promise<PdfPage> {
    // resolve the document and the page
    const doc = await this.docs.get(url, (...params) => this.loadDocument(...params), url);
    return await doc.pages.get(page, (...params) => this.renderPage(...params), doc, page);
  }

  public getNumPages(url: string): number | undefined {
    return this.docs.getCached(url)?.numPages;
  }

  public getRenderedPage(url: string, page: number): PdfPage | undefined {
    // get cached render results
    return this.docs.getCached(url)?.pages.getCached(page);
  }

  public getStatus(url: string, page: number): PdfPageStatus {
    // check document status
    const docStatus = this.docs.getJobStatus(url);
    switch (docStatus) {
      case "none": return "none";
      case "running": return "loading";
      case "error": return "loadError";
    }

    // check page status
    const doc = this.docs.getCached(url)!;
    const pageStatus = doc.pages.getJobStatus(page);
    switch (pageStatus) {
      case "none": return "none";
      case "running": return "rendering";
      case "error": return "renderError";
    }

    return "ready";
  }
}
