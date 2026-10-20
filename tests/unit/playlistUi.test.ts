import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '@/app/store';
import { playbackCoordinator } from '@/app/services/playbackCoordinator';
import { getAutoMixEngine } from '@/audio/engine';
import type { Track } from '@/shared/types';
import { db } from '@/library/db';

function makeMockTrack(id: string, title: string, bpm: number, camelotKey: string, durationSec = 180): Track {
  return {
    id,
    fileName: `${title}.mp3`,
    title,
    artist: 'Test Artist',
    sizeBytes: 1024 * 1024 * 5,
    source: {
      kind: 'opfs',
      path: `tracks/${id}.mp3`,
    },
    analysis: {
      bpm,
      bpmConfidence: 0.95,
      firstBeatSec: 0.1,
      beatsPerBar: 4,
      key: {
        camelot: camelotKey,
        confidence: 0.9,
      },
      loudnessGainDb: 0.0,
      introEndSec: 15.0,
      outroStartSec: durationSec - 15.0,
      barEnergy: [0.5, 0.7, 0.9],
      durationSec,
      analysisVersion: 1,
    },
  };
}

describe('M7 Playlist UX & State Store', () => {
  beforeEach(() => {
    useAppStore.setState({
      tracks: {},
      playlistTrackIds: [],
      isPlaying: false,
      currentTrack: null,
      nextTrack: null,
      inTransition: false,
      timeUntilTransition: 0,
      currentPosition: 0,
      currentDuration: 0,
      playbackError: null,
    });
  });

  it('adds individual tracks and batches to playlist queue', () => {
    const trackA = makeMockTrack('t1', 'Track A', 120, '8B');
    const trackB = makeMockTrack('t2', 'Track B', 122, '9B');
    const trackC = makeMockTrack('t3', 'Track C', 124, '10B');

    useAppStore.getState().addTracks([trackA, trackB, trackC]);

    expect(useAppStore.getState().playlistTrackIds).toHaveLength(0);

    useAppStore.getState().addToPlaylist('t1');
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t1']);

    useAppStore.getState().addAllToPlaylist(['t2', 't3']);
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t1', 't2', 't3']);
  });

  it('removes tracks from playlist queue by index', () => {
    useAppStore.setState({ playlistTrackIds: ['t1', 't2', 't3', 't4'] });

    useAppStore.getState().removeFromPlaylist(1); // Remove t2
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t1', 't3', 't4']);

    useAppStore.getState().removeFromPlaylist(0); // Remove t1
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t3', 't4']);
  });

  it('reorders playlist items and safely handles out-of-bounds indexes', () => {
    useAppStore.setState({ playlistTrackIds: ['t1', 't2', 't3'] });

    // Move t3 to top (from index 2 to index 0)
    useAppStore.getState().reorderPlaylist(2, 0);
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t3', 't1', 't2']);

    // Invalid fromIndex (< 0 or >= length)
    useAppStore.getState().reorderPlaylist(-1, 1);
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t3', 't1', 't2']);

    useAppStore.getState().reorderPlaylist(10, 1);
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t3', 't1', 't2']);

    // Invalid toIndex
    useAppStore.getState().reorderPlaylist(0, 99);
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t3', 't1', 't2']);
  });

  it('clears the playlist queue', () => {
    useAppStore.setState({ playlistTrackIds: ['t1', 't2'] });
    useAppStore.getState().clearPlaylist();
    expect(useAppStore.getState().playlistTrackIds).toEqual([]);
  });

  it('removes deleted track from playlistTrackIds when deleted from library', async () => {
    const track = makeMockTrack('t1', 'Track A', 120, '8B');
    useAppStore.getState().addTracks([track]);
    useAppStore.setState({ playlistTrackIds: ['t1', 't2'] });

    vi.spyOn(db, 'deleteTrack').mockResolvedValue();
    await useAppStore.getState().removeTrack('t1');

    expect(useAppStore.getState().tracks['t1']).toBeUndefined();
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t2']);
  });

  it('auto-orders playlist harmonically using Camelot wheel and BPM', () => {
    // Disordered tracks:
    // t2: 120 BPM, 8B (will be starting track since lowest BPM)
    // t1: 121 BPM, 1B (closer BPM diff=1, but clashing key with 8B -> penalty)
    // t3: 122 BPM, 9B (Camelot compatible with 8B -> strong bonus)
    // t4: 128 BPM, 2A (distant BPM and clashing key)
    const t1 = makeMockTrack('t1', 'Close BPM Clashing Key 1B', 121, '1B');
    const t2 = makeMockTrack('t2', 'Base 8B', 120, '8B');
    const t3 = makeMockTrack('t3', 'Bridge 9B', 122, '9B');
    const t4 = makeMockTrack('t4', 'Clashing 2A', 128, '2A');

    useAppStore.getState().addTracks([t1, t2, t3, t4]);
    useAppStore.setState({ playlistTrackIds: ['t1', 't4', 't3', 't2'] });

    useAppStore.getState().autoOrderPlaylist();

    const ordered = useAppStore.getState().playlistTrackIds;
    // Starting track is lowest BPM (t2: 120 BPM, 8B)
    expect(ordered[0]).toBe('t2');
    // Next should be t3 (122 BPM, 9B, compatible Camelot) rather than t1 despite t1 having closer BPM (121)
    expect(ordered[1]).toBe('t3');
  });

  it('autoOrderPlaylist is a no-op when playlist has <= 1 track', () => {
    const t1 = makeMockTrack('t1', 'Track 1', 120, '8B');
    useAppStore.getState().addTracks([t1]);
    useAppStore.setState({ playlistTrackIds: ['t1'] });

    useAppStore.getState().autoOrderPlaylist();
    expect(useAppStore.getState().playlistTrackIds).toEqual(['t1']);
  });
});

