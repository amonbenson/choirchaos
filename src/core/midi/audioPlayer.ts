export default class AudioPlayer {
  private _sources: AudioBufferSourceNode[] = [];
  private _refContextTime = 0; // context.currentTime when play started
  private _refPosition = 0; // position in seconds at that moment
  private _playing = false;

  constructor(private _context: AudioContext, private _buffers: AudioBuffer[]) {}

  get position(): number {
    if (this._playing) {
      return this._refPosition + (this._context.currentTime - this._refContextTime);
    }

    return this._refPosition;
  }

  play(): void {
    if (this._playing) {
      return;
    }

    this._refContextTime = this._context.currentTime;
    this._sources = this._buffers.map((buffer) => {
      const src = this._context.createBufferSource();
      src.buffer = buffer;
      src.connect(this._context.destination);
      src.start(0, this._refPosition);
      return src;
    });
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) {
      return;
    }

    this._refPosition = this.position;
    this._sources.forEach(s => s.stop());
    this._sources = [];
    this._playing = false;
  }

  seek(seconds: number): void {
    const wasPlaying = this._playing;
    if (wasPlaying) {
      this.pause();
    }

    this._refPosition = seconds;
    if (wasPlaying) {
      this.play();
    }
  }
}
