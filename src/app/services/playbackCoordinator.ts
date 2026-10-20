import { getAutoMixEngine, type AutoMixEngine, type AutoMixEvent } from '@/audio/engine';
import { useAppStore } from '../store';
import type { Track, Settings } from '@/shared/types';
import { wakeLockManager } from './wakeLock';

class PlaybackCoordinator {
  private engine: AutoMixEngine;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeEngine: (() => void) | null = null;

  constructor() {
    this.engine = getAutoMixEngine();
    this.setupListeners();
  }

  private setupListeners(): void {
    this.unsubscribeEngine = this.engine.subscribe((event: AutoMixEvent) => {
      this.handleEngineEvent(event);
    });
  }

  private handleEngineEvent(event: AutoMixEvent): void {
    const store = useAppStore.getState();

    switch (event.type) {
      case 'state_changed':
        store.setPlaybackState({ isPlaying: event.isPlaying });
        if (event.isPlaying) {
          this.startSyncLoop();
          void wakeLockManager.acquireLock();
        } else {
          this.stopSyncLoop();
          wakeLockManager.releaseLock();
        }
        break;

      case 'track_changed': {
        const track = event.track ?? null;
        store.setPlaybackState({
          currentTrack: track,
          nextTrack: this.engine.getNextTrack(),
          inTransition: this.engine.inTransition,
        });
        this.updateMediaSession(track);
        break;
      }

      case 'transition_started':
        store.setPlaybackState({
          inTransition: true,
          nextTrack: this.engine.getNextTrack(),
        });
        break;

      case 'transition_completed':
        store.setPlaybackState({
          inTransition: false,
          currentTrack: this.engine.getCurrentTrack(),
          nextTrack: this.engine.getNextTrack(),
        });
        break;

      case 'track_error': {
        const errorMsg = event.error || 'Failed to play track';
        store.setPlaybackError(`Audio Error: ${errorMsg}`);
        break;
      }
    }
  }

  private startSyncLoop(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      this.syncState();
    }, 200);
  }

  private stopSyncLoop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  public syncState(): void {
    const store = useAppStore.getState();
    const activeDeck = this.engine.activeDeck;

    store.setPlaybackState({
      isPlaying: this.engine.isPlaying,
      currentTrack: this.engine.getCurrentTrack(),
      nextTrack: this.engine.getNextTrack(),
      inTransition: this.engine.inTransition,
      timeUntilTransition: this.engine.getTimeUntilTransition(),
      currentPosition: activeDeck.getCurrentTime(),
      currentDuration: activeDeck.duration,
    });
  }

  public updateMediaSession(track: Track | null): void {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    try {
      const metadataPayload = {
        title: track.title,
        artist: track.artist || 'AutoMix Track',
        album: 'AutoMix Continuous Mix',
        artwork: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      };

      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata(metadataPayload);
      } else {
        (navigator.mediaSession as unknown as { metadata: unknown }).metadata = metadataPayload;
      }

      navigator.mediaSession.setActionHandler('play', () => {
        void this.playMix();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        this.pauseMix();
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this.skipTrack();
      });

      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null) {
          this.engine.activeDeck.seek(details.seekTime);
          this.syncState();
        }
      });
    } catch {
      // MediaSession errors in unsupported browsers/headless mode ignored
    }
  }

  public async playMix(startIndex = 0): Promise<void> {
    const { tracks, playlistTrackIds, settings } = useAppStore.getState();
    const resolvedTracks = playlistTrackIds
      .map((id) => tracks[id])
      .filter((t): t is Track => t !== undefined);

    if (resolvedTracks.length === 0) {
      useAppStore.getState().setPlaybackError('Playlist is empty. Add tracks to playlist first.');
      return;
    }

    this.engine.setSettings(settings);
    this.engine.setPlaylist(resolvedTracks, startIndex);
    await this.engine.play();
    this.syncState();
  }

  public pauseMix(): void {
    this.engine.pause();
    this.syncState();
  }

  public async togglePlay(): Promise<void> {
    if (this.engine.isPlaying) {
      this.pauseMix();
    } else {
      await this.playMix();
    }
  }

  public skipTrack(): void {
    this.engine.skip();
    this.syncState();
  }

  public updateSettings(newSettings: Partial<Settings>): void {
    useAppStore.getState().setSettings(newSettings);
    this.engine.setSettings(newSettings);
  }

  public destroy(): void {
    this.stopSyncLoop();
    wakeLockManager.releaseLock();
    this.unsubscribeEngine?.();
  }
}

export const playbackCoordinator = new PlaybackCoordinator();
