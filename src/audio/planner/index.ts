import type { Settings, Track, TrackAnalysis, TransitionPlan } from '@/shared/types';

/**
 * PURE FUNCTIONS: Transition planning, key compatibility, ordering.
 * Never contain UI or AudioContext code.
 */

export function camelotCompatible(k1: string, k2: string): boolean {
  if (k1 === k2) return true;
  const num1 = parseInt(k1, 10);
  const num2 = parseInt(k2, 10);
  const letter1 = k1.slice(-1);
  const letter2 = k2.slice(-1);

  if (isNaN(num1) || isNaN(num2)) return false;

  if (num1 === num2) return true;

  if (letter1 === letter2) {
    const diff = Math.abs(num1 - num2);
    return diff === 1 || diff === 11;
  }

  return false;
}

export function orderPlaylist(tracks: Track[], _settings: Settings): Track[] {
  return [...tracks];
}

export function planTransition(
  _a: TrackAnalysis,
  _b: TrackAnalysis,
  settings: Settings
): TransitionPlan {
  return {
    outgoingStartSec: 0,
    incomingStartSec: 0,
    durationBars: settings.mixBars,
    durationSec: 16,
    incomingRate: 1.0,
    rateRamp: 'toNeutral',
    style: settings.transitionStyle,
  };
}
