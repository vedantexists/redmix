import { equalPowerGains } from '@/shared/math';

export type DeckId = 'A' | 'B';
export type DeckPlaybackState = 'idle' | 'ready' | 'playing' | 'paused' | 'stopped';

/**
 * AudioContext wrapper managing suspended state and lifecycle.
 */
export class AudioContextManager {
  private static instance: AudioContextManager | null = null;
  private ctx: AudioContext | null = null;

  public static getInstance(): AudioContextManager {
    if (!AudioContextManager.instance) {
      AudioContextManager.instance = new AudioContextManager();
    }
    return AudioContextManager.instance;
  }

  public getContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  /**
   * Resumes AudioContext if suspended (required by browser autoplay policies on user gesture).
   */
  public async ensureRunning(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  public get currentTime(): number {
    return this.getContext().currentTime;
  }

  public async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.getContext();
    // Use clone to prevent detached array buffer errors if re-decoded
    const copy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(copy);
  }
}

/**
 * Deck class representing an independent audio playback deck.
 * Audio graph: AudioBufferSourceNode -> trackGain -> lowFilter -> deckGain -> outputDestination
 */
export class Deck {
  public readonly id: DeckId;
  private ctx: AudioContext;
  private outputDestination: AudioNode;

  private buffer: AudioBuffer | null = null;
  public trackId: string | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  // Audio Processing Nodes
  public readonly trackGain: GainNode;
  public readonly lowFilter: BiquadFilterNode;
  public readonly deckGain: GainNode;

  // Playback Timing State
  private playbackState: DeckPlaybackState = 'idle';
  private startedAtAudioTime = 0;
  private pausedOffsetSec = 0;
  private playbackRate = 1.0;

  constructor(id: DeckId, ctx: AudioContext, outputDestination: AudioNode) {
    this.id = id;
    this.ctx = ctx;
    this.outputDestination = outputDestination;

    // Create gain and filter nodes
    this.trackGain = this.ctx.createGain();
    this.lowFilter = this.ctx.createBiquadFilter();
    this.lowFilter.type = 'highpass';
    this.lowFilter.frequency.value = 10; // Neutral pass-through initially

    this.deckGain = this.ctx.createGain();
    // Default: Deck A full volume, Deck B silent initially
    this.deckGain.gain.value = id === 'A' ? 1.0 : 0.0;

    // Connect node chain: trackGain -> lowFilter -> deckGain -> destination
    this.trackGain.connect(this.lowFilter);
    this.lowFilter.connect(this.deckGain);
    this.deckGain.connect(this.outputDestination);
  }

  public get state(): DeckPlaybackState {
    return this.playbackState;
  }

  public get duration(): number {
    return this.buffer ? this.buffer.duration : 0;
  }

  /**
   * Load decoded AudioBuffer into this deck.
   */
  public loadBuffer(buffer: AudioBuffer, trackId: string): void {
    this.stop();
    this.buffer = buffer;
    this.trackId = trackId;
    this.pausedOffsetSec = 0;
    this.playbackState = 'ready';
  }

  /**
   * Plays the loaded buffer. Starts from current position or specified offset.
   */
  public async play(offsetSec?: number): Promise<void> {
    if (!this.buffer) {
      throw new Error(`Deck ${this.id}: Cannot play without loaded audio buffer.`);
    }

    await AudioContextManager.getInstance().ensureRunning();

    if (this.playbackState === 'playing') {
      return;
    }

    if (offsetSec !== undefined) {
      this.pausedOffsetSec = Math.max(0, Math.min(this.duration, offsetSec));
    }

    // Stop and disconnect previous source if any
    this.cleanupSource();

    // Create new buffer source node
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.trackGain);

    source.onended = () => {
      if (this.playbackState === 'playing') {
        this.playbackState = 'stopped';
        this.pausedOffsetSec = 0;
      }
    };

    const startTime = this.ctx.currentTime;
    source.start(startTime, this.pausedOffsetSec);

