export default class AudioPlayer {
  private _sources: AudioBufferSourceNode[] = [];
  private _gainNodes: GainNode[];
  private _compressors: DynamicsCompressorNode[];
  private _gainValues: number[];

  private _refContextTime = 0;
  private _refPosition = 0;
  private _playing = false;

  constructor(private _context: AudioContext, private _buffers: AudioBuffer[]) {
    this._gainNodes = _buffers.map(() => _context.createGain());
    this._gainValues = _buffers.map(() => 1);

    this._compressors = _buffers.map((_, i) => {
      const c = _context.createDynamicsCompressor();
      c.threshold.value = -4;
      c.knee.value = 2;
      c.ratio.value = 1.5;
      c.attack.value = 0.001;
      c.release.value = 0.1;
      this._gainNodes[i]!.connect(c);
      return c;
    });
  }

  get position(): number {
    if (this._playing) {
      return this._refPosition + (this._context.currentTime - this._refContextTime);
    }

    return this._refPosition;
  }

  setGain(trackIndex: number, gain: number): void {
    if (this._gainValues[trackIndex] === gain) {
      return;
    }

    console.log(`Setting gain for track ${trackIndex} to ${gain}`);

    this._gainValues[trackIndex] = gain;
    this._gainNodes[trackIndex]?.gain.setTargetAtTime(gain, this._context.currentTime, 0.02);
  }

  play(): void {
    if (this._playing) {
      return;
    }

    this._refContextTime = this._context.currentTime;
    this._sources = this._buffers.map((buffer, i) => {
      const src = this._context.createBufferSource();
      src.buffer = buffer;
      src.connect(this._gainNodes[i]!);
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

  connect(destination: AudioNode): void {
    this._compressors.forEach(c => c.connect(destination));
  }
}
