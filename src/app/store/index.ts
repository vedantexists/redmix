import { create } from 'zustand';
import type { Playlist, Settings, Track, TrackAnalysis } from '@/shared/types';
import { db } from '@/library/db';
import { orderPlaylist } from '@/audio/planner';

export interface AppState {
  tracks: Record<string, Track>;
  isInitialized: boolean;
  activePlaylist: Playlist | null;
  playlistTrackIds: string[];
  settings: Settings;

  // Playback state
  isPlaying: boolean;
  currentTrack: Track | null;
  nextTrack: Track | null;
  inTransition: boolean;
  timeUntilTransition: number;
  currentPosition: number;
  currentDuration: number;
  playbackError: string | null;

  // Actions
  loadTracksFromDb: () => Promise<void>;
  addTracks: (newTracks: Track[]) => void;
  updateTrackAnalysis: (trackId: string, analysis: TrackAnalysis) => void;
  removeTrack: (id: string) => Promise<void>;
  setSettings: (settings: Partial<Settings>) => void;

  // Playlist queue actions
  addToPlaylist: (trackId: string) => void;
  addAllToPlaylist: (trackIds: string[]) => void;
  removeFromPlaylist: (index: number) => void;
  reorderPlaylist: (fromIndex: number, toIndex: number) => void;
  setPlaylistTrackIds: (ids: string[]) => void;
  autoOrderPlaylist: () => void;
  clearPlaylist: () => void;

  // Playback actions
  setPlaybackState: (state: Partial<{
    isPlaying: boolean;
    currentTrack: Track | null;
    nextTrack: Track | null;
    inTransition: boolean;
    timeUntilTransition: number;
    currentPosition: number;
    currentDuration: number;
  }>) => void;
  setPlaybackError: (error: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tracks: {},
  isInitialized: false,
  activePlaylist: null,
  playlistTrackIds: [],
  settings: {
    mixBars: 16,
    transitionStyle: 'bassSwap',
    maxTempoStretchPct: 6,
    keyAwareOrdering: true,
    targetLoudnessDb: -14,
  },

  isPlaying: false,
  currentTrack: null,
  nextTrack: null,
  inTransition: false,
  timeUntilTransition: 0,
  currentPosition: 0,
  currentDuration: 0,
  playbackError: null,

  loadTracksFromDb: async () => {
    try {
      const storedTracks = await db.getTracks();
      const trackMap: Record<string, Track> = {};
      for (const t of storedTracks) {
        trackMap[t.id] = t;
      }
      set({ tracks: trackMap, isInitialized: true });
    } catch {
      set({ isInitialized: true });
    }
  },

  addTracks: (newTracks) => {
    set((state) => {
      const updated = { ...state.tracks };
      for (const t of newTracks) {
        updated[t.id] = t;
      }
      return { tracks: updated };
    });
  },

  updateTrackAnalysis: (trackId, analysis) => {
    set((state) => {
      const track = state.tracks[trackId];
      if (!track) return state;
      return {
        tracks: {
          ...state.tracks,
          [trackId]: { ...track, analysis },
        },
      };
    });
  },

  removeTrack: async (id) => {
    await db.deleteTrack(id);
    const { tracks, playlistTrackIds } = get();
    const updated = { ...tracks };
    delete updated[id];
    const updatedPlaylist = playlistTrackIds.filter((tId) => tId !== id);
    set({ tracks: updated, playlistTrackIds: updatedPlaylist });
  },

  setSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),

  addToPlaylist: (trackId) => {
    set((state) => ({
      playlistTrackIds: [...state.playlistTrackIds, trackId],
    }));
  },

  addAllToPlaylist: (trackIds) => {
    set((state) => ({
      playlistTrackIds: [...state.playlistTrackIds, ...trackIds],
    }));
  },

  removeFromPlaylist: (index) => {
    set((state) => {
      const copy = [...state.playlistTrackIds];
      copy.splice(index, 1);
      return { playlistTrackIds: copy };
    });
  },

  reorderPlaylist: (fromIndex, toIndex) => {
    set((state) => {
      if (
        fromIndex < 0 ||
        fromIndex >= state.playlistTrackIds.length ||
        toIndex < 0 ||
        toIndex >= state.playlistTrackIds.length
      ) {
        return state;
      }
      const copy = [...state.playlistTrackIds];
      const [item] = copy.splice(fromIndex, 1);
      if (item) {
        copy.splice(toIndex, 0, item);
      }
      return { playlistTrackIds: copy };
    });
  },

  setPlaylistTrackIds: (ids) => {
    set({ playlistTrackIds: ids });
  },

  autoOrderPlaylist: () => {
    const { tracks, playlistTrackIds, settings } = get();
    const resolvedTracks = playlistTrackIds
      .map((id) => tracks[id])
      .filter((t): t is Track => t !== undefined);

    if (resolvedTracks.length <= 1) return;

    const ordered = orderPlaylist(resolvedTracks, settings);
    set({ playlistTrackIds: ordered.map((t) => t.id) });
  },

  clearPlaylist: () => {
    set({ playlistTrackIds: [] });
  },

  setPlaybackState: (partial) => {
    set((state) => ({ ...state, ...partial }));
  },

  setPlaybackError: (error) => {
    set({ playbackError: error });
  },
}));