    this.sourceNode = source;
    this.startedAtAudioTime = startTime;
    this.playbackState = 'playing';
  }

  /**
   * Pauses playback and saves current position.
   */
  public pause(): void {
    if (this.playbackState !== 'playing') {
      return;
    }

    this.pausedOffsetSec = this.getCurrentTime();
    this.cleanupSource();
    this.playbackState = 'paused';
  }

  /**
   * Seeks to a specific time in seconds.
   */
  public seek(offsetSec: number): void {
    const clampedOffset = Math.max(0, Math.min(this.duration, offsetSec));
    const wasPlaying = this.playbackState === 'playing';

    if (wasPlaying) {
      this.cleanupSource();
    }

    this.pausedOffsetSec = clampedOffset;

    if (wasPlaying) {
      this.play(clampedOffset);
    }
  }

  /**
   * Stops playback and resets position to 0.
   */
  public stop(): void {
    this.cleanupSource();
    this.pausedOffsetSec = 0;
    this.playbackState = this.buffer ? 'ready' : 'idle';
  }

  /**
   * Returns current playback position in seconds, calculated accurately from audio clock.
   */
  public getCurrentTime(): number {
    if (this.playbackState === 'playing') {
      const elapsed = (this.ctx.currentTime - this.startedAtAudioTime) * this.playbackRate;
      return Math.min(this.duration, this.pausedOffsetSec + elapsed);
    }
    return this.pausedOffsetSec;
  }

  /**
   * Sets gain with scheduled linear ramp to eliminate audible clicks.
   */
  public setGain(value: number, rampDurationSec = 0.02): void {
    const clampedValue = Math.max(0, Math.min(2.0, value));
    const now = this.ctx.currentTime;
    this.deckGain.gain.cancelScheduledValues(now);
    this.deckGain.gain.setValueAtTime(this.deckGain.gain.value, now);
    this.deckGain.gain.linearRampToValueAtTime(clampedValue, now + Math.max(0.005, rampDurationSec));
  }

  /**
   * Clean up source node when stopped or paused.
   */
  private cleanupSource(): void {
    if (this.sourceNode) {
      const src = this.sourceNode;
      this.sourceNode = null;
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Ignore if already stopped
      }
      src.disconnect();
    }
  }

  /**
   * Starts playback scheduled on the audio clock at a precise future audio time.
   */
  public startAtTime(audioClockTime: number, offsetSec = 0, initialRate = 1.0): void {
    if (!this.buffer) return;
    this.cleanupSource();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    this.playbackRate = initialRate;
    source.playbackRate.setValueAtTime(initialRate, audioClockTime);
    source.connect(this.trackGain);

    source.onended = () => {
      if (this.playbackState === 'playing') {
        this.playbackState = 'stopped';
        this.pausedOffsetSec = 0;
      }
    };

    source.start(audioClockTime, offsetSec);
    this.sourceNode = source;
    this.startedAtAudioTime = audioClockTime;
    this.pausedOffsetSec = offsetSec;
    this.playbackState = 'playing';
  }

  /**
   * Stops playback scheduled at a precise future audio clock time.
   */
  public stopAtTime(audioClockTime: number): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop(audioClockTime);
      } catch {
        // Ignore if already stopped
      }
    }
  }

  /**
   * Ramps playback rate smoothly toward target rate over durationSec.
   */
  public rampPlaybackRate(targetRate: number, durationSec: number, startTime?: number): void {
    if (!this.sourceNode) return;
    const now = startTime ?? this.ctx.currentTime;
    this.sourceNode.playbackRate.cancelScheduledValues(now);
    this.sourceNode.playbackRate.setValueAtTime(this.sourceNode.playbackRate.value, now);
    this.sourceNode.playbackRate.linearRampToValueAtTime(targetRate, now + durationSec);
    this.playbackRate = targetRate;
  }

  /**
   * Sets track normalization gain with click-free linear ramp.
   */
  public setTrackGain(gain: number, rampDurationSec = 0.02): void {
    const clamped = Math.max(0, Math.min(4.0, gain));
    const now = this.ctx.currentTime;
    this.trackGain.gain.cancelScheduledValues(now);
    this.trackGain.gain.setValueAtTime(this.trackGain.gain.value, now);
    this.trackGain.gain.linearRampToValueAtTime(clamped, now + Math.max(0.005, rampDurationSec));
  }

  /**
   * Releases loaded buffer to enforce memory limit (max 2 decoded buffers).
   */
  public unloadBuffer(): void {
    this.stop();
    this.buffer = null;
    this.trackId = null;
    this.playbackState = 'idle';
  }

  public get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  public get rate(): number {
    return this.playbackRate;
  }

  /**
   * Destroys deck, disconnects all nodes, and releases buffer to prevent memory leaks.
   */
  public destroy(): void {
    this.stop();
    this.buffer = null;
    this.trackId = null;

    try {
      this.trackGain.disconnect();
      this.lowFilter.disconnect();
      this.deckGain.disconnect();
    } catch {
      // Ignore disconnect errors during teardown
    }
  }
}

