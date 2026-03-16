import { EventEmitter } from "events";

import JobCache from "./jobCache";
import type { WorkerInMessage, WorkerOutMessage, WorkerRequest } from "./pdfRender.worker";
import PdfRenderWorker from "./pdfRender.worker?worker";

export type PdfPageStatus = "none" | "loading" | "loadError" | "rendering" | "renderError" | "ready";

export type PdfPage = {
  bitmap: ImageBitmap;
  bitmapLow: ImageBitmap;
};

type PdfDocument = {
  url: string;
  numPages: number;
  pages: JobCache<PdfPage, number, [string, number]>;
};

type PendingEntry = {
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

export class PdfRenderer extends EventEmitter {
  private docs: JobCache<PdfDocument>;
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, PendingEntry>();

  constructor() {
    super();

    this.worker = new PdfRenderWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => this._handleWorkerMessage(e.data);
    this.worker.onerror = e => console.error("[PdfRenderer] Worker error:", e);

    this.docs = new JobCache();
    this.docs.on("run", url => this.emit("statusChanged", "loading", url, undefined));
    this.docs.on("error", url => this.emit("statusChanged", "loadError", url, undefined));
  }

  private _handleWorkerMessage(msg: WorkerOutMessage): void {
    const entry = this.pending.get(msg.id);
    if (!entry) {
      return;
    }

    this.pending.delete(msg.id);

    if (msg.type === "error") {
      entry.reject(new Error(msg.error));
    } else {
      entry.resolve(msg);
    }
  }

  private _send<R>(message: WorkerRequest): Promise<R> {
    const id = this.nextId++;
    const fullMessage = { ...message, id } as WorkerInMessage;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(fullMessage);
    });
  }

  private async loadDocument(url: string): Promise<PdfDocument> {
    const result = await this._send<{ numPages: number }>({ type: "load", url });

    const pages: JobCache<PdfPage, number, [string, number]> = new JobCache(3);
    pages.on("run", page => this.emit("statusChanged", "rendering", url, page));
    pages.on("success", page => this.emit("statusChanged", "ready", url, page));
    pages.on("error", page => this.emit("statusChanged", "renderError", url, page));

    return { url, numPages: result.numPages, pages };
  }

  private async renderPage(url: string, page: number): Promise<PdfPage> {
    const result = await this._send<{ bitmap: ImageBitmap; bitmapLow: ImageBitmap }>({ type: "render", url, page });
    return { bitmap: result.bitmap, bitmapLow: result.bitmapLow };
  }

  public async load(url: string): Promise<void> {
    await this.docs.get(url, url => this.loadDocument(url), url);
  }

  public async render(url: string, page: number): Promise<PdfPage> {
    const doc = await this.docs.get(url, url => this.loadDocument(url), url);

    // Re-emit status events for cache hits so listeners always go through the rendering -> ready phase
    if (doc.pages.getJobStatus(page) === "success") {
      this.emit("statusChanged", "rendering", url, page);
      this.emit("statusChanged", "ready", url, page);
    }

    return await doc.pages.get(page, (u, p) => this.renderPage(u, p), doc.url, page);
  }

  public getNumPages(url: string): number | undefined {
    return this.docs.getCached(url)?.numPages;
  }

  public getRenderedPage(url: string, page: number): PdfPage | undefined {
    return this.docs.getCached(url)?.pages.getCached(page);
  }

  public getStatus(url: string, page: number): PdfPageStatus {
    const docStatus = this.docs.getJobStatus(url);
    switch (docStatus) {
      case "none": return "none";
      case "running": return "loading";
      case "error": return "loadError";
    }

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
