import { AudioContextManager } from '@/audio/engine';

export type TimeUpdateListener = (currentTime: number) => void;
export type PlaybackStateListener = (isPlaying: boolean) => void;

/**
 * Dedicated preview player for auditioning tracks and verifying beat grid alignment with metronome.
 */
export class AuditionPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode;

  private isPlaying = false;
  private startedAtAudioTime = 0;
  private pausedOffsetSec = 0;

  private bpm = 120;
  private firstBeatSec = 0;
  private metronomeEnabled = false;

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeatIndex = 0;

  private timeListeners = new Set<TimeUpdateListener>();
  private stateListeners = new Set<PlaybackStateListener>();

  constructor() {
    this.ctx = AudioContextManager.getInstance().getContext();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0.8;
    this.gainNode.connect(this.ctx.destination);
  }

  public setBuffer(buffer: AudioBuffer, bpm = 120, firstBeatSec = 0): void {
    this.stop();
    this.buffer = buffer;
    this.bpm = bpm;
    this.firstBeatSec = firstBeatSec;
    this.pausedOffsetSec = 0;
  }

  public updateBeatGrid(bpm: number, firstBeatSec: number): void {
    this.bpm = bpm;
    this.firstBeatSec = firstBeatSec;
  }

  public setMetronome(enabled: boolean): void {
    this.metronomeEnabled = enabled;
  }

  public get isMetronomeActive(): boolean {
    return this.metronomeEnabled;
  }

  public async play(startOffsetSec?: number): Promise<void> {
    if (!this.buffer) return;
    await AudioContextManager.getInstance().ensureRunning();

    if (this.isPlaying) {
      this.pause();
    }

    const offset = startOffsetSec !== undefined ? startOffsetSec : this.pausedOffsetSec;
    const clampedOffset = Math.max(0, Math.min(this.buffer.duration, offset));

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gainNode);

    source.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.pausedOffsetSec = 0;
        this.stopSync();
        this.notifyState();
      }
    };

    const now = this.ctx.currentTime;
    source.start(now, clampedOffset);

    this.source = source;
    this.startedAtAudioTime = now;
    this.pausedOffsetSec = clampedOffset;
    this.isPlaying = true;

    // Calculate next beat to click
    const beatInterval = 60 / this.bpm;
    this.nextBeatIndex = Math.ceil((clampedOffset - this.firstBeatSec) / beatInterval);

    this.startSync();
    this.notifyState();
  }

  public pause(): void {
    if (!this.isPlaying) return;

    this.pausedOffsetSec = this.getCurrentTime();
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
      } catch {
        // Ignore stop errors
      }
      this.source = null;
    }

    this.isPlaying = false;
    this.stopSync();
    this.notifyState();
  }

  public stop(): void {
    this.pause();
    this.pausedOffsetSec = 0;
    this.notifyTime(0);
  }

  public seek(targetSec: number): void {
    const wasPlaying = this.isPlaying;
    this.pause();
    this.pausedOffsetSec = Math.max(0, Math.min(this.duration, targetSec));
    this.notifyTime(this.pausedOffsetSec);

    if (wasPlaying) {
      void this.play(this.pausedOffsetSec);
    }
  }

  public getCurrentTime(): number {
    if (!this.isPlaying) return this.pausedOffsetSec;
    const elapsed = this.ctx.currentTime - this.startedAtAudioTime;
    return Math.min(this.duration, this.pausedOffsetSec + elapsed);
  }

  public get duration(): number {
    return this.buffer ? this.buffer.duration : 0;
  }

  public get playing(): boolean {
    return this.isPlaying;
  }

  private startSync(): void {
    this.stopSync();
    this.syncTimer = setInterval(() => {
      const pos = this.getCurrentTime();
      this.notifyTime(pos);

      if (this.metronomeEnabled && this.isPlaying) {
        this.scheduleMetronomeClicks();
      }
    }, 50);
  }

  private stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private scheduleMetronomeClicks(): void {
    const now = this.ctx.currentTime;
    const currentTrackPos = this.getCurrentTime();
    const beatInterval = 60 / this.bpm;
    const lookaheadSec = 0.2;

    while (true) {
      const beatTimeInTrack = this.firstBeatSec + this.nextBeatIndex * beatInterval;
      if (beatTimeInTrack < currentTrackPos) {
        this.nextBeatIndex += 1;
        continue;
      }
      if (beatTimeInTrack > currentTrackPos + lookaheadSec) {
        break;
      }

      // Schedule click on future audio clock
      const clickAudioTime = now + (beatTimeInTrack - currentTrackPos);
      const isDownbeat = (((this.nextBeatIndex % 4) + 4) % 4) === 0;
      this.playClickAtTime(clickAudioTime, isDownbeat);

      this.nextBeatIndex += 1;
    }
  }

  private playClickAtTime(audioTime: number, isDownbeat: boolean): void {
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isDownbeat ? 1200 : 800, audioTime);

      gain.gain.setValueAtTime(0.001, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.3, audioTime + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioTime + (isDownbeat ? 0.025 : 0.015));

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(audioTime);
      osc.stop(audioTime + 0.03);
    } catch {
      // Ignore click scheduling errors
    }
  }

  public onTimeUpdate(listener: TimeUpdateListener): () => void {
    this.timeListeners.add(listener);
    return () => this.timeListeners.delete(listener);
  }

  public onStateChange(listener: PlaybackStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyTime(time: number): void {
    for (const listener of this.timeListeners) {
      listener(time);
    }
  }

  private notifyState(): void {
    for (const listener of this.stateListeners) {
      listener(this.isPlaying);
    }
  }

  public destroy(): void {
    this.stop();
    this.timeListeners.clear();
    this.stateListeners.clear();
    try {
      this.gainNode.disconnect();
    } catch {
      // Disconnect error ignored
    }
  }
}

export const auditionPlayer = new AuditionPlayer();
