// Audio playback engine stub
export class AudioEngine {
  private ctx: AudioContext | null = null;

  public init(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }
}
