// Loudness and normalization gain analysis

export interface LoudnessResult {
  loudnessGainDb: number;
}

export const DEFAULT_TARGET_LOUDNESS_DB = -14;

/**
 * Computes integrated RMS over the track and returns the gain in dB needed
 * to normalize to targetLoudnessDb, clamped to +/- 9 dB.
 */
export function analyzeLoudness(
  pcm: Float32Array,
  targetLoudnessDb = DEFAULT_TARGET_LOUDNESS_DB
): LoudnessResult {
  if (!pcm || pcm.length === 0) {
    return { loudnessGainDb: 0 };
  }

  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] ?? 0;
    sumSq += s * s;
  }

  const rms = Math.sqrt(sumSq / pcm.length);
  if (rms < 1e-6) {
    return { loudnessGainDb: 0 };
  }

  const measuredDb = 20 * Math.log10(rms);
  const rawGainDb = targetLoudnessDb - measuredDb;

  // Clamp to +/- 9 dB per AUTOMIX_PLAN.md Section 5.2
  const clampedGainDb = Math.max(-9, Math.min(9, rawGainDb));

  return {
    loudnessGainDb: Math.round(clampedGainDb * 10) / 10,
  };
}
