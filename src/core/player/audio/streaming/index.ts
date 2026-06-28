import Mp3Decoder from "./mp3/index";
import type { StreamingPlayerOptions } from "./player";
import StreamingAudioPlayer from "./player";

export type { StreamingPlayerOptions };
export { default as StreamingAudioPlayer } from "./player";

function extensionOf(url: string): string {
  return url.split("?")[0]!.split(".").pop()!.toLowerCase();
}

export async function createStreamingPlayer(
  context: AudioContext,
  url: string,
  options: StreamingPlayerOptions = {},
): Promise<StreamingAudioPlayer> {
  const ext = extensionOf(url);

  switch (ext) {
    case "mp3":
      return StreamingAudioPlayer.create(context, url, new Mp3Decoder(), options);
    default:
      throw new Error(`No streaming decoder for file type: .${ext}`);
  }
}
