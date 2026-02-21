import { defineStore } from "pinia";
import { onScopeDispose } from "vue";

import { type PdfPageStatus,PdfRenderer } from "@/core/pdf/pdfRenderer";

const globalPdfRenderer = new PdfRenderer();

export const usePdfRendererStore = defineStore("pdfRenderer", () => {
  function onPageStatusUpdate(cb: (status: PdfPageStatus, url: string, page: number) => void) {
    globalPdfRenderer.on("statusChanged", cb);
    onScopeDispose(() => globalPdfRenderer.off("statusChanged", cb));
  }

  return {
    load: (url: string) => globalPdfRenderer.load(url),
    render: (url: string, page: number) => globalPdfRenderer.render(url, page),
    getNumPages: (url: string) => globalPdfRenderer.getNumPages(url),
    getRenderedPage: (url: string, page: number) => globalPdfRenderer.getRenderedPage(url, page),
    getStatus: (url: string, page: number) => globalPdfRenderer.getStatus(url, page),
    onPageStatusUpdate,
    renderer: globalPdfRenderer,
  };
});
