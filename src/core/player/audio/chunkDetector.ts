const WINDOW_SIZE = 256;
const SILENCE_THRESHOLD = 0.001;

export type AudioChunk = {
  sampleOffset: number;
  audioBuffer: AudioBuffer;
};

export function detectChunks(
  buffer: AudioBuffer,
  context: BaseAudioContext,
  minSilenceSeconds = 0.5,
  padSeconds = 0.05,
): AudioChunk[] {
  const { sampleRate, length: nSamples, numberOfChannels } = buffer;
  const minSilenceWindows = Math.ceil((minSilenceSeconds * sampleRate) / WINDOW_SIZE);
  const padSamples = Math.floor(padSeconds * sampleRate);
  const numWindows = Math.ceil(nSamples / WINDOW_SIZE);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numberOfChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  const silent = new Uint8Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const start = w * WINDOW_SIZE;
    const end = Math.min(start + WINDOW_SIZE, nSamples);
    let peak = 0;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const data = channelData[ch]!;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(data[i]!);
        if (abs > peak) {
          peak = abs;
        }
      }
    }

    silent[w] = peak < SILENCE_THRESHOLD ? 1 : 0;
  }

  const runs: Array<{ startW: number; endW: number }> = [];
  let runStart = -1;
  for (let w = 0; w <= numWindows; w++) {
    const isSilent = w === numWindows || silent[w] === 1;
    if (!isSilent && runStart === -1) {
      runStart = w;
    } else if (isSilent && runStart !== -1) {
      runs.push({ startW: runStart, endW: w });
      runStart = -1;
    }
  }

  const merged: typeof runs = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && run.startW - prev.endW < minSilenceWindows) {
      prev.endW = run.endW;
    } else {
      merged.push({ ...run });
    }
  }

  return merged.map(({ startW, endW }) => {
    const rawStart = startW * WINDOW_SIZE;
    const rawEnd = Math.min(endW * WINDOW_SIZE, nSamples);
    const paddedStart = Math.max(0, rawStart - padSamples);
    const paddedEnd = Math.min(nSamples, rawEnd + padSamples);
    const chunkLength = paddedEnd - paddedStart;

    const mono = context.createBuffer(1, chunkLength, sampleRate);
    const dest = mono.getChannelData(0);

    if (numberOfChannels === 1) {
      dest.set(channelData[0]!.subarray(paddedStart, paddedEnd));
    } else {
      const scale = 1 / numberOfChannels;
      for (let i = 0; i < chunkLength; i++) {
        let sum = 0;
        for (let ch = 0; ch < numberOfChannels; ch++) {
          sum += channelData[ch]![paddedStart + i]!;
        }

        dest[i] = sum * scale;
      }
    }

    return { sampleOffset: paddedStart, audioBuffer: mono };
  });
}
