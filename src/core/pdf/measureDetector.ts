import type { DecoderParams, MeasureDetector, MeasureResult } from "measure-detection";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { DetectedMeasure } from "../models/measureDetection";

export type MeasureDetectionStage = "loading" | "detect" | "label";

export type MeasureDetectionProgress = {
  stage: MeasureDetectionStage;
  done: number;
  total: number;
};

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Copied from pdfjs-dist by vite.config.ts, see pdfRender.worker.ts.
const pdfjsAssetsUrl = new URL(`${import.meta.env.BASE_URL}pdfjs/`, self.location.origin);

function getPdfjsAssetUrl(directory: string): string {
  return new URL(`${directory}/`, pdfjsAssetsUrl).href;
}

let detector: Promise<MeasureDetector> | undefined;

// The detector, its models and onnxruntime are several megabytes, so they are only fetched once
// someone actually runs a detection.
async function createDetector(): Promise<MeasureDetector> {
  const [{ MeasureDetector }, ort, measurenet, labelocr, decoder] = await Promise.all([
    import("measure-detection"),
    import("onnxruntime-web"),
    import("measure-detection/models/measurenet.onnx?url"),
    import("measure-detection/models/labelocr.onnx?url"),
    import("measure-detection/models/decoder.json"),
  ]);

  // onnxruntime warns through console.error whenever it keeps shape ops on the CPU, which is expected.
  ort.env.logLevel = "error";

  return MeasureDetector.create({
    models: { measurenet: measurenet.default, labelocr: labelocr.default },
    decoder: decoder.default as unknown as DecoderParams,
  });
}

function getDetector(): Promise<MeasureDetector> {
  detector ??= createDetector().catch((error) => {
    detector = undefined;
    throw error;
  });

  return detector;
}

function toDetectedMeasure(result: MeasureResult): DetectedMeasure {
  return { value: result.value, layout: result.layout, confidence: result.confidence };
}

export async function detectMeasures(
  url: string,
  onProgress?: (progress: MeasureDetectionProgress) => void,
): Promise<DetectedMeasure[]> {
  onProgress?.({ stage: "loading", done: 0, total: 1 });
  const loadingTask = pdfjsLib.getDocument({
    url,
    standardFontDataUrl: getPdfjsAssetUrl("standard_fonts"),
    cMapUrl: getPdfjsAssetUrl("cmaps"),
    wasmUrl: getPdfjsAssetUrl("wasm"),
  });

  try {
    const [measureDetector, pdf] = await Promise.all([getDetector(), loadingTask.promise]);
    const results = await measureDetector.detect(pdf, {
      onProgress: (done, total, stage) => onProgress?.({ stage, done, total }),
    });
    return results.map(toDetectedMeasure);
  } finally {
    await loadingTask.destroy();
  }
}