describe('M7 Playback Coordinator & Media Session API', () => {
  let originalMediaSession: unknown;
  const engine = getAutoMixEngine();

  beforeEach(() => {
    originalMediaSession = (navigator as unknown as { mediaSession?: unknown }).mediaSession;

    useAppStore.setState({
      tracks: {},
      playlistTrackIds: [],
      isPlaying: false,
      currentTrack: null,
      nextTrack: null,
      inTransition: false,
      timeUntilTransition: 0,
      currentPosition: 0,
      currentDuration: 0,
      playbackError: null,
    });
  });

  afterEach(() => {
    if (originalMediaSession !== undefined) {
      (navigator as unknown as { mediaSession?: unknown }).mediaSession = originalMediaSession;
    }
  });

  it('sets playback error if trying to play an empty playlist', async () => {
    useAppStore.setState({ playlistTrackIds: [] });
    await playbackCoordinator.playMix(0);

    expect(useAppStore.getState().playbackError).toBe(
      'Playlist is empty. Add tracks to playlist first.'
    );
  });

  it('synchronizes engine playback state into store', () => {
    const trackA = makeMockTrack('t1', 'Track A', 120, '8B');
    const trackB = makeMockTrack('t2', 'Track B', 122, '9B');

    vi.spyOn(engine, 'getCurrentTrack').mockReturnValue(trackA);
    vi.spyOn(engine, 'getNextTrack').mockReturnValue(trackB);
    vi.spyOn(engine, 'getTimeUntilTransition').mockReturnValue(42.5);
    Object.defineProperty(engine, 'isPlaying', { value: true, configurable: true });
    Object.defineProperty(engine, 'inTransition', { value: false, configurable: true });

    playbackCoordinator.syncState();

    const state = useAppStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.currentTrack?.id).toBe('t1');
    expect(state.nextTrack?.id).toBe('t2');
    expect(state.timeUntilTransition).toBe(42.5);
    expect(state.inTransition).toBe(false);
  });

  it('updates transition settings on both store and engine', () => {
    const spySetSettings = vi.spyOn(engine, 'setSettings');

    playbackCoordinator.updateSettings({ mixBars: 32, transitionStyle: 'longBlend' });

    expect(useAppStore.getState().settings.mixBars).toBe(32);
    expect(useAppStore.getState().settings.transitionStyle).toBe('longBlend');
    expect(spySetSettings).toHaveBeenCalledWith({ mixBars: 32, transitionStyle: 'longBlend' });
  });

  it('registers Media Session metadata and transport action handlers', () => {
    const mockSetActionHandler = vi.fn();
    const mockMediaSession = {
      metadata: null,
      setActionHandler: mockSetActionHandler,
    };

    (navigator as unknown as { mediaSession: unknown }).mediaSession = mockMediaSession;

    const track = makeMockTrack('t1', 'Cosmic Energy', 126, '11B');
    playbackCoordinator.updateMediaSession(track);

    expect(mockMediaSession.metadata).toBeDefined();
    // Handlers registered for play, pause, nexttrack, seekto
    expect(mockSetActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('nexttrack', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('seekto', expect.any(Function));

    // Clear metadata when track is null
    playbackCoordinator.updateMediaSession(null);
    expect(mockMediaSession.metadata).toBeNull();
  });

  it('surfaces audio errors gracefully and allows dismissal', () => {
    useAppStore.getState().setPlaybackError('Audio Error: Corrupted audio frame');
    expect(useAppStore.getState().playbackError).toBe('Audio Error: Corrupted audio frame');

    useAppStore.getState().setPlaybackError(null);
    expect(useAppStore.getState().playbackError).toBeNull();
  });
});
