import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../store';
import type { Track } from '@/shared/types';
import { getEffectiveBpm, getEffectiveFirstBeatSec } from '@/audio/planner';
import { decodeTrackForAnalysis } from '@/library/audioDecoder';
import {
  extractWaveformData,
  renderWaveformToCanvas,
  type WaveformData,
} from '@/audio/editor/waveform';
import { auditionPlayer } from '@/audio/editor/auditionPlayer';
import { AudioContextManager } from '@/audio/engine';

export const TrackEditorScreen: React.FC = () => {
  const { tracks, updateTrackOverrides, resetTrackOverrides } = useAppStore();
  const trackList = Object.values(tracks);

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    trackList[0]?.id ?? null
  );
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Update selectedTrackId if initial selection is missing
  useEffect(() => {
    if (!selectedTrackId && trackList.length > 0 && trackList[0]) {
      setSelectedTrackId(trackList[0].id);
    }
  }, [trackList, selectedTrackId]);

  const selectedTrack: Track | undefined = selectedTrackId
    ? tracks[selectedTrackId]
    : undefined;

  const effectiveBpm = selectedTrack?.analysis
    ? getEffectiveBpm(selectedTrack.analysis)
    : 120;
  const effectiveFirstBeat = selectedTrack?.analysis
    ? getEffectiveFirstBeatSec(selectedTrack.analysis)
    : 0;
  const hasOverrides = !!selectedTrack?.analysis?.userOverrides;

  // Load and decode track audio for waveform and audition
  useEffect(() => {
    if (!selectedTrack) {
      setWaveformData(null);
      auditionPlayer.stop();
      return;
    }

    let isCancelled = false;
    setIsLoadingAudio(true);

    async function loadAudio() {
      try {
        const decoded = await decodeTrackForAnalysis(selectedTrack!);
        if (isCancelled) return;

        // Extract downsampled waveform peaks
        const wf = extractWaveformData(decoded.pcm, decoded.sampleRate, 1000);
        setWaveformData(wf);

        // Convert mono PCM into AudioBuffer for audition playback
        const ctx = AudioContextManager.getInstance().getContext();
        const audioBuffer = ctx.createBuffer(
          1,
          decoded.pcm.length,
          decoded.sampleRate
        );
        audioBuffer.copyToChannel(decoded.pcm, 0);

        auditionPlayer.setBuffer(audioBuffer, effectiveBpm, effectiveFirstBeat);
      } catch {
        // Handle decoding error gracefully
      } finally {
        if (!isCancelled) setIsLoadingAudio(false);
      }
    }

    void loadAudio();

    return () => {
      isCancelled = true;
      auditionPlayer.stop();
    };
    // Only re-decode audio buffer when track ID changes; grid changes are handled by updateBeatGrid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrack?.id]);

  // Sync audition player beat grid when effective values change
  useEffect(() => {
    auditionPlayer.updateBeatGrid(effectiveBpm, effectiveFirstBeat);
  }, [effectiveBpm, effectiveFirstBeat]);

  // Subscribe to audition playback time and state
  useEffect(() => {
    const unsubTime = auditionPlayer.onTimeUpdate((time) => {
      setCurrentTime(time);
    });
    const unsubState = auditionPlayer.onStateChange((playing) => {
      setIsPlaying(playing);
    });

    return () => {
      unsubTime();
      unsubState();
    };
  }, []);

  // Redraw waveform and beat grid on canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;

    renderWaveformToCanvas(canvas, waveformData, {
      firstBeatSec: effectiveFirstBeat,
      bpm: effectiveBpm,
      currentTime,
    });
  }, [waveformData, effectiveFirstBeat, effectiveBpm, currentTime]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Canvas click to seek audition player
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData || waveformData.durationSec <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSec = progress * waveformData.durationSec;

    auditionPlayer.seek(targetSec);
    setCurrentTime(targetSec);
  };

  // Nudge First Beat
  const handleNudge = async (deltaSec: number) => {
    if (!selectedTrack?.id || !selectedTrack.analysis) return;
    const newFirstBeat = Math.max(
      0,
      Math.round((effectiveFirstBeat + deltaSec) * 1000) / 1000
    );
    await updateTrackOverrides(selectedTrack.id, { firstBeatSec: newFirstBeat });
  };

  // BPM Multipliers
  const handleHalfBpm = async () => {
    if (!selectedTrack?.id || !selectedTrack.analysis) return;
    const newBpm = Math.max(40, Math.round((effectiveBpm / 2) * 100) / 100);
    await updateTrackOverrides(selectedTrack.id, { bpm: newBpm });
  };

  const handleDoubleBpm = async () => {
    if (!selectedTrack?.id || !selectedTrack.analysis) return;
    const newBpm = Math.min(260, Math.round((effectiveBpm * 2) * 100) / 100);
    await updateTrackOverrides(selectedTrack.id, { bpm: newBpm });
  };

  const handleAdjustBpm = async (delta: number) => {
    if (!selectedTrack?.id || !selectedTrack.analysis) return;
    const newBpm = Math.max(40, Math.min(260, Math.round((effectiveBpm + delta) * 10) / 10));
    await updateTrackOverrides(selectedTrack.id, { bpm: newBpm });
  };

  // Tap to set first beat to current audition time
  const handleTapFirstBeat = async () => {
    if (!selectedTrack?.id || !selectedTrack.analysis) return;
    const tappedBeat = Math.max(0, Math.round(currentTime * 1000) / 1000);
    await updateTrackOverrides(selectedTrack.id, { firstBeatSec: tappedBeat });
  };

  // Reset Overrides
  const handleResetOverrides = async () => {
    if (!selectedTrack?.id) return;
    await resetTrackOverrides(selectedTrack.id);
  };

  // Audition Controls
  const handleToggleAudition = async () => {
    if (isPlaying) {
      auditionPlayer.pause();
    } else {
      await auditionPlayer.play();
    }
  };

  const handleToggleMetronome = () => {
    const nextState = !metronomeEnabled;
    setMetronomeEnabled(nextState);
    auditionPlayer.setMetronome(nextState);
  };

  const formatTime = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(2);
    return `${mins}:${s.padStart(5, '0')}`;
  };

  if (trackList.length === 0) {
    return (
      <div data-testid="screen-track-editor" className="p-6 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-3xl">
          ✏️
        </div>
        <h2 className="text-xl font-bold text-white">Track Editor</h2>
        <p className="text-gray-400 text-sm max-w-sm mx-auto">
          No tracks available to edit. Import audio tracks from your Library first.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="screen-track-editor" className="p-4 space-y-4">
      {/* Header & Track Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Beat Grid Editor</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            Fine-tune beat grid, nudge downbeats, and audition alignment
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="editor-track-select" className="text-xs text-gray-400">
            Track:
          </label>
          <select
            id="editor-track-select"
            data-testid="select-editor-track"
            value={selectedTrackId || ''}
            onChange={(e) => setSelectedTrackId(e.target.value)}
            className="min-h-[44px] px-3 py-2 bg-gray-900 border border-gray-700 rounded-xl text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
          >
            {trackList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Editor Status Badges */}
      <div className="p-3 bg-gray-900/80 border border-gray-800 rounded-2xl flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            data-testid="badge-editor-bpm"
            className="px-3 py-1 rounded-lg bg-violet-500/20 text-violet-300 font-mono text-xs font-bold border border-violet-500/30"
          >
            {effectiveBpm.toFixed(1)} BPM
          </span>

          <span
            data-testid="badge-editor-first-beat"
            className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold border border-emerald-500/30"
          >
            Beat 1: {effectiveFirstBeat.toFixed(3)}s
          </span>

          {hasOverrides && (
            <span
              data-testid="badge-override-active"
              className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold uppercase tracking-wider border border-amber-500/40"
            >
              User Override Active
            </span>
          )}
        </div>

        {hasOverrides && (
          <button
            data-testid="btn-reset-overrides"
            onClick={handleResetOverrides}
            className="min-h-[44px] px-3 py-1 text-xs text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors flex items-center gap-1"
          >
            <span>↺</span>
            <span>Reset Overrides</span>
          </button>
        )}
      </div>

      {/* Waveform & Beat Grid Canvas Display */}
      <div className="relative rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden shadow-inner">
        {isLoadingAudio && (
          <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center z-10">
            <span className="text-xs font-mono text-indigo-400 animate-pulse">
              Extracting waveform & beat grid...
            </span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          data-testid="waveform-canvas"
          width={800}
          height={160}
          onClick={handleCanvasClick}
          className="w-full h-40 cursor-crosshair block"
        />

        {/* Legend / Timeline Footer */}
        <div className="px-3 py-1.5 bg-[#080B12] border-t border-gray-800/80 flex items-center justify-between text-[11px] font-mono text-gray-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              <span>Downbeat (Bar 1)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-500 inline-block" />
              <span>Quarter Beats</span>
            </span>
          </div>
          <span className="text-indigo-400 font-bold">
            Pos: {formatTime(currentTime)} / {formatTime(waveformData?.durationSec ?? 0)}
          </span>
        </div>
      </div>

      {/* Audition Player Transport */}
      <div className="p-4 bg-gray-900/90 border border-gray-800 rounded-2xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            data-testid="btn-audition-play"
            onClick={handleToggleAudition}
            className="min-h-[44px] min-w-[44px] px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
          >
            <span>{isPlaying ? '⏸' : '▶'}</span>
            <span>{isPlaying ? 'Pause Audition' : 'Audition Play'}</span>
          </button>

          <button
            data-testid="btn-audition-metronome"
            onClick={handleToggleMetronome}
            className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
              metronomeEnabled
                ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
            }`}
            title="Tick audible metronome clicks on beat grid markers"
          >
            <span>🔔</span>
            <span>Metronome: {metronomeEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <button
          data-testid="btn-tap-first-beat"
          onClick={handleTapFirstBeat}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
          title="Lock first beat to the current playhead position"
        >
          <span>🎯</span>
          <span>Set Beat 1 Here</span>
        </button>
      </div>

      {/* Fine-Tuning Grid Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Nudge First Beat */}
        <div className="p-4 bg-gray-900/70 border border-gray-800 rounded-2xl space-y-3">
          <span className="text-xs uppercase font-bold tracking-wider text-gray-400 block">
            Nudge Beat Grid (Offset)
          </span>

          <div className="flex items-center gap-2">
            <button
              data-testid="btn-nudge-left"
              onClick={() => void handleNudge(-0.01)}
              className="min-h-[44px] flex-1 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-mono font-semibold border border-gray-700 transition-colors"
            >
              -10 ms
            </button>
            <button
              data-testid="btn-nudge-left-fine"
              onClick={() => void handleNudge(-0.001)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white text-xs font-mono border border-gray-700 transition-colors"
            >
              -1 ms
            </button>
            <button
              data-testid="btn-nudge-right-fine"
              onClick={() => void handleNudge(0.001)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white text-xs font-mono border border-gray-700 transition-colors"
            >
              +1 ms
            </button>
            <button
              data-testid="btn-nudge-right"
              onClick={() => void handleNudge(0.01)}
              className="min-h-[44px] flex-1 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-mono font-semibold border border-gray-700 transition-colors"
            >
              +10 ms
            </button>
          </div>
        </div>

        {/* BPM Adjustments */}
        <div className="p-4 bg-gray-900/70 border border-gray-800 rounded-2xl space-y-3">
          <span className="text-xs uppercase font-bold tracking-wider text-gray-400 block">
            BPM Resolution & Fine-Tuning
          </span>

          <div className="flex items-center gap-2">
            <button
              data-testid="btn-half-bpm"
              onClick={handleHalfBpm}
              className="min-h-[44px] flex-1 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-mono font-bold border border-gray-700 transition-colors"
              title="Halve BPM (/2)"
            >
              / 2
            </button>
            <button
              data-testid="btn-double-bpm"
              onClick={handleDoubleBpm}
              className="min-h-[44px] flex-1 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-mono font-bold border border-gray-700 transition-colors"
              title="Double BPM (*2)"
            >
              x 2
            </button>
            <button
              data-testid="btn-bpm-dec"
              onClick={() => void handleAdjustBpm(-0.5)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-mono font-semibold border border-gray-700 transition-colors"
            >
              -0.5
            </button>
            <button
              data-testid="btn-bpm-inc"
              onClick={() => void handleAdjustBpm(0.5)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-mono font-semibold border border-gray-700 transition-colors"
            >
              +0.5
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
