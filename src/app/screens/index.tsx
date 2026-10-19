import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import {
  isFileSystemAccessSupported,
  pickAudioFilesWithHandles,
  type PickedFileWithHandle,
} from '@/library/fileAccess';
import { importAudioFiles, type ImportFailure } from '@/library/importer';
import type { Track } from '@/shared/types';
import { getTwoDeckMixer } from '@/audio/engine';
import { analysisManager, type AnalysisState } from '@/analysis';
import { decodeTrackForAnalysis } from '@/library/audioDecoder';

export const LibraryScreen: React.FC = () => {
  const { tracks, addTracks, removeTrack, updateTrackAnalysis } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [importErrors, setImportErrors] = useState<ImportFailure[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [analysisStates, setAnalysisStates] = useState<Record<string, AnalysisState>>({});

  useEffect(() => {
    return analysisManager.subscribe((trackId, state) => {
      setAnalysisStates((prev) => ({ ...prev, [trackId]: state }));
    });
  }, []);

  const trackList = Object.values(tracks);

  const handleProcessFiles = async (
    items: PickedFileWithHandle[],
    forceFallback = false
  ) => {
    if (items.length === 0) return;

    setIsImporting(true);
    setImportErrors([]);
    setStatusMessage(null);
    setImportProgress({ current: 0, total: items.length });

    try {
      const result = await importAudioFiles(items, forceFallback, (current, total) => {
        setImportProgress({ current, total });
      });

      if (result.imported.length > 0) {
        addTracks(result.imported);
      }

      if (result.failed.length > 0) {
        setImportErrors(result.failed);
      }

      const parts: string[] = [];
      if (result.imported.length > 0) parts.push(`Imported ${result.imported.length} track(s)`);
      if (result.duplicates.length > 0) parts.push(`${result.duplicates.length} duplicate(s) skipped`);
      if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
      setStatusMessage(parts.join(' · '));
    } catch (err) {
      setImportErrors([
        {
          fileName: 'Import batch',
          reason: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const handlePrimaryImport = async () => {
    if (isFileSystemAccessSupported()) {
      try {
        const picked = await pickAudioFilesWithHandles();
        await handleProcessFiles(picked, false);
      } catch (err) {
        // User cancellation or abort is normal
        if (err instanceof Error && err.name === 'AbortError') return;
        // Fall back to file input if picker fails
        fileInputRef.current?.click();
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFallbackImport = () => {
    fallbackInputRef.current?.click();
  };

  const handleFileInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    forceFallback = false
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const items: PickedFileWithHandle[] = Array.from(files).map((file) => ({
      file,
    }));

    handleProcessFiles(items, forceFallback);
    // Reset file input value so same files can be re-selected if desired
    e.target.value = '';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleAnalyzeTrack = async (track: Track) => {
    try {
      const analysis = await analysisManager.analyzeTrack(track, () => decodeTrackForAnalysis(track));
      updateTrackAnalysis(track.id, analysis);
    } catch {
      // Error is stored in analysisStates
    }
  };

  const handleAnalyzeAll = () => {
    for (const t of trackList) {
      if (!t.analysis) {
        void handleAnalyzeTrack(t);
      }
    }
  };

  const handleCancelAnalysis = (trackId: string) => {
    analysisManager.cancel(trackId);
  };

  return (
    <div data-testid="screen-library" className="p-4 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Music Library</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            {trackList.length} track{trackList.length === 1 ? '' : 's'} in local library
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Analyze All Button */}
          {trackList.length > 0 && (
            <button
              data-testid="btn-analyze-all"
              onClick={handleAnalyzeAll}
              className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-xl font-medium shadow-md shadow-violet-600/20 active:scale-95 flex items-center gap-1.5 transition-all"
            >
              <span>⚡</span>
              <span>Analyze All</span>
            </button>
          )}

          {/* Primary Import Button */}
          <button
            data-testid="btn-import-primary"
            onClick={handlePrimaryImport}
            disabled={isImporting}
            className="flex-1 sm:flex-initial px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center justify-center gap-2"
          >
            <span>📥</span>
            <span>Import Music</span>
          </button>

          {/* Forced Fallback Button for testing & non-FSA browsers */}
          <button
            data-testid="btn-import-fallback"
            onClick={handleFallbackImport}
            disabled={isImporting}
            title="Import using standard file input and OPFS fallback"
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-xl font-medium border border-gray-700/60 active:scale-95"
          >
            Fallback
          </button>
        </div>
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg"
        className="hidden"
        onChange={(e) => handleFileInputChange(e, false)}
      />
      <input
        ref={fallbackInputRef}
        type="file"
        multiple
        data-testid="input-file-fallback"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg"
        className="hidden"
        onChange={(e) => handleFileInputChange(e, true)}
      />

      {/* Import Progress Bar */}
      {isImporting && importProgress && (
        <div data-testid="import-progress" className="p-3 bg-gray-900 border border-indigo-500/30 rounded-xl space-y-2">
          <div className="flex justify-between text-xs text-indigo-300 font-medium">
            <span>Importing audio files...</span>
            <span>
              {importProgress.current} / {importProgress.total}
            </span>
          </div>
          <div className="w-full bg-gray-950 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-1.5 transition-all duration-200"
              style={{
                width: `${(importProgress.current / importProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Status Notice */}
      {statusMessage && (
        <div data-testid="import-status-msg" className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-emerald-400 hover:text-emerald-200 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Notices */}
      {importErrors.length > 0 && (
        <div data-testid="import-error-banner" className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1.5">
          <div className="font-semibold flex items-center justify-between">
            <span>Failed to import {importErrors.length} file(s):</span>
            <button
              onClick={() => setImportErrors([])}
              className="text-rose-400 hover:text-rose-200"
            >
              ✕
            </button>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] opacity-90 max-h-32 overflow-y-auto">
            {importErrors.map((err, idx) => (
              <li key={idx}>
                <span className="font-mono text-rose-200">{err.fileName}</span>: {err.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Track List or Empty State */}
      {trackList.length === 0 ? (
        <div
          data-testid="library-empty-state"
          className="border-2 border-dashed border-gray-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3 mt-4"
        >
          <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-xl">
            🎵
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-200">No tracks in library</h3>
            <p className="text-xs text-gray-500 max-w-xs">
              Add your local MP3, M4A, FLAC, WAV, or OGG tracks to start building continuous mixes.
            </p>
          </div>
          <button
            onClick={handlePrimaryImport}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-xl transition-colors shadow-md"
          >
            Select Audio Files
          </button>
        </div>
      ) : (
        <div data-testid="track-list" className="space-y-2">
          {trackList.map((track) => (
            <TrackItem
              key={track.id}
              track={track}
              analysisState={analysisStates[track.id]}
              formatSize={formatFileSize}
              onRemove={() => removeTrack(track.id)}
              onAnalyze={() => void handleAnalyzeTrack(track)}
              onCancelAnalysis={() => handleCancelAnalysis(track.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TrackItem: React.FC<{
  track: Track;
  analysisState?: AnalysisState;
  formatSize: (bytes: number) => string;
  onRemove: () => void;
  onAnalyze: () => void;
  onCancelAnalysis: () => void;
}> = ({ track, analysisState, formatSize, onRemove, onAnalyze, onCancelAnalysis }) => {
  const analysis = track.analysis;
  const status = analysisState?.status || (analysis ? 'done' : 'idle');
  const progress = analysisState?.progress ?? 0;

  return (
    <div
      data-testid={`track-item-${track.id}`}
      className="p-3 bg-gray-900/60 hover:bg-gray-900 border border-gray-800/80 rounded-xl flex items-center justify-between gap-3 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-sm flex-shrink-0">
          🎧
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-200 truncate" title={track.title}>
            {track.title}
          </div>
          <div className="text-[11px] text-gray-400 truncate flex items-center gap-1.5 mt-0.5">
            {track.artist && <span>{track.artist} · </span>}
            <span className="font-mono text-gray-500">{track.fileName}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* BPM & Key Badges if analyzed */}
        {analysis && (
          <div className="flex items-center gap-1.5">
            <span
              data-testid={`badge-bpm-${track.id}`}
              className="px-2 py-0.5 bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded text-[10px] font-mono font-semibold"
            >
              {Math.round(analysis.bpm)} BPM
            </span>
            <span
              data-testid={`badge-key-${track.id}`}
              className="px-2 py-0.5 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded text-[10px] font-mono font-semibold"
            >
              {analysis.key.camelot}
            </span>
          </div>
        )}

        {/* Dynamic Analysis Status */}
        {!analysis && status === 'analyzing' && (
          <div className="flex items-center gap-1.5">
            <span
              data-testid={`status-analyzing-${track.id}`}
              className="text-[10px] text-indigo-400 font-mono animate-pulse"
            >
              Analyzing {Math.round(progress * 100)}%
            </span>
            <button
              data-testid={`btn-cancel-analysis-${track.id}`}
              onClick={onCancelAnalysis}
              className="text-gray-400 hover:text-rose-400 text-xs px-1"
              title="Cancel analysis"
            >
              ✕
            </button>
          </div>
        )}

        {!analysis && status === 'queued' && (
          <span
            data-testid={`status-queued-${track.id}`}
            className="text-[10px] text-gray-400 font-mono bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/50"
          >
            Queued
          </span>
        )}

        {!analysis && status === 'failed' && (
          <div className="flex items-center gap-1.5">
            <span
              data-testid={`status-failed-${track.id}`}
              className="text-[10px] text-rose-400 font-mono bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20"
            >
              Failed
            </span>
            <button
              data-testid={`btn-retry-analysis-${track.id}`}
              onClick={onAnalyze}
              className="text-gray-400 hover:text-amber-400 text-xs"
              title="Retry analysis"
            >
              ↺
            </button>
          </div>
        )}

        {!analysis && (status === 'idle' || status === 'cancelled') && (
          <button
            data-testid={`btn-analyze-${track.id}`}
            onClick={onAnalyze}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700/60 transition-colors"
          >
            Analyze
          </button>
        )}

        {/* Source badge */}
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            track.source.kind === 'fileHandle'
              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}
        >
          {track.source.kind === 'fileHandle' ? 'Handle' : 'OPFS'}
        </span>

        {/* File Size */}
        <span className="text-[10px] text-gray-500 font-mono hidden sm:inline">
          {track.sizeBytes > 0 ? formatSize(track.sizeBytes) : ''}
        </span>

        {/* Delete Action */}
        <button
          data-testid={`btn-remove-${track.id}`}
          onClick={onRemove}
          className="text-gray-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors text-xs"
          title="Remove track"
        >
          🗑️
        </button>
      </div>
    </div>
  );
};

export const PlaylistScreen: React.FC = () => (
  <div data-testid="screen-playlist" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Playlist Queue</h2>
    <p className="text-gray-400 text-sm">Organize tracks for continuous DJ mixing.</p>
  </div>
);

export const NowMixingScreen: React.FC = () => {
  const [crossfadeSec, setCrossfadeSec] = useState(4);
  const [activeDeck, setActiveDeck] = useState<'A' | 'B'>('A');
  const [deckAStatus, setDeckAStatus] = useState<string>('idle');
  const [deckBStatus, setDeckBStatus] = useState<string>('idle');
  const [deckAPos, setDeckAPos] = useState(0);
  const [deckBPos, setDeckBPos] = useState(0);
  const [deckADur, setDeckADur] = useState(0);
  const [deckBDur, setDeckBDur] = useState(0);

  const getMixer = () => {
    try {
      return getTwoDeckMixer();
    } catch {
      return null;
    }
  };

  // Sync positions periodically for display
  useEffect(() => {
    const timer = setInterval(() => {
      const mixer = getMixer();
      if (mixer) {
        setDeckAPos(mixer.deckA.getCurrentTime());
        setDeckBPos(mixer.deckB.getCurrentTime());
        setDeckADur(mixer.deckA.duration);
        setDeckBDur(mixer.deckB.duration);
        setDeckAStatus(mixer.deckA.state);
        setDeckBStatus(mixer.deckB.state);
      }
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const handleLoadDemoDecks = async () => {
    const mixer = getMixer();
    if (!mixer) return;

    // Create 10-second synthetic audio buffers for Deck A (440Hz) and Deck B (880Hz)
    const ctx = mixer.context;
    const dur = 10;
    const sampleRate = ctx.sampleRate;

    const bufA = ctx.createBuffer(1, sampleRate * dur, sampleRate);
    const dataA = bufA.getChannelData(0);
    for (let i = 0; i < dataA.length; i++) {
      dataA[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4;
    }

    const bufB = ctx.createBuffer(1, sampleRate * dur, sampleRate);
    const dataB = bufB.getChannelData(0);
    for (let i = 0; i < dataB.length; i++) {
      dataB[i] = Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 0.4;
    }

    mixer.deckA.loadBuffer(bufA, 'demo-track-a');
    mixer.deckB.loadBuffer(bufB, 'demo-track-b');
    setDeckADur(dur);
    setDeckBDur(dur);
    setDeckAStatus('ready');
    setDeckBStatus('ready');
  };

  const handlePlayDeck = async (deckId: 'A' | 'B') => {
    const mixer = getMixer();
    if (!mixer) return;
    const deck = deckId === 'A' ? mixer.deckA : mixer.deckB;
    if (deck.state === 'playing') {
      deck.pause();
    } else {
      await deck.play();
    }
  };

  const handleSeek = (deckId: 'A' | 'B', sec: number) => {
    const mixer = getMixer();
    if (!mixer) return;
    const deck = deckId === 'A' ? mixer.deckA : mixer.deckB;
    deck.seek(sec);
  };

  const handleCrossfade = () => {
    const mixer = getMixer();
    if (!mixer) return;
    const nextDeck = activeDeck === 'A' ? 'B' : 'A';
    mixer.crossfade(activeDeck, crossfadeSec);
    setActiveDeck(nextDeck);
  };

  return (
    <div data-testid="screen-now-mixing" className="p-4 space-y-4">
      {/* Title & Setup */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Now Mixing</h2>
          <p className="text-gray-400 text-xs">Equal-power dual-deck playback engine</p>
        </div>
        <button
          data-testid="btn-load-demo-decks"
          onClick={handleLoadDemoDecks}
          className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs text-indigo-300 font-medium border border-gray-700/60"
        >
          Load Demo Decks
        </button>
      </div>

      {/* Dual Decks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Deck A */}
        <div
          data-testid="deck-a-card"
          className={`p-4 rounded-2xl bg-gray-900/80 border transition-all ${
            activeDeck === 'A' ? 'border-indigo-500/50 shadow-lg shadow-indigo-500/10' : 'border-gray-800'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase font-bold tracking-wider text-indigo-400">
              Deck A {activeDeck === 'A' ? '(Live)' : ''}
            </span>
            <span
              data-testid="deck-a-status"
              className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 font-mono"
            >
              {deckAStatus}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-xs text-gray-400 font-mono">
              <span>{deckAPos.toFixed(1)}s</span>
              <span>{deckADur.toFixed(1)}s</span>
            </div>

            <input
              type="range"
              data-testid="deck-a-seek"
              min="0"
              max={deckADur || 10}
              step="0.1"
              value={deckAPos}
              onChange={(e) => handleSeek('A', parseFloat(e.target.value))}
              className="w-full accent-indigo-500 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
            />

            <div className="flex gap-2">
              <button
                data-testid="btn-play-deck-a"
                onClick={() => handlePlayDeck('A')}
                className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md active:scale-95"
              >
                {deckAStatus === 'playing' ? 'Pause Deck A' : 'Play Deck A'}
              </button>
            </div>
          </div>
        </div>

        {/* Deck B */}
        <div
          data-testid="deck-b-card"
          className={`p-4 rounded-2xl bg-gray-900/80 border transition-all ${
            activeDeck === 'B' ? 'border-purple-500/50 shadow-lg shadow-purple-500/10' : 'border-gray-800'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase font-bold tracking-wider text-purple-400">
              Deck B {activeDeck === 'B' ? '(Live)' : ''}
            </span>
            <span
              data-testid="deck-b-status"
              className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 font-mono"
            >
              {deckBStatus}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-xs text-gray-400 font-mono">
              <span>{deckBPos.toFixed(1)}s</span>
              <span>{deckBDur.toFixed(1)}s</span>
            </div>

            <input
              type="range"
              data-testid="deck-b-seek"
              min="0"
              max={deckBDur || 10}
              step="0.1"
              value={deckBPos}
              onChange={(e) => handleSeek('B', parseFloat(e.target.value))}
              className="w-full accent-purple-500 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
            />

            <div className="flex gap-2">
              <button
                data-testid="btn-play-deck-b"
                onClick={() => handlePlayDeck('B')}
                className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md active:scale-95"
              >
                {deckBStatus === 'playing' ? 'Pause Deck B' : 'Play Deck B'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Crossfader Section */}
      <div className="p-4 rounded-2xl bg-gradient-to-b from-gray-900 to-gray-950 border border-gray-800 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-300">Equal-Power Crossfader</span>
          <div className="flex items-center gap-1.5">
            {[2, 4, 8, 16].map((sec) => (
              <button
                key={sec}
                onClick={() => setCrossfadeSec(sec)}
                className={`px-2 py-0.5 rounded-lg font-mono text-[11px] ${
                  crossfadeSec === sec
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        <button
          data-testid="btn-trigger-crossfade"
          onClick={handleCrossfade}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 active:scale-98 transition-all"
        >
          Crossfade to Deck {activeDeck === 'A' ? 'B' : 'A'} ({crossfadeSec}s Equal Power)
        </button>
      </div>
    </div>
  );
};

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
