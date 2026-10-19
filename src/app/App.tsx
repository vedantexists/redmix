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
        {activeTab === 'mixing' && (
          <div className="space-y-4">
            <NowMixingScreen />
            {/* Visual Deck Preview Placeholder */}
            <div className="mx-4 p-5 rounded-2xl bg-gradient-to-b from-[#151C2C] to-[#101624] border border-gray-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold tracking-widest text-indigo-400">
                  Deck Engine A/B
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Ready
                </span>
              </div>

              {/* Dual Decks Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-gray-900/80 border border-gray-800/80 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-300">
                      Deck A (Active)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                      124.0 BPM · 8A
                    </span>
                  </div>
                  <div className="h-10 rounded bg-gray-950 flex items-center justify-center border border-gray-800/50">
                    <span className="text-xs text-gray-500 font-mono">
                      Waveform A (Empty)
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-gray-900/80 border border-gray-800/80 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-300">
                      Deck B (Incoming)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                      126.0 BPM · 9A
                    </span>
                  </div>
                  <div className="h-10 rounded bg-gray-950 flex items-center justify-center border border-gray-800/50">
                    <span className="text-xs text-gray-500 font-mono">
                      Waveform B (Empty)
                    </span>
                  </div>
                </div>
              </div>

              {/* Transition Control Strip */}
              <div className="pt-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
                <span>Transition: Bass Swap (16 bars)</span>
                <span className="text-gray-500">Auto-Mix Planner Active</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'library' && <LibraryScreen />}
        {activeTab === 'playlist' && <PlaylistScreen />}
        {activeTab === 'editor' && <TrackEditorScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto sm:max-w-xl md:max-w-4xl bg-[#111625]/95 backdrop-blur-md border-t border-gray-800/80 flex justify-around items-center py-2 px-1 z-50">
        <button
          onClick={() => setActiveTab('mixing')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'mixing'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">🎛️</span>
          <span>Now Mixing</span>
        </button>

        <button
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'library'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">📂</span>
          <span>Library</span>
        </button>

        <button
          onClick={() => setActiveTab('playlist')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'playlist'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">📑</span>
          <span>Playlist</span>
        </button>

        <button
          onClick={() => setActiveTab('editor')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg text-xs transition-colors ${
            activeTab === 'editor'
              ? 'text-indigo-400 font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="text-base mb-0.5">✏️</span>
          <span>Editor</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg text-xs transition-colors ${
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
