import { onScopeDispose, type Ref, ref, watch } from "vue";

import type { PdfPageStatus } from "@/core/pdf/pdfRenderer";
import { usePdfRendererStore } from "@/stores/pdfRenderer";

export type PdfPageData = {
  status: "none" | "rendering" | "renderError" | "ready";
  bitmap?: ImageBitmap;
  bitmapLow?: ImageBitmap;
};

export type PdfStatus = "none" | "loading" | "loadError" | "ready";

// Reactive page state for a given PDF URL, backed by the shared PdfRenderer.
// Handles loading, rendering, and live status updates.
export function usePdfPages(url: Ref<string | undefined>, options?: { onUpdate?: () => void }): {
  pages: Ref<PdfPageData[]>;
  documentStatus: Ref<PdfStatus>;
} {
  const pdfRendererStore = usePdfRendererStore();

  const documentStatus = ref<PdfStatus>("none");
  const pages = ref<PdfPageData[]>([]);

  function updateState(): void {
    if (!url.value) {
      documentStatus.value = "none";
      pages.value = [];
      return;
    }

    const pageZeroStatus = pdfRendererStore.getStatus(url.value, 0);
    documentStatus.value = ["none", "loading", "loadError"].includes(pageZeroStatus)
      ? (pageZeroStatus as "none" | "loading" | "loadError")
      : "ready";

    const numPages = pdfRendererStore.getNumPages(url.value);
    pages.value = Array(numPages).fill(null).map((_, i) => {
      const pdfPage = pdfRendererStore.getRenderedPage(url.value!, i);
      return {
        status: pdfRendererStore.getStatus(url.value!, i) as PdfPageData["status"],
        bitmap: pdfPage?.bitmap,
        bitmapLow: pdfPage?.bitmapLow,
      };
    });
  }

  // Load and render all pages whenever the URL changes (immediate so a URL set
  // before mount — e.g. via pendingShow — is not missed).
  watch(url, async () => {
    const currentUrl = url.value;
    if (!currentUrl) {
      return;
    }

    await pdfRendererStore.load(currentUrl);

    if (currentUrl !== url.value) {
      return;
    }

    const numPages = pdfRendererStore.getNumPages(url.value) ?? 0;
    await Promise.all(Array(numPages).fill(null).map((_, i) => pdfRendererStore.render(currentUrl, i)));
  }, { immediate: true });

  // Batch rapid status events (e.g. multiple pages rendering simultaneously) into
  // one state update per animation frame
  let pendingId: number | undefined;
  pdfRendererStore.onPageStatusUpdate((_status: PdfPageStatus, eventUrl: string) => {
    if (eventUrl !== url.value) {
      return;
    }

    if (pendingId !== undefined) {
      cancelAnimationFrame(pendingId);
    }

    pendingId = requestAnimationFrame(() => {
      pendingId = undefined;
      updateState();
      options?.onUpdate?.();
    });
  });
  onScopeDispose(() => {
    if (pendingId !== undefined) {
      cancelAnimationFrame(pendingId);
    }
  });

  return { pages, documentStatus };
}
