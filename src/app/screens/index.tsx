import React from 'react';

export const LibraryScreen: React.FC = () => (
  <div data-testid="screen-library" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Music Library</h2>
    <p className="text-gray-400 text-sm">Import and manage your local audio files.</p>
  </div>
);

export const PlaylistScreen: React.FC = () => (
  <div data-testid="screen-playlist" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Playlist Queue</h2>
    <p className="text-gray-400 text-sm">Organize tracks for continuous DJ mixing.</p>
  </div>
);

export const NowMixingScreen: React.FC = () => (
  <div data-testid="screen-now-mixing" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Now Mixing</h2>
    <p className="text-gray-400 text-sm">
      Live dual-deck playback and transition monitoring.
    </p>
  </div>
);

export const TrackEditorScreen: React.FC = () => (
  <div data-testid="screen-track-editor" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Track Editor</h2>
    <p className="text-gray-400 text-sm">Fine-tune beat grid, BPM, and cue points.</p>
  </div>
);

export const SettingsScreen: React.FC = () => (
  <div data-testid="screen-settings" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Settings</h2>
    <p className="text-gray-400 text-sm">
      Configure mix duration, transition curves, and audio limits.
    </p>
  </div>
);
