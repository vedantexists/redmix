// Musical key detection and Camelot mapping

export interface KeyResult {
  camelot: string;
  confidence: number;
}

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_CAMELOT: Record<number, string> = {
  0: '8B',  // C Maj
  1: '3B',  // C# / Db Maj
  2: '10B', // D Maj
  3: '5B',  // D# / Eb Maj
  4: '12B', // E Maj
  5: '7B',  // F Maj
  6: '2B',  // F# / Gb Maj
  7: '9B',  // G Maj
  8: '4B',  // G# / Ab Maj
  9: '11B', // A Maj
  10: '6B', // A# / Bb Maj
  11: '1B', // B Maj
};

const MINOR_CAMELOT: Record<number, string> = {
  0: '5A',  // C Min
  1: '12A', // C# / Db Min
  2: '7A',  // D Min
  3: '2A',  // D# / Eb Min
  4: '9A',  // E Min
  5: '4A',  // F Min
  6: '11A', // F# / Gb Min
  7: '6A',  // G Min
  8: '1A',  // G# / Ab Min
  9: '8A',  // A Min
  10: '3A', // A# / Bb Min
  11: '10A',// B Min
};

function goertzelPower(pcm: Float32Array, start: number, end: number, freq: number, sampleRate: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  const k = Math.round((len * freq) / sampleRate);
  const omega = (2 * Math.PI * k) / len;
  const coeff = 2 * Math.cos(omega);

  let s0 = 0;
  let s1 = 0;
  let s2 = 0;

  for (let i = start; i < end; i++) {
    const sample = pcm[i] ?? 0;
    s0 = sample + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.max(0, power);
}

export function analyzeKey(pcm: Float32Array, sampleRate: number): KeyResult {
  if (!pcm || pcm.length === 0 || sampleRate <= 0) {
    return { camelot: '8B', confidence: 0 };
  }

  const chroma = new Float64Array(12);
  const frameSize = 4096;
  const step = Math.max(frameSize, Math.floor(pcm.length / 32));
  const octaves = [2, 3, 4, 5];

  for (let offset = 0; offset + frameSize <= pcm.length; offset += step) {
    for (let p = 0; p < 12; p++) {
      for (const oct of octaves) {
        const freq = 440 * Math.pow(2, (p - 9) / 12 + (oct - 4));
        if (freq >= 40 && freq <= sampleRate / 2) {
          const pwr = goertzelPower(pcm, offset, offset + frameSize, freq, sampleRate);
          chroma[p] = (chroma[p] ?? 0) + pwr;
        }
      }
    }
  }

  let chromaSum = 0;
  for (let p = 0; p < 12; p++) chromaSum += chroma[p] ?? 0;
  if (chromaSum === 0) {
    return { camelot: '8B', confidence: 0 };
  }
  for (let p = 0; p < 12; p++) chroma[p] = (chroma[p] ?? 0) / chromaSum;

  const chromaMean = 1 / 12;
  let chromaVar = 0;
  for (let p = 0; p < 12; p++) {
    const diff = (chroma[p] ?? 0) - chromaMean;
    chromaVar += diff * diff;
  }

  if (chromaVar < 1e-8) {
    return { camelot: '8B', confidence: 0.1 };
  }

  let bestScore = -Infinity;
  let secondBestScore = -Infinity;
  let bestRoot = 0;
  let bestIsMajor = true;

  const correlate = (profile: number[], root: number): number => {
    let profMean = 0;
    for (let i = 0; i < 12; i++) profMean += profile[i] ?? 0;
    profMean /= 12;

    let cov = 0;
    let profVar = 0;
    for (let i = 0; i < 12; i++) {
      const chromaVal = chroma[(i + root) % 12] ?? 0;
      const profVal = profile[i] ?? 0;
      cov += (chromaVal - chromaMean) * (profVal - profMean);
      profVar += (profVal - profMean) * (profVal - profMean);
    }

    const denom = Math.sqrt(chromaVar * profVar);
    return denom > 0 ? cov / denom : 0;
  };

  for (let r = 0; r < 12; r++) {
    const majScore = correlate(MAJOR_PROFILE, r);
    if (majScore > bestScore) {
      secondBestScore = bestScore;
      bestScore = majScore;
      bestRoot = r;
      bestIsMajor = true;
    } else if (majScore > secondBestScore) {
      secondBestScore = majScore;
    }

    const minScore = correlate(MINOR_PROFILE, r);
    if (minScore > bestScore) {
      secondBestScore = bestScore;
      bestScore = minScore;
      bestRoot = r;
      bestIsMajor = false;
    } else if (minScore > secondBestScore) {
      secondBestScore = minScore;
    }
  }

  const camelot = bestIsMajor ? MAJOR_CAMELOT[bestRoot] : MINOR_CAMELOT[bestRoot];
  const margin = Math.max(0, bestScore - secondBestScore);
  const confidence = Math.round(Math.min(1, Math.max(0, bestScore * 0.7 + margin * 0.3)) * 100) / 100;

  return {
    camelot: camelot || '8B',
    confidence,
  };
}
