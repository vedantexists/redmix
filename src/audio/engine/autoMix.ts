import {
  Deck,
  type DeckId,
  TwoDeckMixer,
  getTwoDeckMixer,
  AudioContextManager,
} from './index';
import { dbToGain } from '@/shared/math';
import { planTransition } from '@/audio/planner';
import type { Settings, Track, TransitionPlan } from '@/shared/types';
import { getFileFromSource } from '@/library/fileAccess';

export type AutoMixEventType =
  | 'state_changed'
  | 'track_changed'
  | 'transition_started'
  | 'transition_completed'
  | 'track_error';

export interface AutoMixEvent {
  type: AutoMixEventType;
  isPlaying?: boolean;
  track?: Track | null;
  plan?: TransitionPlan;
  trackId?: string;
  error?: string;
}

export type AutoMixListener = (event: AutoMixEvent) => void;
export type BufferLoader = (track: Track) => Promise<AudioBuffer>;

async function defaultBufferLoader(track: Track): Promise<AudioBuffer> {
  const file = await getFileFromSource(track.source);
  const ab = await file.arrayBuffer();
  return await AudioContextManager.getInstance().decodeAudioData(ab);
}

export class AutoMixEngine {
  private mixer: TwoDeckMixer;
  private bufferLoader: BufferLoader;

  private playlist: Track[] = [];
  private currentIndex = 0;
  private activeDeckId: DeckId = 'A';
  private settings: Settings;

  private isRunning = false;
  private isTransitioning = false;
  private isEndingFadeOut = false;
  private transitionEndTime: number | null = null;
  private transitionRemainingSec: number | null = null;
  private transitionElapsedSec: number | null = null;
  private currentPlan: TransitionPlan | null = null;
  private isPredecoding = false;

  private lookaheadTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<AutoMixListener>();

  constructor(options?: {
    mixer?: TwoDeckMixer;
    bufferLoader?: BufferLoader;
    settings?: Partial<Settings>;
  }) {
    this.mixer = options?.mixer || getTwoDeckMixer();
    this.bufferLoader = options?.bufferLoader || defaultBufferLoader;
    this.settings = {
      mixBars: 16,
      transitionStyle: 'bassSwap',
      maxTempoStretchPct: 6,
      keyAwareOrdering: true,
      targetLoudnessDb: -14,
      ...options?.settings,
    };
  }

