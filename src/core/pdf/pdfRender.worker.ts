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

const RENDER_MAX_ATTEMPTS = 3;
const RENDER_RETRY_DELAY_MS = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

// createImageBitmap() is preferred over OffscreenCanvas.transferToImageBitmap()
// for two reasons:
//   1. It keeps pixel data in CPU memory and avoids GPU context-loss issues that
//      cause transferToImageBitmap() to silently return a zero-dimension bitmap
//      under memory pressure on Safari/WebKit (https://bugs.webkit.org/show_bug.cgi?id=254974).
//   2. It returns a Promise, so failures surface as exceptions rather than
//      silent empty bitmaps.
// transferToImageBitmap() is used as a fallback only if createImageBitmap()
// itself returns a zero-dimension result.
async function canvasToBitmap(canvas: OffscreenCanvas): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(canvas);
  if (bmp.width > 0 && bmp.height > 0) {
    return bmp;
  }

  bmp.close();

  const transferred = canvas.transferToImageBitmap();
  if (transferred.width === 0 || transferred.height === 0) {
    transferred.close();
    throw new Error(`Rendered canvas (${canvas.width}×${canvas.height}) produced an empty bitmap`);
  }

  return transferred;
}

// Renders a single PDF page to high- and low-res ImageBitmaps. Retries up to
// RENDER_MAX_ATTEMPTS times with exponential backoff. Each attempt re-renders
// from the page proxy so that a lost canvas context (which clears pixel data)
// is recovered rather than retried with stale data.
async function renderWithRetry(
  doc: PDFDocumentProxy,
  pageNum: number,
): Promise<{ bitmap: ImageBitmap; bitmapLow: ImageBitmap }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RENDER_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>(r => setTimeout(r, RENDER_RETRY_DELAY_MS * attempt));
    }

    const pageProxy = await doc.getPage(pageNum);
    try {
      const vpHigh = pageProxy.getViewport({ scale: SCALE_HIGH });
      const vpLow = pageProxy.getViewport({ scale: SCALE_LOW });

      const canvasHigh = new OffscreenCanvas(Math.ceil(vpHigh.width), Math.ceil(vpHigh.height));
      const ctxHigh = canvasHigh.getContext("2d");
      if (!ctxHigh) {
        throw new Error("Could not obtain 2D context (too many active contexts?)");
      }

      await pageProxy.render({ canvasContext: ctxHigh as unknown as CanvasRenderingContext2D, canvas: canvasHigh as unknown as HTMLCanvasElement, viewport: vpHigh }).promise;

      const canvasLow = new OffscreenCanvas(Math.ceil(vpLow.width), Math.ceil(vpLow.height));
      const ctxLow = canvasLow.getContext("2d");
      if (!ctxLow) {
        throw new Error("Could not obtain 2D context (too many active contexts?)");
      }

      await pageProxy.render({ canvasContext: ctxLow as unknown as CanvasRenderingContext2D, canvas: canvasLow as unknown as HTMLCanvasElement, viewport: vpLow }).promise;

      const [bitmap, bitmapLow] = await Promise.all([
        canvasToBitmap(canvasHigh),
        canvasToBitmap(canvasLow),
      ]);

      return { bitmap, bitmapLow };
    } catch (err) {
      lastError = err;
    } finally {
      pageProxy.cleanup();
    }
  }

  throw lastError;
}

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
      const { bitmap, bitmapLow } = await renderWithRetry(doc, msg.page + 1);

      const out: WorkerOutMessage = { type: "rendered", id: msg.id, bitmap, bitmapLow };
      workerSelf.postMessage(out, [bitmap, bitmapLow]);
    } catch (err) {
      workerSelf.postMessage({ type: "error", id: msg.id, error: String(err) } satisfies WorkerOutMessage);
    }
  }
};
