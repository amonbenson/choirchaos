import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// pdfjs-dist accesses `window` and `document` lazily (on first getDocument()
// call, not at import time). Neither exists in a Web Worker, so we shim them
// before any pdfjs call. The document shim provides OffscreenCanvas for the
// scratch canvases pdfjs creates internally during rendering (e.g. patterns,
// soft masks).
(globalThis as any).window = globalThis;
(globalThis as any).document = {
  createElement(tagName: string) {
    if (tagName === "canvas") {
      return new OffscreenCanvas(1, 1);
    }

    return null;
  },
};

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── Message types (exported for use in pdfRenderer.ts) ───────────────────────

// WorkerRequest is WorkerInMessage without the id field, defined as a proper
// union so callers can pass variant-specific properties (e.g. `page`) without
// TypeScript collapsing them via Omit<union, key>.
export type WorkerRequest
  = | { type: "load"; url: string }
    | { type: "render"; url: string; page: number };

export type WorkerInMessage
  = | (WorkerRequest & { id: number });

export type WorkerOutMessage
  = | { type: "loaded"; id: number; numPages: number }
    | { type: "rendered"; id: number; bitmap: ImageBitmap; bitmapLow: ImageBitmap }
    | { type: "error"; id: number; error: string };

// ── Constants ────────────────────────────────────────────────────────────────

const SCALE_HIGH = 2.0;
const SCALE_LOW = 0.5;

// ── Document cache ───────────────────────────────────────────────────────────

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

function getDoc(url: string): Promise<PDFDocumentProxy> {
  if (!docCache.has(url)) {
    docCache.set(url, pdfjsLib.getDocument({ url }).promise);
  }

  return docCache.get(url)!;
}

// ── Message handler ──────────────────────────────────────────────────────────

// DedicatedWorkerGlobalScope is in the "webworker" lib, which conflicts with the
// project's "dom" lib. Define only what we need here instead.
type WorkerGlobal = {
  onmessage: ((e: MessageEvent<any>) => any) | null;
  postMessage(message: any, transfer?: Transferable[]): void;
};
const workerSelf = self as unknown as WorkerGlobal;

workerSelf.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === "load") {
    try {
      const doc = await getDoc(msg.url);
      workerSelf.postMessage({ type: "loaded", id: msg.id, numPages: doc.numPages } satisfies WorkerOutMessage);
    } catch (err) {
      workerSelf.postMessage({ type: "error", id: msg.id, error: String(err) } satisfies WorkerOutMessage);
    }

    return;
  }

  if (msg.type === "render") {
    try {
      const doc = await getDoc(msg.url);
      const pageProxy = await doc.getPage(msg.page + 1);

      const vpHigh = pageProxy.getViewport({ scale: SCALE_HIGH });
      const vpLow = pageProxy.getViewport({ scale: SCALE_LOW });

      // Render high-res version
      const canvasHigh = new OffscreenCanvas(Math.ceil(vpHigh.width), Math.ceil(vpHigh.height));
      const ctxHigh = canvasHigh.getContext("2d")!;
      await pageProxy.render({ canvasContext: ctxHigh as unknown as CanvasRenderingContext2D, canvas: canvasHigh as unknown as HTMLCanvasElement, viewport: vpHigh }).promise;

      // Render low-res version (used for mipmap when many pages are visible)
      const canvasLow = new OffscreenCanvas(Math.ceil(vpLow.width), Math.ceil(vpLow.height));
      const ctxLow = canvasLow.getContext("2d")!;
      await pageProxy.render({ canvasContext: ctxLow as unknown as CanvasRenderingContext2D, canvas: canvasLow as unknown as HTMLCanvasElement, viewport: vpLow }).promise;

      pageProxy.cleanup();

      // transferToImageBitmap() moves pixel data to GPU memory and frees the
      // OffscreenCanvas backing store, keeping memory usage low.
      const bitmap = canvasHigh.transferToImageBitmap();
      const bitmapLow = canvasLow.transferToImageBitmap();

      const out: WorkerOutMessage = { type: "rendered", id: msg.id, bitmap, bitmapLow };
      workerSelf.postMessage(out, [bitmap, bitmapLow]);
    } catch (err) {
      workerSelf.postMessage({ type: "error", id: msg.id, error: String(err) } satisfies WorkerOutMessage);
    }
  }
};
