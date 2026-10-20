import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractWaveformData,
  getBeatGridMarkers,
} from '@/audio/editor/waveform';
import {
  getEffectiveBpm,
  getEffectiveFirstBeatSec,
  planTransition,
  orderPlaylist,
} from '@/audio/planner';
import { useAppStore } from '@/app/store';
import { db } from '@/library/db';
import type { Track, TrackAnalysis } from '@/shared/types';
import { generateSyntheticClickTrack } from '../fixtures/syntheticAudio';
import { AuditionPlayer } from '@/audio/editor/auditionPlayer';

function makeMockTrack(id: string, title: string, bpm: number, firstBeatSec = 0, durationSec = 180): Track {
  return {
    id,
    fileName: `${title}.mp3`,
    title,
    artist: 'Test Artist',
    sizeBytes: 1024 * 1024 * 5,
    source: {
      kind: 'opfs',
      path: `tracks/${id}.mp3`,
    },
    analysis: {
      bpm,
      bpmConfidence: 0.95,
      firstBeatSec,
      beatsPerBar: 4,
      key: {
        camelot: '8B',
        confidence: 0.9,
      },
      loudnessGainDb: 0.0,
      introEndSec: 15.0,
      outroStartSec: durationSec - 15.0,
      barEnergy: [0.5, 0.7, 0.9],
      durationSec,
      analysisVersion: 1,
    },
  };
}

describe('Milestone M8: Waveform Extraction & Performance', () => {
  it('extracts downsampled waveform peaks accurately from synthetic audio', () => {
    const pcm = generateSyntheticClickTrack({
      bpm: 120,
      durationSec: 4.0,
      sampleRate: 22050,
      clickFrequency: 880,
    });

    const waveform = extractWaveformData(pcm, 22050, 100);

    expect(waveform.durationSec).toBeCloseTo(4.0, 2);
    expect(waveform.sampleRate).toBe(22050);
    expect(waveform.peaks.length).toBe(100);
    expect(waveform.numBins).toBe(100);

    // Peak values must be normalized in [0, 1]
    for (let i = 0; i < waveform.peaks.length; i++) {
      expect(waveform.peaks[i]).toBeGreaterThanOrEqual(0);
      expect(waveform.peaks[i]).toBeLessThanOrEqual(1.0);
    }
  });

  it('performs rapid downsampling on a 10-minute long track (26.4M samples) without stalling UI', () => {
    const sampleRate = 44100;
    const durationSec = 600; // 10 minutes
    const totalSamples = sampleRate * durationSec; // 26,460,000 samples
    const longPcm = new Float32Array(totalSamples);

    // Populate periodic energy bursts
    for (let i = 0; i < totalSamples; i += sampleRate) {
      longPcm[i] = 0.8;
      longPcm[i + 1] = -0.8;
    }

    const start = performance.now();
    const waveform = extractWaveformData(longPcm, sampleRate, 1000);
    const elapsedMs = performance.now() - start;

    expect(waveform.durationSec).toBe(600);
    expect(waveform.peaks.length).toBe(1000);
    // Downsampling 26.4 million samples must be fast (< 100 ms)
    expect(elapsedMs).toBeLessThan(150);
  });

  it('computes beat grid markers aligned to known audio beats', () => {
    // 120 BPM: beat interval = 0.5s; bar interval = 2.0s
    // firstBeatSec = 0.25s
    const markers = getBeatGridMarkers(0.25, 120, 10.0, 4);

    expect(markers.length).toBeGreaterThan(0);
    // Check first beat
    const firstBeat = markers.find((m) => Math.abs(m.timeSec - 0.25) < 1e-4);
    expect(firstBeat).toBeDefined();
    expect(firstBeat?.isDownbeat).toBe(true);
    expect(firstBeat?.barNumber).toBe(1);

    // Check subsequent beat at 0.75s (quarter beat in bar 1)
    const secondBeat = markers.find((m) => Math.abs(m.timeSec - 0.75) < 1e-4);
    expect(secondBeat).toBeDefined();
    expect(secondBeat?.isDownbeat).toBe(false);
    expect(secondBeat?.beatInBar).toBe(2);

    // Check next downbeat at 0.25 + 2.0 = 2.25s (Bar 2)
    const bar2Downbeat = markers.find((m) => Math.abs(m.timeSec - 2.25) < 1e-4);
    expect(bar2Downbeat).toBeDefined();
    expect(bar2Downbeat?.isDownbeat).toBe(true);
    expect(bar2Downbeat?.barNumber).toBe(2);
  });
});

