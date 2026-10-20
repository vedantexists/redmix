import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import {
  isFileSystemAccessSupported,
  pickAudioFilesWithHandles,
  type PickedFileWithHandle,
} from '@/library/fileAccess';
import { importAudioFiles, type ImportFailure } from '@/library/importer';
import type { Track, Settings } from '@/shared/types';
import { analysisManager, type AnalysisState } from '@/analysis';
import { decodeTrackForAnalysis } from '@/library/audioDecoder';
import { playbackCoordinator } from '../services/playbackCoordinator';

export const LibraryScreen: React.FC = () => {
  const { tracks, addTracks, removeTrack, updateTrackAnalysis, addToPlaylist, addAllToPlaylist } =
    useAppStore();
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
        if (err instanceof Error && err.name === 'AbortError') return;
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
      // Handled via state
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

        <div className="flex flex-wrap items-center gap-2">
          {trackList.length > 0 && (
            <>
              <button
                data-testid="btn-add-all-to-playlist"
                onClick={() => addAllToPlaylist(trackList.map((t) => t.id))}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md transition-all flex items-center gap-1.5"
              >
                <span>📑</span>
                <span>Add All to Playlist</span>
              </button>

              <button
                data-testid="btn-analyze-all"
                onClick={handleAnalyzeAll}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium border border-gray-700 transition-colors"
              >
                Analyze All
              </button>
            </>
          )}

          <button
            data-testid="btn-primary-import"
            onClick={handlePrimaryImport}
            disabled={isImporting}
            className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all shadow-md flex items-center gap-1.5"
          >
            <span>➕</span>
            <span>{isImporting ? 'Importing...' : 'Import Audio'}</span>
          </button>

          <button
            data-testid="btn-fallback-import"
            onClick={handleFallbackImport}
            disabled={isImporting}
            className="min-h-[44px] px-3 py-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 text-xs rounded-xl border border-gray-700 transition-colors"
            title="Alternative standard file input"
          >
            Input Fallback
          </button>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        data-testid="input-file-primary"
        onChange={(e) => handleFileInputChange(e, false)}
        multiple
        accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg"
        className="hidden"
      />
      <input
        type="file"
        ref={fallbackInputRef}
        data-testid="input-file-fallback"
        onChange={(e) => handleFileInputChange(e, true)}
        multiple
        accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg"
        className="hidden"
      />

      {/* Import Progress Bar */}
      {importProgress && (
        <div data-testid="import-progress-bar" className="p-3 bg-indigo-950/40 border border-indigo-800/50 rounded-xl space-y-1.5">
          <div className="flex justify-between text-xs text-indigo-300">
            <span>Importing audio tracks...</span>
            <span className="font-mono">
              {importProgress.current} / {importProgress.total}
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200"
              style={{
                width: `${(importProgress.current / Math.max(1, importProgress.total)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Status banner */}
      {statusMessage && (
        <div data-testid="import-status-banner" className="p-3 bg-gray-900 border border-gray-800 rounded-xl text-xs text-gray-300 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-gray-500 hover:text-gray-300 text-xs p-1">
            ✕
          </button>
        </div>
      )}

      {/* Errors list */}
      {importErrors.length > 0 && (
        <div data-testid="import-error-banner" className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 space-y-1">
          <div className="flex items-center justify-between font-semibold">
            <span>Import Errors ({importErrors.length})</span>
            <button onClick={() => setImportErrors([])} className="text-rose-400 hover:text-rose-200 text-xs p-1">
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
            className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-xl transition-colors shadow-md"
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
              onAddToPlaylist={() => addToPlaylist(track.id)}
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
  onAddToPlaylist: () => void;
}> = ({ track, analysisState, formatSize, onRemove, onAnalyze, onCancelAnalysis, onAddToPlaylist }) => {
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
              className="min-h-[44px] min-w-[44px] text-gray-400 hover:text-rose-400 text-xs flex items-center justify-center"
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
              className="min-h-[44px] min-w-[44px] text-gray-400 hover:text-amber-400 text-xs flex items-center justify-center"
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
            className="min-h-[44px] px-3 py-1 rounded text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700/60 transition-colors flex items-center"
          >
            Analyze
          </button>
        )}

        {/* Add to Playlist button */}
        <button
          data-testid={`btn-add-to-playlist-${track.id}`}
          onClick={onAddToPlaylist}
          className="min-h-[44px] px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 transition-colors flex items-center gap-1"
          title="Add track to playlist"
        >
          <span>➕</span>
          <span className="hidden sm:inline">Add</span>
        </button>

        {/* File Size */}
        <span className="text-[10px] text-gray-500 font-mono hidden md:inline">
          {track.sizeBytes > 0 ? formatSize(track.sizeBytes) : ''}
        </span>

        {/* Delete Action */}
        <button
          data-testid={`btn-remove-${track.id}`}
          onClick={onRemove}
          className="min-h-[44px] min-w-[44px] text-gray-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors text-xs flex items-center justify-center"
          title="Remove track"
        >
          🗑️
        </button>
      </div>
    </div>
  );
};

export const PlaylistScreen: React.FC = () => {
  const {
    tracks,
    playlistTrackIds,
    removeFromPlaylist,
    reorderPlaylist,
    autoOrderPlaylist,
    clearPlaylist,
  } = useAppStore();

  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const playlistTracks = playlistTrackIds
    .map((id) => tracks[id])
    .filter((t): t is Track => t !== undefined);

  // Total duration in seconds
  const totalDurationSec = playlistTracks.reduce((sum, t) => sum + (t.analysis?.durationSec ?? 0), 0);

  const formatDuration = (totalSec: number): string => {
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const handleStartMix = () => {
    void playbackCoordinator.playMix(0);
  };

  return (
    <div data-testid="screen-playlist" className="p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Playlist Queue</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            {playlistTracks.length} track{playlistTracks.length === 1 ? '' : 's'}
            {totalDurationSec > 0 && ` · ${formatDuration(totalDurationSec)} total`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {playlistTracks.length > 0 && (
            <>
              <button
                data-testid="btn-auto-order"
                onClick={autoOrderPlaylist}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md transition-all flex items-center gap-1.5"
                title="Auto-order tracks using Camelot wheel harmonic mixing and BPM progression"
              >
                <span>🪄</span>
                <span>Auto-Order</span>
              </button>

              <button
                data-testid="btn-playlist-play"
                onClick={handleStartMix}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <span>▶</span>
                <span>Play Mix</span>
              </button>

              <button
                data-testid="btn-clear-playlist"
                onClick={clearPlaylist}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium border border-gray-700 transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Playlist Items */}
      {playlistTracks.length === 0 ? (
        <div
          data-testid="playlist-empty-state"
          className="border-2 border-dashed border-gray-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3 mt-4"
        >
          <div className="w-12 h-12 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center text-xl">
            📑
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-200">Playlist is empty</h3>
            <p className="text-xs text-gray-500 max-w-xs">
              Add analyzed tracks from your Library to assemble a seamless continuous DJ set.
            </p>
          </div>
        </div>
      ) : (
        <div data-testid="playlist-queue" className="space-y-2">
          {playlistTracks.map((track, idx) => (
            <div
              key={`${track.id}-${idx}`}
              data-testid={`playlist-item-${idx}`}
              draggable
              onDragStart={() => setDraggedIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedIdx !== null && draggedIdx !== idx) {
                  reorderPlaylist(draggedIdx, idx);
                }
                setDraggedIdx(null);
              }}
              className="p-3 bg-gray-900/70 hover:bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-between gap-3 transition-colors cursor-move"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-xs font-bold text-gray-500 w-5 text-right flex-shrink-0">
                  #{idx + 1}
                </span>

                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-200 truncate" title={track.title}>
                    {track.title}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate mt-0.5">
                    {track.artist || 'Unknown Artist'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Badges */}
                {track.analysis && (
                  <div className="flex items-center gap-1.5">
                    <span
                      data-testid={`playlist-item-bpm-${idx}`}
                      className="px-2 py-0.5 bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded text-[10px] font-mono font-semibold"
                    >
                      {Math.round(track.analysis.bpm)} BPM
                    </span>
                    <span
                      data-testid={`playlist-item-key-${idx}`}
                      className="px-2 py-0.5 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded text-[10px] font-mono font-semibold"
                    >
                      {track.analysis.key.camelot}
                    </span>
                    <span
                      data-testid={`playlist-item-duration-${idx}`}
                      className="text-[10px] text-gray-400 font-mono hidden sm:inline"
                    >
                      {Math.floor(track.analysis.durationSec / 60)}:
                      {Math.floor(track.analysis.durationSec % 60)
                        .toString()
                        .padStart(2, '0')}
                    </span>
                  </div>
                )}

                {/* Reorder Buttons (touch & mouse accessible) */}
                <div className="flex items-center gap-1">
                  <button
                    data-testid={`btn-move-up-${idx}`}
                    onClick={() => reorderPlaylist(idx, idx - 1)}
                    disabled={idx === 0}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 rounded-lg hover:bg-gray-800 transition-colors text-xs"
                    title="Move Up"
                  >
                    ▲
                  </button>
                  <button
                    data-testid={`btn-move-down-${idx}`}
                    onClick={() => reorderPlaylist(idx, idx + 1)}
                    disabled={idx === playlistTracks.length - 1}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30 rounded-lg hover:bg-gray-800 transition-colors text-xs"
                    title="Move Down"
                  >
                    ▼
                  </button>
                </div>

                {/* Remove button */}
                <button
                  data-testid={`btn-remove-from-playlist-${idx}`}
                  onClick={() => removeFromPlaylist(idx)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors text-xs"
                  title="Remove from queue"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const NowMixingScreen: React.FC = () => {
  const {
    isPlaying,
    currentTrack,
    nextTrack,
    inTransition,
    timeUntilTransition,
    currentPosition,
    currentDuration,
    playbackError,
    settings,
    setPlaybackError,
  } = useAppStore();

  const handleTogglePlay = () => {
    void playbackCoordinator.togglePlay();
  };

  const handleSkip = () => {
    playbackCoordinator.skipTrack();
  };

  const handleMixBarsChange = (bars: 8 | 16 | 32) => {
    playbackCoordinator.updateSettings({ mixBars: bars });
  };

  const handleStyleChange = (style: Settings['transitionStyle']) => {
    playbackCoordinator.updateSettings({ transitionStyle: style });
  };

  const formatTime = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div data-testid="screen-now-mixing" className="p-4 space-y-4">
      {/* Playback Error Banner */}
      {playbackError && (
        <div
          data-testid="playback-error-banner"
          className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-200 flex items-center justify-between shadow-lg"
        >
          <span>{playbackError}</span>
          <button
            data-testid="btn-dismiss-error"
            onClick={() => setPlaybackError(null)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-rose-300 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Screen Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Now Mixing</h2>
          <p className="text-gray-400 text-xs mt-0.5">Seamless automated harmonic blending</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
              inTransition
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse'
                : isPlaying
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
            }`}
          >
            {inTransition ? 'Mixing Now' : isPlaying ? 'Playing' : 'Paused'}
          </span>
        </div>
      </div>

      {/* Now Playing Card (Current Track) */}
      <div
        data-testid="now-mixing-current"
        className="p-5 rounded-2xl bg-gradient-to-b from-[#182033] to-[#111726] border border-indigo-500/30 shadow-xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center text-2xl flex-shrink-0">
              🎧
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                Active Track
              </span>
              <h3 className="text-base font-bold text-white truncate" title={currentTrack?.title}>
                {currentTrack ? currentTrack.title : 'No track playing'}
              </h3>
              <p className="text-xs text-gray-400 truncate">
                {currentTrack?.artist || 'Select playlist to begin'}
              </p>
            </div>
          </div>

          {currentTrack?.analysis && (
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono text-xs font-bold">
                {Math.round(currentTrack.analysis.bpm)} BPM
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold">
                {currentTrack.analysis.key.camelot}
              </span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div data-testid="now-mixing-progress" className="space-y-1.5">
          <div className="flex justify-between text-xs font-mono text-gray-400">
            <span>{formatTime(currentPosition)}</span>
            <span>{formatTime(currentDuration)}</span>
          </div>
          <div className="w-full bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
            <div
              className="bg-indigo-500 h-2 rounded-full transition-all duration-200"
              style={{
                width: `${(currentPosition / Math.max(1, currentDuration)) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Transition Countdown Badge */}
        <div
          data-testid="transition-countdown"
          className="p-2.5 rounded-xl bg-gray-950/70 border border-gray-800/80 flex items-center justify-between text-xs"
        >
          <span className="text-gray-400 flex items-center gap-1.5">
            <span>⏱️</span>
            <span>Next Transition:</span>
          </span>
          <span className="font-mono font-bold text-indigo-300">
            {inTransition
              ? `Mixing (${settings.transitionStyle})`
              : timeUntilTransition > 0
                ? `${Math.ceil(timeUntilTransition)}s`
                : nextTrack
                  ? 'Upcoming'
                  : 'End of Playlist'}
          </span>
        </div>
      </div>

      {/* Up Next Card */}
      <div
        data-testid="now-mixing-next"
        className="p-4 rounded-xl bg-gray-900/60 border border-gray-800 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center text-lg flex-shrink-0">
            ⏭️
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold tracking-wider text-purple-400">
              Up Next
            </span>
            <div className="text-xs font-semibold text-gray-200 truncate">
              {nextTrack ? nextTrack.title : 'No upcoming track'}
            </div>
            <div className="text-[11px] text-gray-400 truncate">
              {nextTrack?.artist || 'Add more tracks to queue'}
            </div>
          </div>
        </div>

        {nextTrack?.analysis && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono text-[11px] font-semibold">
              {Math.round(nextTrack.analysis.bpm)} BPM
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[11px] font-semibold">
              {nextTrack.analysis.key.camelot}
            </span>
          </div>
        )}
      </div>

      {/* Primary Transport Controls */}
      <div className="p-4 rounded-2xl bg-gray-900/90 border border-gray-800 flex items-center justify-center gap-4">
        <button
          data-testid="btn-play-pause"
          onClick={handleTogglePlay}
          className="min-h-[44px] min-w-[44px] h-12 px-6 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <span>{isPlaying ? '⏸' : '▶'}</span>
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        <button
          data-testid="btn-skip"
          onClick={handleSkip}
          className="min-h-[44px] min-w-[44px] h-12 px-5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-sm border border-gray-700/80 shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          title="Beat-aligned skip to next track"
        >
          <span>⏭</span>
          <span>Skip</span>
        </button>
      </div>

      {/* Transition Settings Controls */}
      <div
        data-testid="transition-settings"
        className="p-4 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-3"
      >
        <span className="text-xs uppercase font-bold tracking-wider text-gray-400 block">
          Transition Settings
        </span>

        {/* Mix Length */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-300">Mix Length:</span>
          <div className="flex gap-1.5">
            {([8, 16, 32] as const).map((bars) => (
              <button
                key={bars}
                data-testid={`btn-mixbars-${bars}`}
                onClick={() => handleMixBarsChange(bars)}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
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
        <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-800/80">
          <span className="text-gray-300">Style:</span>
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
                data-testid={`btn-style-${s.id}`}
                onClick={() => handleStyleChange(s.id)}
                className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
      </div>
    </div>
  );
};

export { TrackEditorScreen } from './TrackEditorScreen';

export const SettingsScreen: React.FC = () => (
  <div data-testid="screen-settings" className="p-4">
    <h2 className="text-xl font-bold text-white mb-2">Settings</h2>
    <p className="text-gray-400 text-sm">
      Configure mix duration, transition curves, and audio limits.
    </p>
  </div>
);
