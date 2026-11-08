import { OpusDecodingService, type WorkerRequest, type WorkerResponse } from "./opusDecoding";

const service = new OpusDecodingService();

function reply(response: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const result = data.kind === "decode" ? await service.decode(data.request) : await service.buildWaveform(data.request);
    reply({ id: data.id, result }, [result instanceof ArrayBuffer ? result : result.buffer]);
  } catch (error) {
    reply({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