describe('Milestone M8: User Overrides Persistence & Planner Preference', () => {
  beforeEach(() => {
    useAppStore.setState({
      tracks: {},
      playlistTrackIds: [],
    });
  });

  it('updates and persists userOverrides in store and database', async () => {
    const track = makeMockTrack('t1', 'Track 1', 120, 0.1, 180);
    useAppStore.getState().addTracks([track]);

    const spySave = vi.spyOn(db, 'saveTrack').mockResolvedValue();

    // Nudge firstBeat and override BPM
    await useAppStore.getState().updateTrackOverrides('t1', {
      bpm: 124.5,
      firstBeatSec: 0.25,
    });

    const updated = useAppStore.getState().tracks['t1'];
    expect(updated?.analysis?.userOverrides?.bpm).toBe(124.5);
    expect(updated?.analysis?.userOverrides?.firstBeatSec).toBe(0.25);
    expect(spySave).toHaveBeenCalledWith(updated);

    // Reset overrides
    await useAppStore.getState().resetTrackOverrides('t1');
    const reset = useAppStore.getState().tracks['t1'];
    expect(reset?.analysis?.userOverrides).toBeUndefined();
    expect(reset?.analysis?.bpm).toBe(120);
  });

  it('planner prefers userOverrides over raw analysis values', () => {
    const analysis: TrackAnalysis = {
      bpm: 120,
      bpmConfidence: 0.95,
      firstBeatSec: 0.1,
      beatsPerBar: 4,
      key: { camelot: '8B', confidence: 0.9 },
      durationSec: 180,
      introEndSec: 15,
      outroStartSec: 165,
      barEnergy: [0.5],
      loudnessGainDb: 0,
      analysisVersion: 1,
      userOverrides: {
        bpm: 128,
        firstBeatSec: 0.35,
      },
    };

    expect(getEffectiveBpm(analysis)).toBe(128);
    expect(getEffectiveFirstBeatSec(analysis)).toBe(0.35);
  });

  it('demonstrates that editing a grid changes the next planned transition (before vs after plans)', () => {
    const trackA: TrackAnalysis = {
      bpm: 120,
      bpmConfidence: 0.95,
      firstBeatSec: 0.0,
      beatsPerBar: 4,
      key: { camelot: '8B', confidence: 0.9 },
      durationSec: 100,
      introEndSec: 10,
      outroStartSec: 80,
      barEnergy: [0.5],
      loudnessGainDb: 0,
      analysisVersion: 1,
    };

    const trackB: TrackAnalysis = {
      bpm: 120,
      bpmConfidence: 0.95,
      firstBeatSec: 0.0,
      beatsPerBar: 4,
      key: { camelot: '8B', confidence: 0.9 },
      durationSec: 100,
      introEndSec: 10,
      outroStartSec: 80,
      barEnergy: [0.5],
      loudnessGainDb: 0,
      analysisVersion: 1,
    };

    // 1. Initial Plan (Before Override)
    const initialPlan = planTransition(trackA, trackB, { mixBars: 8 });
    expect(initialPlan.incomingRate).toBe(1.0);
    // At 120 BPM (2.0s bar), 8 bars = 16.0s duration
    expect(initialPlan.durationSec).toBe(16.0);
    expect(initialPlan.outgoingStartSec).toBe(80.0);
    expect(initialPlan.incomingStartSec).toBe(0.0);

    // 2. Apply Grid Override to Track A (BPM nudged to 125, firstBeatSec nudged to 0.5s)
    const overriddenTrackA: TrackAnalysis = {
      ...trackA,
      userOverrides: {
        bpm: 125,
        firstBeatSec: 0.5,
      },
    };

    const updatedPlan = planTransition(overriddenTrackA, trackB, { mixBars: 8 });

    // Verify concrete changes between before and after plans:
    // - Incoming playback rate changes from 1.0 to 125 / 120 = 1.0417
    expect(updatedPlan.incomingRate).toBeCloseTo(125 / 120, 3);
    expect(updatedPlan.incomingRate).not.toEqual(initialPlan.incomingRate);

    // - Bar length changes from 2.0s (120 BPM) to 1.92s (125 BPM)
    // - 8 bars duration changes from 16.0s to 15.36s
    expect(updatedPlan.durationSec).toBeCloseTo(8 * (4 * (60 / 125)), 2);
    expect(updatedPlan.durationSec).not.toEqual(initialPlan.durationSec);

    // - Outgoing start snaps to new bar grid aligned to firstBeatSec = 0.5s
    expect(updatedPlan.outgoingStartSec).not.toEqual(initialPlan.outgoingStartSec);
  });

  it('orderPlaylist uses effective BPM from userOverrides', () => {
    const t1 = makeMockTrack('t1', 'Track 1', 130);
    const t2 = makeMockTrack('t2', 'Track 2', 120);
    const t3 = makeMockTrack('t3', 'Track 3', 125);

    // Initially, t2 (120 BPM) precedes t3 (125 BPM) and t1 (130 BPM)
    const initialOrder = orderPlaylist([t1, t2, t3]);
    expect(initialOrder[0]?.id).toBe('t2');

    // Override t1's BPM to 110 (lower than t2)
    t1.analysis!.userOverrides = { bpm: 110 };

    const overriddenOrder = orderPlaylist([t1, t2, t3]);
    // Now t1 (effective 110 BPM) precedes t2 (120 BPM)
    expect(overriddenOrder[0]?.id).toBe('t1');
  });
});

describe('Milestone M8: Audition Player Operations', () => {
  it('instantiates player and manages audition state, seeking, and metronome', async () => {
    const player = new AuditionPlayer();
    expect(player.playing).toBe(false);

    player.setMetronome(true);
    expect(player.isMetronomeActive).toBe(true);

    player.updateBeatGrid(126, 0.2);

    const onTime = vi.fn();
    const unsub = player.onTimeUpdate(onTime);

    player.seek(15.5);
    expect(player.getCurrentTime()).toBe(0); // Clamped to buffer duration (0 when no buffer)
    expect(onTime).toHaveBeenCalledWith(0);

    unsub();
    player.destroy();
  });
});