  public subscribe(listener: AutoMixListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AutoMixEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public get isPlaying(): boolean {
    return this.isRunning;
  }

  public get inTransition(): boolean {
    return this.isTransitioning;
  }

  public get plan(): TransitionPlan | null {
    return this.currentPlan;
  }

  public get activeDeck(): Deck {
    return this.activeDeckId === 'A' ? this.mixer.deckA : this.mixer.deckB;
  }

  public get incomingDeck(): Deck {
    return this.activeDeckId === 'A' ? this.mixer.deckB : this.mixer.deckA;
  }

  public getCurrentTrack(): Track | null {
    return this.playlist[this.currentIndex] ?? null;
  }

  public getNextTrack(): Track | null {
    return this.playlist[this.currentIndex + 1] ?? null;
  }

  public getTimeUntilTransition(): number {
    if (!this.currentPlan || this.isTransitioning) return 0;
    const pos = this.activeDeck.getCurrentTime();
    return Math.max(0, (this.currentPlan.outgoingStartSec - pos) / this.activeDeck.rate);
  }

  public setSettings(settings: Partial<Settings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  public setPlaylist(tracks: Track[], startIndex = 0): void {
    this.stop();
    this.playlist = [...tracks];
    this.currentIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
  }

  public async play(): Promise<void> {
    if (this.isRunning) return;
    if (this.playlist.length === 0) return;

    await AudioContextManager.getInstance().ensureRunning();
    this.isRunning = true;

    if (this.activeDeck.state === 'paused') {
      const resumeAudioTime = this.mixer.context.currentTime;
      await this.activeDeck.play();
      if (this.isTransitioning) {
        await this.incomingDeck.play();

        // Reschedule transition timing if paused during transition
        if (this.transitionRemainingSec !== null && this.currentPlan) {
          const plan = this.currentPlan;
          const remaining = this.transitionRemainingSec;
          const elapsed = this.transitionElapsedSec ?? Math.max(0, plan.durationSec - remaining);
          const total = plan.durationSec;

          if (plan.rateRamp === 'toNeutral') {
            this.incomingDeck.rampPlaybackRate(1.0, remaining, resumeAudioTime);
          }

          this.mixer.schedulePartialCrossfade(
            this.activeDeckId,
            resumeAudioTime,
            total,
            elapsed
          );

          this.transitionEndTime = resumeAudioTime + remaining;
          this.transitionRemainingSec = null;
          this.transitionElapsedSec = null;
        }
      }
    } else {
      await this.loadAndPlayCurrent();
    }

    this.startLookahead();
    this.emit({ type: 'state_changed', isPlaying: true });
  }

  public pause(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.stopLookahead();

    if (this.isTransitioning && this.transitionEndTime !== null && this.currentPlan) {
      const now = this.mixer.context.currentTime;
      const remaining = Math.max(0.01, this.transitionEndTime - now);
      this.transitionRemainingSec = remaining;
      this.transitionElapsedSec = Math.max(0, this.currentPlan.durationSec - remaining);
    }

    this.activeDeck.pause();
    if (this.isTransitioning) {
      this.incomingDeck.pause();
    }
    this.emit({ type: 'state_changed', isPlaying: false });
  }

  public stop(): void {
    this.isRunning = false;
    this.isTransitioning = false;
    this.isEndingFadeOut = false;
    this.transitionEndTime = null;
    this.transitionRemainingSec = null;
    this.transitionElapsedSec = null;
    this.currentPlan = null;
    this.stopLookahead();

    this.mixer.deckA.stop();
    this.mixer.deckB.stop();
    this.mixer.deckA.unloadBuffer();
    this.mixer.deckB.unloadBuffer();

    this.emit({ type: 'state_changed', isPlaying: false });
  }

  public skip(): void {
    if (this.isTransitioning) {
      // Cut directly to incoming track
      const active = this.activeDeck;
      const incoming = this.incomingDeck;

      active.stop();
      active.unloadBuffer();
      incoming.setGain(1.0, 0.05);

      this.activeDeckId = this.activeDeckId === 'A' ? 'B' : 'A';
      this.currentIndex++;
      this.isTransitioning = false;
      this.isEndingFadeOut = false;
      this.transitionEndTime = null;
      this.transitionRemainingSec = null;
      this.transitionElapsedSec = null;
      this.currentPlan = null;

      this.emit({ type: 'track_changed', track: this.getCurrentTrack() });
    } else if (this.currentIndex + 1 < this.playlist.length) {
      // Trigger immediate quick mix to next track
      const nextTrack = this.playlist[this.currentIndex + 1]!;
      const incoming = this.incomingDeck;
      const now = this.mixer.context.currentTime;

      if (incoming.hasBuffer) {
        incoming.startAtTime(now, nextTrack.analysis?.firstBeatSec ?? 0, 1.0);
        this.mixer.scheduleCrossfade(this.activeDeckId, now, 1.0);
        this.isTransitioning = true;
        this.transitionEndTime = now + 1.0;
      } else {
        this.activeDeck.stop();
        this.activeDeck.unloadBuffer();
        this.currentIndex++;
        void this.loadAndPlayCurrent();
      }
    }
  }

  private async loadAndPlayCurrent(): Promise<void> {
    const track = this.getCurrentTrack();
    if (!track) {
      this.stop();
      return;
    }

    try {
      const buffer = await this.bufferLoader(track);
      this.activeDeck.loadBuffer(buffer, track.id);

      if (track.analysis) {
        this.activeDeck.setTrackGain(dbToGain(track.analysis.loudnessGainDb));
      }

      this.activeDeck.setGain(1.0, 0.05);
      await this.activeDeck.play(track.analysis?.firstBeatSec ?? 0);
      this.emit({ type: 'track_changed', track });
    } catch (err) {
      this.emit({
        type: 'track_error',
        trackId: track.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Skip failed track and move to next
      this.currentIndex++;
      if (this.currentIndex < this.playlist.length) {
        void this.loadAndPlayCurrent();
      } else {
        this.stop();
      }
    }
  }

  private startLookahead(): void {
    if (this.lookaheadTimer) return;
    this.lookaheadTimer = setInterval(() => {
      void this.lookaheadTick();
    }, 150);
  }

  private stopLookahead(): void {
    if (this.lookaheadTimer) {
      clearInterval(this.lookaheadTimer);
      this.lookaheadTimer = null;
    }
  }

  private async lookaheadTick(): Promise<void> {
    if (!this.isRunning) return;

    const ctx = this.mixer.context;
    const now = ctx.currentTime;
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) {
      this.stop();
      return;
    }

    const nextTrack = this.getNextTrack();
    const active = this.activeDeck;
    const incoming = this.incomingDeck;

    // 1. Pre-decode next track if not already loaded
    if (nextTrack && incoming.trackId !== nextTrack.id && !this.isPredecoding) {
      this.isPredecoding = true;
      try {
        const buffer = await this.bufferLoader(nextTrack);
        incoming.loadBuffer(buffer, nextTrack.id);

        if (currentTrack.analysis && nextTrack.analysis) {
          this.currentPlan = planTransition(
            currentTrack.analysis,
            nextTrack.analysis,
            this.settings
          );
        }
      } catch (err) {
        this.emit({
          type: 'track_error',
          trackId: nextTrack.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Remove failed track from playlist and keep going
        this.playlist.splice(this.currentIndex + 1, 1);
      } finally {
        this.isPredecoding = false;
      }
    }

    // 2. Schedule transition if within lookahead window
    if (!this.isTransitioning && nextTrack && incoming.hasBuffer && this.currentPlan) {
      const plan = this.currentPlan;
      const currentPos = active.getCurrentTime();
      const timeToStartSec = (plan.outgoingStartSec - currentPos) / active.rate;

      // When within lookahead window (1.0s ahead)
      if (timeToStartSec <= 1.0 && timeToStartSec >= -0.5) {
        const mixStartAudioTime = now + Math.max(0, timeToStartSec);
        this.scheduleTransition(mixStartAudioTime, plan, currentTrack, nextTrack);
      }
    }

    // 3. Complete transition when scheduled time finishes
    if (this.isTransitioning && this.transitionEndTime !== null && now >= this.transitionEndTime) {
      this.completeTransition();
    }

    // 4. Handle end of playlist (single track or last track)
    if (!nextTrack && !this.isTransitioning) {
      const currentPos = active.getCurrentTime();
      const remaining = active.duration - currentPos;
      const fadeDuration = Math.min(2.0, Math.max(0.5, active.duration * 0.2));

      if (remaining <= fadeDuration && !this.isEndingFadeOut && remaining > 0) {
        this.isEndingFadeOut = true;
        active.setGain(0, remaining);
      }

      if (currentPos >= active.duration - 0.05) {
        this.stop();
      }
    }
  }

  /**
   * Manually executes one lookahead tick (primarily for testing and deterministic sync).
   */
  public async tick(): Promise<void> {
    await this.lookaheadTick();
  }

  private scheduleTransition(
    startAudioTime: number,
    plan: TransitionPlan,
    currentTrack: Track,
    nextTrack: Track
  ): void {
    const active = this.activeDeck;
    const incoming = this.incomingDeck;

    // 1. Loudness normalization
    if (currentTrack.analysis) {
      active.setTrackGain(dbToGain(currentTrack.analysis.loudnessGainDb));
    }
    if (nextTrack.analysis) {
      incoming.setTrackGain(dbToGain(nextTrack.analysis.loudnessGainDb));
    }

    // 2. Start incoming track at startAudioTime on audio clock
    incoming.startAtTime(startAudioTime, plan.incomingStartSec, plan.incomingRate);

    // 3. Ramp tempo back to neutral (1.0)
    if (plan.rateRamp === 'toNeutral') {
      incoming.rampPlaybackRate(1.0, plan.durationSec, startAudioTime);
    }

    // 4. Equal-power crossfade curve scheduled on audio clock
    this.mixer.scheduleCrossfade(this.activeDeckId, startAudioTime, plan.durationSec);

    this.isTransitioning = true;
    this.transitionEndTime = startAudioTime + plan.durationSec;
    this.emit({ type: 'transition_started', plan });
  }

  private completeTransition(): void {
    const active = this.activeDeck;

    // Stop and UNLOAD previous track buffer (enforce memory limit: max 2 tracks)
    active.stop();
    active.unloadBuffer();

    // Promote incoming deck to active deck
    this.activeDeckId = this.activeDeckId === 'A' ? 'B' : 'A';
    this.currentIndex++;
    this.isTransitioning = false;
    this.isEndingFadeOut = false;
    this.transitionEndTime = null;
    this.transitionRemainingSec = null;
    this.transitionElapsedSec = null;
    this.currentPlan = null;

    const newCurrent = this.getCurrentTrack();
    this.emit({ type: 'transition_completed' });
    this.emit({ type: 'track_changed', track: newCurrent });
  }

  public destroy(): void {
    this.stop();
    this.mixer.destroy();
  }
}

// Global auto-mix engine singleton
let globalAutoMixEngine: AutoMixEngine | null = null;

export function getAutoMixEngine(): AutoMixEngine {
  if (!globalAutoMixEngine) {
    globalAutoMixEngine = new AutoMixEngine();
  }
  return globalAutoMixEngine;
}
