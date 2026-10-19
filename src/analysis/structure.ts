// Track structure (intro/outro detection, bar energy)

export interface StructureResult {
  introEndSec: number;
  outroStartSec: number;
  barEnergy: number[];
}

/**
 * Computes per-bar RMS energy and determines introEndSec and outroStartSec
 * snapped to bar boundaries.
 */
export function analyzeStructure(
  pcm: Float32Array,
  sampleRate: number,
  bpm: number,
  firstBeatSec: number,
  durationSec: number
): StructureResult {
  if (!pcm || pcm.length === 0 || sampleRate <= 0 || bpm <= 0 || durationSec <= 0) {
    return { introEndSec: 0, outroStartSec: 0, barEnergy: [] };
  }

  const beatsPerBar = 4;
  const barDurationSec = beatsPerBar * (60 / bpm);

  let gridOriginSec = firstBeatSec;
  while (gridOriginSec >= barDurationSec) {
    gridOriginSec -= barDurationSec;
  }
  while (gridOriginSec < 0) {
    gridOriginSec += barDurationSec;
  }

  const numBars = Math.max(1, Math.ceil((durationSec - gridOriginSec) / barDurationSec));
  const barEnergy: number[] = new Array<number>(numBars);
  const barStartSec: number[] = new Array<number>(numBars);

  for (let b = 0; b < numBars; b++) {
    const startSec = Math.max(0, gridOriginSec + b * barDurationSec);
    const endSec = Math.min(durationSec, startSec + barDurationSec);
    barStartSec[b] = startSec;

    const startIdx = Math.floor(startSec * sampleRate);
    const endIdx = Math.min(pcm.length, Math.floor(endSec * sampleRate));
    const count = endIdx - startIdx;

    if (count <= 0) {
      barEnergy[b] = 0;
      continue;
    }

    let sumSq = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const s = pcm[i] ?? 0;
      sumSq += s * s;
    }
    barEnergy[b] = Math.sqrt(sumSq / count);
  }

  // Find median energy
  const nonZero = barEnergy.filter((e) => e > 1e-5);
  const sorted = (nonZero.length > 0 ? nonZero : [...barEnergy]).sort((a, b) => a - b);
  const medianEnergy = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const threshold = 0.7 * medianEnergy;

  // 1. introEndSec: first bar where energy >= 70% of median
  let introBarIdx = 0;
  for (let b = 0; b < numBars; b++) {
    if ((barEnergy[b] ?? 0) >= threshold) {
      introBarIdx = b;
      break;
    }
  }
  const introEndSec = Math.round((barStartSec[introBarIdx] ?? 0) * 1000) / 1000;

  // 2. outroStartSec: start of the last run of bars where energy stays >= 70% of median before final decay
  let decayStartBar = numBars;
  for (let b = numBars - 1; b >= 0; b--) {
    if ((barEnergy[b] ?? 0) >= threshold) {
      decayStartBar = b + 1;
      break;
    }
  }

  let outroBarIdx = decayStartBar < numBars ? decayStartBar : Math.max(0, numBars - 1);
  if (outroBarIdx <= introBarIdx) {
    outroBarIdx = Math.max(0, numBars - 1);
  }

  const outroStartSec = Math.round((barStartSec[outroBarIdx] ?? 0) * 1000) / 1000;

  return {
    introEndSec: Math.min(durationSec, introEndSec),
    outroStartSec: Math.min(durationSec, outroStartSec),
    barEnergy,
  };
}