/**
 * TwoDeckMixer manages dual-deck playback and equal-power crossfades.
 */
export class TwoDeckMixer {
  private ctx: AudioContext;
  public readonly masterGain: GainNode;
  public readonly deckA: Deck;
  public readonly deckB: Deck;

  constructor(customCtx?: AudioContext) {
    this.ctx = customCtx || AudioContextManager.getInstance().getContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.deckA = new Deck('A', this.ctx, this.masterGain);
    this.deckB = new Deck('B', this.ctx, this.masterGain);
  }

  public get context(): AudioContext {
    return this.ctx;
  }

  /**
   * Executes an equal-power crossfade between Deck A and Deck B across durationSec.
   * fromDeck 'A': crossfades from Deck A to Deck B.
   * fromDeck 'B': crossfades from Deck B to Deck A.
   */
  public crossfade(fromDeck: DeckId, durationSec = 4.0): void {
    const now = this.ctx.currentTime;
    const dur = Math.max(0.1, durationSec);
    const steps = 64; // Subdivide curve for smooth equal-power response without clicks
    const stepDuration = dur / steps;

    // Cancel existing scheduled ramps
    this.deckA.deckGain.gain.cancelScheduledValues(now);
    this.deckB.deckGain.gain.cancelScheduledValues(now);

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      // If from A -> B: t goes 0 -> 1. If from B -> A: t goes 1 -> 0.
      const t = fromDeck === 'A' ? progress : 1 - progress;
      const { gainA, gainB } = equalPowerGains(t);
      const targetTime = now + i * stepDuration;

      this.deckA.deckGain.gain.linearRampToValueAtTime(gainA, targetTime);
      this.deckB.deckGain.gain.linearRampToValueAtTime(gainB, targetTime);
    }
  }

  /**
   * Schedules an equal-power crossfade ahead on the audio clock starting at startAudioTime.
   */
  public scheduleCrossfade(
    fromDeck: DeckId,
    startAudioTime: number,
    durationSec = 4.0
  ): void {
    const dur = Math.max(0.1, durationSec);
    const steps = 64;
    const stepDuration = dur / steps;

    this.deckA.deckGain.gain.cancelScheduledValues(startAudioTime);
    this.deckB.deckGain.gain.cancelScheduledValues(startAudioTime);

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const t = fromDeck === 'A' ? progress : 1 - progress;
      const { gainA, gainB } = equalPowerGains(t);
      const targetTime = startAudioTime + i * stepDuration;

      this.deckA.deckGain.gain.linearRampToValueAtTime(gainA, targetTime);
      this.deckB.deckGain.gain.linearRampToValueAtTime(gainB, targetTime);
    }
  }

  /**
   * Set master volume with smooth click-free ramp.
   */
  public setMasterVolume(value: number, rampDurationSec = 0.02): void {
    const clamped = Math.max(0, Math.min(1.0, value));
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(clamped, now + rampDurationSec);
  }

  /**
   * Cleanup mixer and all child decks.
   */
  public destroy(): void {
    this.deckA.destroy();
    this.deckB.destroy();
    try {
      this.masterGain.disconnect();
    } catch {
      // Ignore disconnect error
    }
  }
}

// Global singleton mixer instance
let globalMixer: TwoDeckMixer | null = null;

export function getTwoDeckMixer(): TwoDeckMixer {
  if (!globalMixer) {
    globalMixer = new TwoDeckMixer();
  }
  return globalMixer;
}

// Backward-compatible AudioEngine alias
export const AudioEngine = TwoDeckMixer;

export * from './autoMix';
