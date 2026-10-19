/**
 * Math utilities for audio processing, equal-power blending, and bar/beat math.
 */

/**
 * Convert decibels to a linear gain factor.
 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain factor to decibels.
 */
export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

/**
 * Compute equal-power crossfade gains for position t in [0, 1].
 * Satisfies gainA^2 + gainB^2 == 1.
 */
export function equalPowerGains(t: number): { gainA: number; gainB: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const angle = clamped * (Math.PI / 2);
  return {
    gainA: Math.cos(angle),
    gainB: Math.sin(angle),
  };
}

/**
 * Calculate the duration of one beat in seconds for a given BPM.
 */
export function beatDurationSec(bpm: number): number {
  if (bpm <= 0) return 0;
  return 60 / bpm;
}

/**
 * Calculate the duration of one 4/4 bar in seconds for a given BPM.
 */
export function barDurationSec(bpm: number, beatsPerBar = 4): number {
  return beatDurationSec(bpm) * beatsPerBar;
}
