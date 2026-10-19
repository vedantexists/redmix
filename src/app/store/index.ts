import { create } from 'zustand';
import type { Playlist, Settings, Track } from '@/shared/types';

interface AppState {
  tracks: Record<string, Track>;
  activePlaylist: Playlist | null;
  settings: Settings;
  setSettings: (settings: Partial<Settings>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tracks: {},
  activePlaylist: null,
  settings: {
    mixBars: 16,
    transitionStyle: 'bassSwap',
    maxTempoStretchPct: 6,
    keyAwareOrdering: true,
    targetLoudnessDb: -14,
  },
  setSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),
}));
