export type StreamInfo = {
  audioStartOffset: number;
  totalAudioBytes: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
};

export interface Decoder {
  readonly headerBytes: number;
  parseHeader(data: Uint8Array): StreamInfo | null;
  seekOffset(info: StreamInfo, targetSeconds: number): number;
  // Raw bytes to prepend from the previous chunk so the decoder has enough
  // inter-frame context.  Returns 0 for formats without inter-frame dependencies.
  contextBytes(info: StreamInfo): number;
  // How many of the decoded samples to discard from the start of a chunk that
  // was decoded with context bytes prepended.
  contextSamples(contextBytes: number, info: StreamInfo): number;
}
