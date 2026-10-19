import { describe, it, expect } from 'vitest';
import {
  equalPowerGains,
  dbToGain,
  gainToDb,
  beatDurationSec,
  barDurationSec,
} from '@/shared/math';
import { camelotCompatible } from '@/audio/planner';
import { generateSyntheticClickTrack } from '../fixtures';

describe('Shared Audio Math Utilities', () => {
  it('equalPowerGains satisfies gainA^2 + gainB^2 == 1 across the transition', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1.0];
    for (const t of steps) {
      const { gainA, gainB } = equalPowerGains(t);
      const sumOfSquares = gainA * gainA + gainB * gainB;
      expect(sumOfSquares).toBeCloseTo(1.0, 5);
    }
  });

  it('dbToGain and gainToDb convert accurately', () => {
    expect(dbToGain(0)).toBeCloseTo(1.0, 5);
    expect(dbToGain(-6)).toBeCloseTo(0.501187, 4);
    expect(gainToDb(1.0)).toBeCloseTo(0, 5);
    expect(gainToDb(dbToGain(-3))).toBeCloseTo(-3, 5);
  });

  it('calculates beat and bar durations accurately', () => {
    expect(beatDurationSec(120)).toBeCloseTo(0.5, 5);
    expect(barDurationSec(120, 4)).toBeCloseTo(2.0, 5);
  });
});

describe('Camelot Key Compatibility', () => {
  it('returns true for matching keys, relative keys, and adjacent keys', () => {
    expect(camelotCompatible('8A', '8A')).toBe(true);
    expect(camelotCompatible('8A', '8B')).toBe(true);
    expect(camelotCompatible('8A', '9A')).toBe(true);
    expect(camelotCompatible('8A', '7A')).toBe(true);
    expect(camelotCompatible('12A', '1A')).toBe(true);
    expect(camelotCompatible('1A', '12A')).toBe(true);
  });

  it('returns false for incompatible keys', () => {
    expect(camelotCompatible('8A', '10A')).toBe(false);
    expect(camelotCompatible('8A', '3B')).toBe(false);
  });
});

describe('Synthetic Audio Fixtures', () => {
  it('generates synthetic audio PCM buffer with expected sample count', () => {
    const pcm = generateSyntheticClickTrack({
      bpm: 120,
      durationSec: 1,
      sampleRate: 44100,
    });
    expect(pcm.length).toBe(44100);
    // Should have non-zero signal
    let hasSignal = false;
    for (let i = 0; i < pcm.length; i++) {
      if (pcm[i] !== 0) {
        hasSignal = true;
        break;
      }
    }
    expect(hasSignal).toBe(true);
  });
});
