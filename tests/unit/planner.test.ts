import { describe, it, expect } from 'vitest';
import { camelotCompatible, orderPlaylist, planTransition } from '@/audio/planner';
import type { Settings, Track, TrackAnalysis } from '@/shared/types';
import * as fs from 'fs';
import * as path from 'path';

describe('Milestone M4: Transition Planner (Pure Functions)', () => {
  const defaultSettings: Settings = {
    mixBars: 16,
    transitionStyle: 'bassSwap',
    maxTempoStretchPct: 6,
    keyAwareOrdering: true,
    targetLoudnessDb: -14,
  };

  function createMockAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
    return {
      bpm: 124,
      bpmConfidence: 0.95,
      firstBeatSec: 0.12,
      beatsPerBar: 4,
      key: { camelot: '8A', confidence: 0.9 },
      durationSec: 180,
      introEndSec: 16,
      outroStartSec: 140,
      barEnergy: [0.1, 0.2, 0.5],
      loudnessGainDb: 0,
      analysisVersion: 1,
      ...overrides,
    };
  }

  describe('Global Purity Check', () => {
    it('contains no imports from DOM, Web Audio, React, or storage in src/audio/planner', () => {
      const plannerFile = path.resolve(__dirname, '../../src/audio/planner/index.ts');
      const content = fs.readFileSync(plannerFile, 'utf-8');

      // Check forbidden imports
      expect(content).not.toMatch(/from\s+['"]react['"]/i);
      expect(content).not.toMatch(/from\s+['"]react-dom['"]/i);
      expect(content).not.toMatch(/AudioContext/i);
      expect(content).not.toMatch(/OfflineAudioContext/i);
      expect(content).not.toMatch(/window\./i);
      expect(content).not.toMatch(/document\./i);
      expect(content).not.toMatch(/localStorage/i);
      expect(content).not.toMatch(/indexedDB/i);
      expect(content).not.toMatch(/from\s+['"].*db['"]/i);
    });
  });

  describe('Camelot Wheel Compatibility Truth Table', () => {
    it('returns true for exact matches (same number, same mode)', () => {
      expect(camelotCompatible('8A', '8A')).toBe(true);
      expect(camelotCompatible('1B', '1B')).toBe(true);
      expect(camelotCompatible('12A', '12A')).toBe(true);
    });

    it('returns true for relative major/minor (same number, different mode)', () => {
      expect(camelotCompatible('8A', '8B')).toBe(true);
      expect(camelotCompatible('8B', '8A')).toBe(true);
      expect(camelotCompatible('11A', '11B')).toBe(true);
      expect(camelotCompatible('1B', '1A')).toBe(true);
    });

    it('returns true for adjacent keys (+/- 1 step) in same mode', () => {
      expect(camelotCompatible('8A', '7A')).toBe(true);
      expect(camelotCompatible('8A', '9A')).toBe(true);
      expect(camelotCompatible('4B', '3B')).toBe(true);
      expect(camelotCompatible('4B', '5B')).toBe(true);
    });

    it('returns true for circular wraparound between 12 and 1 in same mode', () => {
      expect(camelotCompatible('12A', '1A')).toBe(true);
      expect(camelotCompatible('1A', '12A')).toBe(true);
      expect(camelotCompatible('12B', '1B')).toBe(true);
      expect(camelotCompatible('1B', '12B')).toBe(true);
    });

    it('returns false for adjacent keys with different mode', () => {
      expect(camelotCompatible('8A', '7B')).toBe(false);
      expect(camelotCompatible('8A', '9B')).toBe(false);
      expect(camelotCompatible('12A', '1B')).toBe(false);
    });

    it('returns false for harmonic distance >= 2 steps', () => {
      expect(camelotCompatible('8A', '10A')).toBe(false);
      expect(camelotCompatible('8A', '6A')).toBe(false);
      expect(camelotCompatible('1B', '3B')).toBe(false);
    });

    it('handles invalid inputs gracefully', () => {
      expect(camelotCompatible('', '8A')).toBe(false);
      expect(camelotCompatible('8A', '')).toBe(false);
      expect(camelotCompatible('invalid', '8A')).toBe(false);
      expect(camelotCompatible('13A', '1A')).toBe(false);
      expect(camelotCompatible('0B', '1B')).toBe(false);
    });
  });

  describe('Playlist Ordering (orderPlaylist)', () => {
    it('handles 0, 1, and 2 tracks correctly without throwing', () => {
      expect(orderPlaylist([], defaultSettings)).toEqual([]);

      const singleTrack: Track = {
        id: 't1',
        title: 'Track 1',
        fileName: 't1.mp3',
        sizeBytes: 100,
        source: { kind: 'opfs', path: '/t1' },
      };
      expect(orderPlaylist([singleTrack], defaultSettings)).toEqual([singleTrack]);

      const twoTracks: Track[] = [
        singleTrack,
        {
          id: 't2',
          title: 'Track 2',
          fileName: 't2.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/t2' },
        },
      ];
      const res = orderPlaylist(twoTracks, defaultSettings);
      expect(res.length).toBe(2);
      expect(res).toEqual(twoTracks);
    });

    it('does not mutate input array', () => {
      const tracks: Track[] = [
        {
          id: 't-b',
          title: 'B',
          fileName: 'b.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/b' },
          analysis: createMockAnalysis({ bpm: 128, key: { camelot: '8A', confidence: 1 } }),
        },
        {
          id: 't-a',
          title: 'A',
          fileName: 'a.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/a' },
          analysis: createMockAnalysis({ bpm: 120, key: { camelot: '8A', confidence: 1 } }),
        },
        {
          id: 't-c',
          title: 'C',
          fileName: 'c.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/c' },
          analysis: createMockAnalysis({ bpm: 124, key: { camelot: '8A', confidence: 1 } }),
        },
      ];

      const copy = [...tracks];
      const ordered = orderPlaylist(tracks, defaultSettings);

      expect(tracks).toEqual(copy);
      expect(ordered).not.toBe(tracks);
    });

    it('produces stable, deterministic output across multiple runs', () => {
      const tracks: Track[] = [
        {
          id: '3',
          title: 'Track 3',
          fileName: '3.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/3' },
          analysis: createMockAnalysis({ bpm: 130, key: { camelot: '9A', confidence: 1 } }),
        },
        {
          id: '1',
          title: 'Track 1',
          fileName: '1.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/1' },
          analysis: createMockAnalysis({ bpm: 120, key: { camelot: '8A', confidence: 1 } }),
        },
        {
          id: '2',
          title: 'Track 2',
          fileName: '2.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/2' },
          analysis: createMockAnalysis({ bpm: 124, key: { camelot: '8B', confidence: 1 } }),
        },
        {
          id: '4',
          title: 'Track 4',
          fileName: '4.mp3',
          sizeBytes: 100,
          source: { kind: 'opfs', path: '/4' },
          analysis: createMockAnalysis({ bpm: 122, key: { camelot: '8A', confidence: 1 } }),
        },
      ];

      const run1 = orderPlaylist(tracks, defaultSettings).map((t) => t.id);
      const run2 = orderPlaylist(tracks, defaultSettings).map((t) => t.id);
      const run3 = orderPlaylist(tracks, defaultSettings).map((t) => t.id);

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
    });
  });

  describe('Transition Planning (planTransition)', () => {
    it('always aligns blend start to a bar boundary of track A across various BPMs and offsets', () => {
      const testBpmList = [100, 115, 120, 124, 128, 130, 140];
      const testOffsets = [0, 0.05, 0.12, 0.25, 0.45];

      for (const bpm of testBpmList) {
        for (const offset of testOffsets) {
          const a = createMockAnalysis({
            bpm,
            firstBeatSec: offset,
            durationSec: 180,
            outroStartSec: 150,
          });
          const b = createMockAnalysis({
            bpm,
            firstBeatSec: 0.1,
            durationSec: 180,
          });

          const plan = planTransition(a, b, defaultSettings);

          const barSec = 4 * (60 / bpm);
          // Check: (plan.outgoingStartSec - offset) should be an integer multiple of barSec
          const barFraction = Math.abs((plan.outgoingStartSec - offset) / barSec);
          const roundedBars = Math.round(barFraction);
          const barDiff = Math.abs(barFraction - roundedBars) * barSec;

          expect(barDiff).toBeLessThanOrEqual(0.005);
          expect(plan.outgoingStartSec + plan.durationSec).toBeLessThanOrEqual(a.durationSec + 0.001);
          expect(plan.outgoingStartSec).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('computes correct incomingRate matching tempo ratio', () => {
      const a = createMockAnalysis({ bpm: 126 });
      const b = createMockAnalysis({ bpm: 120 });
      // 126 / 120 = 1.05 (within 6% stretch)
      const plan = planTransition(a, b, defaultSettings);
      expect(plan.incomingRate).toBeCloseTo(1.05, 3);
      expect(plan.style).toBe('bassSwap');
    });

    it('tries half/double time alternatives before falling back', () => {
      // Track A is 130 BPM, Track B is 66 BPM
      // Raw ratio: 130 / 66 = 1.969
      // Double B: 66 * 2 = 132 BPM -> 130 / 132 = 0.9848 (within 6% stretch!)
      const a = createMockAnalysis({ bpm: 130 });
      const b = createMockAnalysis({ bpm: 66 });

      const plan = planTransition(a, b, defaultSettings);
      expect(plan.incomingRate).toBeCloseTo(130 / 132, 3);
      expect(plan.style).toBe('bassSwap');
      expect(plan.fallbackReason).toBeUndefined();
    });

    it('falls back to simpleCrossfade with fallbackReason on large BPM gap', () => {
      // Gap > 6% stretch (128 vs 100 BPM)
      const a = createMockAnalysis({ bpm: 128 });
      const b = createMockAnalysis({ bpm: 100 });

      const plan = planTransition(a, b, defaultSettings);
      expect(plan.style).toBe('simpleCrossfade');
      expect(plan.fallbackReason).toBe('tempo_gap_too_large');
      expect(plan.incomingRate).toBe(1.0);
    });

    it('falls back to simpleCrossfade with fallbackReason on low confidence', () => {
      const a = createMockAnalysis({ bpm: 124, bpmConfidence: 0.4 });
      const b = createMockAnalysis({ bpm: 124, bpmConfidence: 0.9 });

      const plan = planTransition(a, b, defaultSettings);
      expect(plan.style).toBe('simpleCrossfade');
      expect(plan.fallbackReason).toBe('low_confidence');
      expect(plan.incomingRate).toBe(1.0);
    });

    it('handles short tracks by clamping durationBars to fit available track length', () => {
      const barSec = 4 * (60 / 120); // 2.0s
      // Track A only has 10 seconds total (max 5 bars)
      const a = createMockAnalysis({ bpm: 120, durationSec: 10, outroStartSec: 4 });
      const b = createMockAnalysis({ bpm: 120, durationSec: 180 });

      const plan = planTransition(a, b, { ...defaultSettings, mixBars: 16 });
      expect(plan.durationBars).toBeLessThanOrEqual(5);
      expect(plan.durationSec).toBe(plan.durationBars * barSec);
      expect(plan.outgoingStartSec + plan.durationSec).toBeLessThanOrEqual(a.durationSec + 0.001);
    });

    it('handles missing outroStartSec by blending at track end', () => {
      const a = createMockAnalysis({ bpm: 120, durationSec: 180, outroStartSec: 0 });
      const b = createMockAnalysis({ bpm: 120, durationSec: 180 });

      const plan = planTransition(a, b, defaultSettings);
      expect(plan.outgoingStartSec).toBeGreaterThan(100);
      expect(plan.outgoingStartSec + plan.durationSec).toBeLessThanOrEqual(180.001);
    });

    it('handles identical BPM with 1.0 incomingRate and bassSwap style', () => {
      const a = createMockAnalysis({ bpm: 124 });
      const b = createMockAnalysis({ bpm: 124 });

      const plan = planTransition(a, b, defaultSettings);
      expect(plan.incomingRate).toBe(1.0);
      expect(plan.style).toBe('bassSwap');
    });

    it('accepts BPM ratio exactly at maxTempoStretchPct limit', () => {
      // 120 BPM vs 127.2 BPM = exactly 6.0% stretch
      const a = createMockAnalysis({ bpm: 127.2 });
      const b = createMockAnalysis({ bpm: 120 });

      const plan = planTransition(a, b, { ...defaultSettings, maxTempoStretchPct: 6 });
      expect(plan.style).toBe('bassSwap');
      expect(plan.fallbackReason).toBeUndefined();
    });
  });
});
