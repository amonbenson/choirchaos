import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "/js/pdf.worker.min.mjs?url";
import JobCache from "./jobCache";
import EventEmitter from "events";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PdfPageStatus = "none" | "loading" | "loadError" | "rendering" | "renderError" | "ready";

export type ImageDataUrl = string;

type PdfPage = {
  // proxy: pdfjsLib.PDFPageProxy;
  canvas: HTMLCanvasElement;
  imageData: ImageDataUrl;
}

type PdfDocument = {
  proxy: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  pages: JobCache<PdfPage, number, [PdfDocument, number, number]>;
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
    console.log("PDF: start loading document:", url);

    // load the pdf document
    const task = pdfjsLib.getDocument({ url });
    const proxy = await task.promise;

    // setup page cache with callback forwarding
    const pages: JobCache<PdfPage, number, [PdfDocument, number, number]> = new JobCache();
    pages.on("run", page => this.emit("statusChanged", "rendering", url, page));
    pages.on("success", page => this.emit("statusChanged", "ready", url, page));
    pages.on("error", page => this.emit("statusChanged", "renderError", url, page));

    console.log("PDF: finished loading document:", url);

    return {
      proxy,
      numPages: proxy.numPages,
      pages,
    };
  }

  private async renderPage(doc: PdfDocument, page: number, scale: number): Promise<PdfPage> {
    console.log("PDF: start rendering page:", page);

    // get the page and viewport (note that page must be 1-indexed)
    const pageProxy = await doc.proxy.getPage(page + 1);
    const viewport = pageProxy.getViewport({ scale });

    // setup a canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) {
      throw new Error("Failed to get canvas context");
    }

    // invoke the render task
    const task = pageProxy.render({
      canvasContext,
      canvas,
      viewport,
    });
    await task.promise;

    // convert the page to a data url
    const imageData = canvas.toDataURL();

    // free page resources
    pageProxy.cleanup();

    console.log("PDF: finished rendering page:", page);

    return {
      canvas,
      imageData,
    };
  }

  public async load(url: string): Promise<void> {
    // invoke the document loader
    await this.docs.get(url, (...params) => this.loadDocument(...params), url);
  }

  public async render(url: string, page: number, scale: number = 2.0): Promise<PdfPage> {
    // resolve the document and the page
    const doc = await this.docs.get(url, (...params) => this.loadDocument(...params), url);
    return await doc.pages.get(page, (...params) => this.renderPage(...params), doc, page, scale);
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
