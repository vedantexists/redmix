import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeBeats,
  analyzeKey,
  analyzeStructure,
  analyzeLoudness,
  runTrackAnalysis,
  CURRENT_ANALYSIS_VERSION,
  AnalysisManager,
} from '@/analysis';
import {
  generateSyntheticClickTrack,
  generateNoiseTrack,
  generateTonalTrack,
  generateStructuredTrack,
} from '../fixtures/syntheticAudio';
import { db } from '@/library/db';
import type { Track } from '@/shared/types';

describe('Milestone M3: Audio Analysis Pipeline', () => {
  beforeEach(async () => {
    await db.clearAll();
  });

  describe('BPM and Beat Tracking Accuracy', () => {
    const testCases = [
      { bpm: 110, offset: 0 },
      { bpm: 124, offset: 0 },
      { bpm: 128, offset: 0 },
      { bpm: 140, offset: 0 },
      // 2 additional BPMs
      { bpm: 100, offset: 0 },
      { bpm: 135, offset: 0 },
      // 2 non-zero offsets
      { bpm: 128, offset: 0.12 },
      { bpm: 120, offset: 0.25 },
    ];

    for (const { bpm, offset } of testCases) {
      it(`recovers ${bpm} BPM (offset ${offset}s) within 0.5 BPM and first beat within 30ms`, () => {
        const pcm = generateSyntheticClickTrack({
          bpm,
          durationSec: 10,
          firstBeatSec: offset,
          sampleRate: 44100,
        });

        const result = analyzeBeats(pcm, 44100);

        // Assert BPM within 0.5
        expect(Math.abs(result.bpm - bpm)).toBeLessThanOrEqual(0.5);

        // Assert first beat within 30 ms (0.030s)
        const beatPeriod = 60 / bpm;
        const expectedPhase = offset % beatPeriod;
        const diff = Math.abs(result.firstBeatSec - expectedPhase);
        const wrappedDiff = Math.min(diff, Math.abs(diff - beatPeriod));
        expect(wrappedDiff).toBeLessThanOrEqual(0.03);

        // High confidence on clean synthetic track
        expect(result.bpmConfidence).toBeGreaterThan(0.6);
      });
    }

    it('resolves half/double-time by snapping into 80-170 BPM range', () => {
      // 60 BPM is below 80 -> snaps to 120 BPM
      const slowPcm = generateSyntheticClickTrack({
        bpm: 60,
        durationSec: 10,
        sampleRate: 44100,
      });
      const slowResult = analyzeBeats(slowPcm, 44100);
      expect(slowResult.bpm).toBeGreaterThanOrEqual(80);
      expect(slowResult.bpm).toBeLessThanOrEqual(170);
      expect(Math.abs(slowResult.bpm - 120)).toBeLessThanOrEqual(0.5);

      // 190 BPM is above 170 -> snaps to 95 BPM
      const fastPcm = generateSyntheticClickTrack({
        bpm: 190,
        durationSec: 10,
        sampleRate: 44100,
      });
      const fastResult = analyzeBeats(fastPcm, 44100);
      expect(fastResult.bpm).toBeGreaterThanOrEqual(80);
      expect(fastResult.bpm).toBeLessThanOrEqual(170);
      expect(Math.abs(fastResult.bpm - 95)).toBeLessThanOrEqual(0.5);
    });

    it('reports low confidence on pure noise input', () => {
      const noise = generateNoiseTrack(8, 44100);
      const result = analyzeBeats(noise, 44100);
      expect(result.bpmConfidence).toBeLessThan(0.3);
    });
  });

  describe('Musical Key Detection & Camelot Mapping', () => {
    it('detects C Major (8B) or related harmonic key with high confidence', () => {
      // C Major triad: C4 (261.63), E4 (329.63), G4 (392.00)
      const pcm = generateTonalTrack([261.63, 329.63, 392.0], 5, 44100);
      const result = analyzeKey(pcm, 44100);

      expect(typeof result.camelot).toBe('string');
      expect(result.camelot).toMatch(/^[0-9]{1,2}[AB]$/);
      // C Major is 8B
      expect(result.camelot).toBe('8B');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('detects A Minor (8A) or related harmonic key with high confidence', () => {
      // A Minor triad: A4 (440.0), C5 (523.25), E5 (659.25)
      const pcm = generateTonalTrack([440.0, 523.25, 659.25], 5, 44100);
      const result = analyzeKey(pcm, 44100);

      expect(result.camelot).toMatch(/^[0-9]{1,2}[AB]$/);
      // A Minor is 8A
      expect(result.camelot).toBe('8A');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('handles silence gracefully with fallback key and zero confidence', () => {
      const silence = new Float32Array(44100);
      const result = analyzeKey(silence, 44100);
      expect(result.confidence).toBe(0);
      expect(result.camelot).toBe('8B');
    });
  });

  describe('Track Structure and Energy Analysis', () => {
    it('detects introEndSec and outroStartSec snapped to bar boundaries', () => {
      const bpm = 120;
      const barDuration = 4 * (60 / bpm); // 2.0s per bar
      const pcm = generateStructuredTrack({
        bpm,
        durationSec: 16,
        introDurationSec: 4.0, // 2 bars quiet intro
        outroStartSec: 12.0,   // outro starts at bar 6 (12s)
        sampleRate: 44100,
      });

      const structure = analyzeStructure(pcm, 44100, bpm, 0, 16);

      expect(structure.barEnergy.length).toBeGreaterThanOrEqual(8);
      // introEndSec should snap to a bar boundary around 4.0s
      expect(structure.introEndSec % barDuration).toBeCloseTo(0, 1);
      expect(structure.introEndSec).toBeGreaterThanOrEqual(2.0);
      expect(structure.introEndSec).toBeLessThanOrEqual(6.0);

      // outroStartSec should snap to a bar boundary around 12.0s
      expect(structure.outroStartSec % barDuration).toBeCloseTo(0, 1);
      expect(structure.outroStartSec).toBeGreaterThanOrEqual(10.0);
    });
  });

  describe('Loudness Normalization', () => {
    it('computes positive gain for quiet audio and negative gain for loud audio', () => {
      // Quiet track
      const quiet = generateSyntheticClickTrack({ bpm: 120, durationSec: 4, clickFrequency: 440 });
      for (let i = 0; i < quiet.length; i++) quiet[i] = (quiet[i] ?? 0) * 0.05;
      const quietResult = analyzeLoudness(quiet, -14);
      expect(quietResult.loudnessGainDb).toBeGreaterThan(0);
      expect(quietResult.loudnessGainDb).toBeLessThanOrEqual(9);

      // Loud track (dense continuous sine tone)
      const loud = new Float32Array(44100 * 2);
      for (let i = 0; i < loud.length; i++) {
        loud[i] = Math.sin(2 * Math.PI * 1000 * (i / 44100)) * 0.95;
      }
      const loudResult = analyzeLoudness(loud, -14);
      expect(loudResult.loudnessGainDb).toBeLessThan(0);
      expect(loudResult.loudnessGainDb).toBeGreaterThanOrEqual(-9);
    });

    it('clamps gain to +/- 9 dB', () => {
      // Near silent track
      const whisper = new Float32Array(44100);
      whisper.fill(0.00001);
      const res = analyzeLoudness(whisper, -14);
      expect(res.loudnessGainDb).toBe(9); // clamped to +9 dB

      // True silence returns 0
      const silence = new Float32Array(44100);
      expect(analyzeLoudness(silence).loudnessGainDb).toBe(0);
    });
  });

  describe('Full Pipeline and Caching', () => {
    it('runs full track analysis pipeline producing complete TrackAnalysis object', () => {
      const pcm = generateSyntheticClickTrack({ bpm: 128, durationSec: 8 });
      const progressSteps: number[] = [];
      const analysis = runTrackAnalysis(pcm, 44100, 8, (p) => progressSteps.push(p));

      expect(progressSteps.length).toBeGreaterThan(0);
      expect(analysis.bpm).toBeCloseTo(128, 0);
      expect(analysis.beatsPerBar).toBe(4);
      expect(analysis.key.camelot).toBeDefined();
      expect(analysis.durationSec).toBe(8);
      expect(analysis.analysisVersion).toBe(CURRENT_ANALYSIS_VERSION);
      expect(Array.isArray(analysis.barEnergy)).toBe(true);
    });

    it('caches analysis in IndexedDB and invalidates when analysisVersion is bumped', async () => {
      const manager = new AnalysisManager();
      const pcm = generateSyntheticClickTrack({ bpm: 124, durationSec: 6 });

      const track: Track = {
        id: 'test-track-cache-1',
        title: 'Cache Track',
        fileName: 'cache.wav',
        sizeBytes: 1024,
        source: { kind: 'opfs', path: '/cache.wav' },
      };

      let executionCount = 0;
      const provider = async () => {
        executionCount++;
        return { pcm: new Float32Array(pcm), sampleRate: 44100, durationSec: 6 };
      };

      // First run: executes analysis
      const analysis1 = await manager.analyzeTrack(track, provider);
      expect(executionCount).toBe(1);
      expect(analysis1.bpm).toBeCloseTo(124, 0);

      // Second run: should hit cache and NOT re-run provider
      const analysis2 = await manager.analyzeTrack(track, provider);
      expect(executionCount).toBe(1);
      expect(analysis2.bpm).toBe(analysis1.bpm);

      // Invalidate cache by setting outdated analysisVersion
      track.analysis = {
        ...analysis1,
        analysisVersion: 0, // Old version
      };
      await db.saveTrack(track);

      // Third run: outdated version forces re-analysis
      const analysis3 = await manager.analyzeTrack(track, provider);
      expect(executionCount).toBe(2);
      expect(analysis3.analysisVersion).toBe(CURRENT_ANALYSIS_VERSION);
    });

    it('handles cancellation and allows next tracks in queue to succeed', async () => {
      const manager = new AnalysisManager();
      manager.maxConcurrency = 1; // Force serial queue

      const track1: Track = {
        id: 'track-cancel-1',
        title: 'Cancel Me',
        fileName: 'cancel.wav',
        sizeBytes: 100,
        source: { kind: 'opfs', path: '/cancel.wav' },
      };

      const track2: Track = {
        id: 'track-success-2',
        title: 'Succeed Me',
        fileName: 'succeed.wav',
        sizeBytes: 100,
        source: { kind: 'opfs', path: '/succeed.wav' },
      };

      const pcm = generateSyntheticClickTrack({ bpm: 120, durationSec: 4 });

      // Queue track 1
      const p1 = manager.analyzeTrack(track1, async () => {
        return { pcm: new Float32Array(pcm), sampleRate: 44100, durationSec: 4 };
      });

      // Queue track 2
      const p2 = manager.analyzeTrack(track2, async () => {
        return { pcm: new Float32Array(pcm), sampleRate: 44100, durationSec: 4 };
      });

      // Cancel track 1
      manager.cancel(track1.id);

      await expect(p1).rejects.toThrow(/cancelled/i);
      // Track 2 should succeed despite track 1 cancellation
      const res2 = await p2;
      expect(res2.bpm).toBeCloseTo(120, 0);
    });

    it('isolates track errors without crashing subsequent queue items', async () => {
      const manager = new AnalysisManager();
      manager.maxConcurrency = 1;

      const trackFail: Track = {
        id: 'track-fail',
        title: 'Failing Track',
        fileName: 'fail.wav',
        sizeBytes: 100,
        source: { kind: 'opfs', path: '/fail.wav' },
      };

      const trackPass: Track = {
        id: 'track-pass',
        title: 'Passing Track',
        fileName: 'pass.wav',
        sizeBytes: 100,
        source: { kind: 'opfs', path: '/pass.wav' },
      };

      const pcm = generateSyntheticClickTrack({ bpm: 130, durationSec: 4 });

      const pFail = manager.analyzeTrack(trackFail, async () => {
        throw new Error('Corrupt audio buffer');
      });

      const pPass = manager.analyzeTrack(trackPass, async () => {
        return { pcm: new Float32Array(pcm), sampleRate: 44100, durationSec: 4 };
      });

      await expect(pFail).rejects.toThrow('Corrupt audio buffer');
      expect(manager.getState(trackFail.id).status).toBe('failed');

      // The passing track must complete normally
      const resPass = await pPass;
      expect(resPass.bpm).toBeCloseTo(130, 0);
      expect(manager.getState(trackPass.id).status).toBe('done');
    });
  });
});
