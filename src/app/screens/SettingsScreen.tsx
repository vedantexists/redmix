import React, { useState } from 'react';
import { useAppStore } from '../store';
import { db } from '@/library/db';
import type { Settings } from '@/shared/types';
import { playbackCoordinator } from '../services/playbackCoordinator';

export const SettingsScreen: React.FC = () => {
  const { settings } = useAppStore();
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);

  const handleUpdate = (partial: Partial<Settings>) => {
    playbackCoordinator.updateSettings(partial);
  };

  const handleClearDatabase = async () => {
    if (confirm('Are you sure you want to clear your local track library and cache?')) {
      await db.clearAll();
      useAppStore.setState({
        tracks: {},
        playlistTrackIds: [],
        currentTrack: null,
        nextTrack: null,
        isPlaying: false,
      });
      setCacheStatus('Local library and database cleared.');
    }
  };

  const handleClearCache = async () => {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      for (const k of keys) {
        await caches.delete(k);
      }
      setCacheStatus('PWA offline cache cleared. App shell will re-cache on next load.');
    } else {
      setCacheStatus('Cache API not available in this browser.');
    }
  };

  return (
    <div data-testid="screen-settings" className="p-4 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-wide">Settings & Audio Engine</h2>
        <p className="text-gray-400 text-xs mt-0.5">
          Configure transition defaults, audio normalization, and device behaviors
        </p>
      </div>

      {/* Cache Status Banner */}
      {cacheStatus && (
        <div
          data-testid="settings-status-banner"
          className="p-3 bg-indigo-950/60 border border-indigo-800/80 rounded-xl text-xs text-indigo-300 flex items-center justify-between"
        >
          <span>{cacheStatus}</span>
          <button
            onClick={() => setCacheStatus(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-indigo-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Mix Defaults */}
      <div className="p-4 bg-gray-900/80 border border-gray-800 rounded-2xl space-y-4">
        <span className="text-xs uppercase font-bold tracking-wider text-gray-400 block">
          Default Transition Configuration
        </span>

        {/* Mix Duration in Bars */}
        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="font-semibold text-gray-200 block">Mix Duration</span>
            <span className="text-gray-500 text-[11px]">Number of musical bars for crossfade blend</span>
          </div>
          <div className="flex gap-1.5">
            {([8, 16, 32] as const).map((bars) => (
              <button
                key={bars}
                data-testid={`settings-mixbars-${bars}`}
                onClick={() => handleUpdate({ mixBars: bars })}
                className={`min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                  settings.mixBars === bars
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {bars}b
              </button>
            ))}
          </div>
        </div>

        {/* Transition Style */}
        <div className="flex items-center justify-between text-xs pt-3 border-t border-gray-800/80">
          <div>
            <span className="font-semibold text-gray-200 block">Transition Style</span>
            <span className="text-gray-500 text-[11px]">EQ and blending curves</span>
          </div>
          <div className="flex gap-1.5">
            {(
              [
                { id: 'bassSwap', label: 'Bass Swap' },
                { id: 'longBlend', label: 'Blend' },
                { id: 'simpleCrossfade', label: 'Crossfade' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                data-testid={`settings-style-${s.id}`}
                onClick={() => handleUpdate({ transitionStyle: s.id })}
                className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  settings.transitionStyle === s.id
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Max Tempo Stretch */}
        <div className="flex items-center justify-between text-xs pt-3 border-t border-gray-800/80">
          <div>
            <span className="font-semibold text-gray-200 block">Max Tempo Stretch</span>
            <span className="text-gray-500 text-[11px]">Maximum tempo adjustment before falling back to crossfade</span>
          </div>
          <div className="flex gap-1.5">
            {([4, 6, 8] as const).map((pct) => (
              <button
                key={pct}
                data-testid={`settings-stretch-${pct}`}
                onClick={() => handleUpdate({ maxTempoStretchPct: pct })}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                  settings.maxTempoStretchPct === pct
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                ±{pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Harmonic Ordering */}
        <div className="flex items-center justify-between text-xs pt-3 border-t border-gray-800/80">
          <div>
            <span className="font-semibold text-gray-200 block">Key-Aware Harmonic Ordering</span>
            <span className="text-gray-500 text-[11px]">Camelot wheel harmonic mixing in auto-order</span>
          </div>
          <button
            data-testid="settings-key-ordering-toggle"
            onClick={() => handleUpdate({ keyAwareOrdering: !settings.keyAwareOrdering })}
            className={`min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              settings.keyAwareOrdering
                ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                : 'bg-gray-800 text-gray-500 border-gray-700'
            }`}
          >
            {settings.keyAwareOrdering ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Storage and Cache Management */}
      <div className="p-4 bg-gray-900/80 border border-gray-800 rounded-2xl space-y-3">
        <span className="text-xs uppercase font-bold tracking-wider text-gray-400 block">
          Storage & Offline Cache
        </span>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            data-testid="btn-clear-cache"
            onClick={handleClearCache}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold border border-gray-700 transition-colors"
          >
            Clear PWA Service Worker Cache
          </button>

          <button
            data-testid="btn-clear-db"
            onClick={handleClearDatabase}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-semibold border border-rose-500/30 transition-colors"
          >
            Clear Local Music Library
          </button>
        </div>
      </div>

      {/* Device Compatibility & Known Limitations Documentation */}
      <div
        data-testid="mobile-limitations-doc"
        className="p-4 bg-gray-950/70 border border-gray-800/80 rounded-2xl space-y-3 text-xs"
      >
        <span className="text-xs uppercase font-bold tracking-wider text-indigo-400 block">
          Mobile Hardening & Platform Notes
        </span>

        <div className="space-y-2 text-gray-300 leading-relaxed text-[11px]">
          <div>
            <strong className="text-white block font-medium">🍎 iOS Safari Quirks & Background Audio</strong>
            <p className="text-gray-400 mt-0.5">
              iOS requires a user gesture tap before starting audio. When the screen locks or Safari is backgrounded,
              iOS throttles Web Audio context timers unless an active Media Session audio session is maintained.
              AutoMix registers continuous Media Session handlers with lock screen metadata to preserve background continuity.
            </p>
          </div>

          <div className="pt-2 border-t border-gray-800/60">
            <strong className="text-white block font-medium">🤖 Android Chrome & Desktop Chrome</strong>
            <p className="text-gray-400 mt-0.5">
              Full Screen Wake Lock API and Media Session API support. Playback continues unimpeded with device locked,
              and Screen Wake Lock prevents display sleep during active mixing.
            </p>
          </div>

          <div className="pt-2 border-t border-gray-800/60">
            <strong className="text-white block font-medium">💾 Local Origin Storage & Privacy</strong>
            <p className="text-gray-400 mt-0.5">
              All audio files and analysis results are strictly stored in Origin Private File System (OPFS) and IndexedDB on your device.
              No audio files, metadata, or telemetry are ever uploaded or transmitted to external servers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
