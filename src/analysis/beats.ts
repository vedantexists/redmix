// BPM and beat grid analysis

export interface BeatGridResult {
  bpm: number;
  bpmConfidence: number;
  firstBeatSec: number;
}

/**
 * Analyzes mono PCM audio to estimate BPM, beat confidence, and first beat timestamp.
 */
export function analyzeBeats(pcm: Float32Array, sampleRate: number): BeatGridResult {
  if (!pcm || pcm.length === 0 || sampleRate <= 0) {
    return { bpm: 120, bpmConfidence: 0, firstBeatSec: 0 };
  }

  // 1. Frame-based energy envelope
  // Approx 200 frames per second (5 ms resolution)
  const hopSize = Math.max(1, Math.floor(sampleRate / 200));
  const numFrames = Math.floor(pcm.length / hopSize);
  if (numFrames < 10) {
    return { bpm: 120, bpmConfidence: 0, firstBeatSec: 0 };
  }

  const fps = sampleRate / hopSize;
  const energy = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hopSize;
    const end = Math.min(start + hopSize, pcm.length);
    for (let i = start; i < end; i++) {
      const s = pcm[i] ?? 0;
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / (end - start));
  }

  // 2. Onset novelty curve: half-wave rectified difference
  const onsets = new Float32Array(numFrames);
  let maxOnset = 0;
  for (let f = 1; f < numFrames; f++) {
    const diff = (energy[f] ?? 0) - (energy[f - 1] ?? 0);
    if (diff > 0) {
      onsets[f] = diff;
      if (diff > maxOnset) maxOnset = diff;
    }
  }

  if (maxOnset === 0) {
    return { bpm: 120, bpmConfidence: 0, firstBeatSec: 0 };
  }

  // 3. Autocorrelation over lag range [minLag, maxLag]
  // Target BPM: 50 to 220 BPM
  const minLag = Math.floor((fps * 60) / 220);
  const maxLag = Math.min(numFrames - 1, Math.ceil((fps * 60) / 50));

  if (maxLag <= minLag) {
    return { bpm: 120, bpmConfidence: 0, firstBeatSec: 0 };
  }

  const corr = new Float32Array(maxLag + 1);
  const maxSearchFrames = Math.min(numFrames, Math.floor(fps * 30)); // Search over up to 30s
  let meanCorr = 0;
  let corrCount = 0;
  let maxPeakVal = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    const limit = maxSearchFrames - lag;
    for (let i = 0; i < limit; i++) {
      sum += (onsets[i] ?? 0) * (onsets[i + lag] ?? 0);
      count++;
    }
    const val = count > 0 ? sum / count : 0;
    corr[lag] = val;
    if (val > maxPeakVal) maxPeakVal = val;
    meanCorr += val;
    corrCount++;
  }
  meanCorr = corrCount > 0 ? meanCorr / corrCount : 0;

  // Find fundamental beat period: the earliest prominent local peak >= 70% of max peak
  let bestLag = minLag;
  let bestPeak = -1;
  const thresholdPeak = maxPeakVal * 0.70;

  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const cur = corr[lag] ?? 0;
    const prev = corr[lag - 1] ?? 0;
    const next = corr[lag + 1] ?? 0;
    if (cur > prev && cur >= next && cur >= thresholdPeak) {
      bestPeak = cur;
      bestLag = lag;
      break;
    }
  }

  if (bestPeak <= 0) {
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      const cur = corr[lag] ?? 0;
      const prev = corr[lag - 1] ?? 0;
      const next = corr[lag + 1] ?? 0;
      if (cur > prev && cur >= next && cur > bestPeak) {
        bestPeak = cur;
        bestLag = lag;
      }
    }
  }

  if (bestPeak <= 0) {
    bestLag = minLag;
    bestPeak = corr[minLag] ?? 0;
  }

  // Parabolic interpolation for sub-frame lag accuracy
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = corr[bestLag - 1] ?? 0;
    const y1 = corr[bestLag] ?? 0;
    const y2 = corr[bestLag + 1] ?? 0;
    const denom = 2 * (y0 - 2 * y1 + y2);
    if (Math.abs(denom) > 1e-9) {
      const delta = (y0 - y2) / denom;
      if (delta >= -0.5 && delta <= 0.5) {
        refinedLag = bestLag + delta;
      }
    }
  }

  const rawBpm = (fps * 60) / refinedLag;

  // Half / double resolution: snap into [80, 170] range per AUTOMIX_PLAN.md Section 5.2
  let bpm = rawBpm;
  while (bpm < 80) {
    bpm *= 2;
  }
  while (bpm > 170) {
    bpm /= 2;
  }

  // 4. First beat estimation using circular Fourier phase of prominent onsets
  const beatPeriodSec = 60 / bpm;
  // Threshold for peak onsets
  const onsetThreshold = maxOnset * 0.15;
  let sumCos = 0;
  let sumSin = 0;
  let totalWeight = 0;
  let firstObservedOnset = -1;

  for (let f = 1; f < numFrames - 1; f++) {
    const val = onsets[f] ?? 0;
    const prev = onsets[f - 1] ?? 0;
    const next = onsets[f + 1] ?? 0;
    if (val > onsetThreshold && val >= prev && val >= next) {
      const t = f / fps;
      if (firstObservedOnset < 0) {
        firstObservedOnset = t;
      }
      const angle = 2 * Math.PI * (t / beatPeriodSec);
      sumCos += val * Math.cos(angle);
      sumSin += val * Math.sin(angle);
      totalWeight += val;
    }
  }

  let firstBeatSec = 0;
  let phaseCoherence = 0;

  if (totalWeight > 0) {
    const R = Math.sqrt(sumCos * sumCos + sumSin * sumSin);
    phaseCoherence = R / totalWeight;
    const angle = Math.atan2(sumSin, sumCos);
    // angle in [-PI, PI] -> fraction in [0, 1)
    let frac = angle / (2 * Math.PI);
    if (frac < 0) frac += 1;
    firstBeatSec = frac * beatPeriodSec;

    if (firstObservedOnset >= 0 && firstBeatSec < firstObservedOnset) {
      const barsToFirst = Math.floor((firstObservedOnset - firstBeatSec + 0.02) / beatPeriodSec);
      if (barsToFirst > 0 && firstBeatSec + barsToFirst * beatPeriodSec <= firstObservedOnset + 0.03) {
        // Correct phase retained
      }
    }
  }

  // 5. Confidence calculation
  const peakToMean = meanCorr > 0 ? (bestPeak - meanCorr) / bestPeak : 0;
  const rawConfidence = Math.max(0, Math.min(1, peakToMean * phaseCoherence));
  const bpmConfidence = Math.round(rawConfidence * 100) / 100;

  // Round BPM to 2 decimal places
  bpm = Math.round(bpm * 100) / 100;
  firstBeatSec = Math.round(firstBeatSec * 1000) / 1000;

  return {
    bpm,
    bpmConfidence,
    firstBeatSec,
  };
}
