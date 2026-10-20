import React, { useEffect, useState } from 'react';
import { Header } from './components';
import { useAppStore } from './store';
import {
  LibraryScreen,
  PlaylistScreen,
  NowMixingScreen,
  TrackEditorScreen,
  SettingsScreen,
} from './screens';

type Tab = 'mixing' | 'library' | 'playlist' | 'editor' | 'settings';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('mixing');
  const loadTracksFromDb = useAppStore((s) => s.loadTracksFromDb);

  useEffect(() => {
    loadTracksFromDb();
  }, [loadTracksFromDb]);

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto sm:max-w-xl md:max-w-4xl bg-[#0B0F19] text-gray-100 shadow-2xl border-x border-gray-800/60 overflow-hidden">
      {/* Top Application Bar */}
      <Header title="AutoMix" />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto pb-20">
        {activeTab === 'mixing' && <NowMixingScreen />}
        {activeTab === 'library' && <LibraryScreen />}
        {activeTab === 'playlist' && <PlaylistScreen />}
        {activeTab === 'editor' && <TrackEditorScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto sm:max-w-xl md:max-w-4xl bg-[#111625]/95 backdrop-blur-md border-t border-gray-800/80 flex justify-around items-center py-1 px-1 z-50">
        <button
          data-testid="tab-mixing"
          onClick={() => setActiveTab('mixing')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'mixing'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">🎛️</span>
          <span>Now Mixing</span>
        </button>

        <button
          data-testid="tab-library"
          onClick={() => setActiveTab('library')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'library'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">📂</span>
          <span>Library</span>
        </button>

        <button
          data-testid="tab-playlist"
          onClick={() => setActiveTab('playlist')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'playlist'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">📑</span>
          <span>Playlist</span>
        </button>

        <button
          data-testid="tab-editor"
          onClick={() => setActiveTab('editor')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'editor'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">✏️</span>
          <span>Editor</span>
        </button>

        <button
          data-testid="tab-settings"
          onClick={() => setActiveTab('settings')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'settings'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">⚙️</span>
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
