import { create } from 'zustand';
import type { Playlist, Settings, Track, TrackAnalysis } from '@/shared/types';
import { db } from '@/library/db';

interface AppState {
  tracks: Record<string, Track>;
  isInitialized: boolean;
  activePlaylist: Playlist | null;
  settings: Settings;
  loadTracksFromDb: () => Promise<void>;
  addTracks: (newTracks: Track[]) => void;
  updateTrackAnalysis: (trackId: string, analysis: TrackAnalysis) => void;
  removeTrack: (id: string) => Promise<void>;
  setSettings: (settings: Partial<Settings>) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tracks: {},
  isInitialized: false,
  activePlaylist: null,
  settings: {
    mixBars: 16,
    transitionStyle: 'bassSwap',
    maxTempoStretchPct: 6,
    keyAwareOrdering: true,
    targetLoudnessDb: -14,
  },
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
    const { tracks } = get();
    const updated = { ...tracks };
    delete updated[id];
    set({ tracks: updated });
  },
  setSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),
}));
