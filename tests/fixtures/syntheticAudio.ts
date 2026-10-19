/**
 * Synthetic audio fixture generator for tests.
 * Generates click/kick audio buffers without any copyrighted audio.
 */

export interface SyntheticTrackOptions {
  bpm: number;
  durationSec: number;
  firstBeatSec?: number;
  sampleRate?: number;
  clickFrequency?: number;
  clickDurationSec?: number;
}

export function generateSyntheticClickTrack(options: SyntheticTrackOptions): Float32Array {
  const {
    bpm,
    durationSec,
    firstBeatSec = 0,
    sampleRate = 44100,
    clickFrequency = 880,
    clickDurationSec = 0.02,
  } = options;

  if (bpm <= 0 || durationSec <= 0) {
    return new Float32Array(0);
  }

  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(totalSamples);
  const beatIntervalSec = 60 / bpm;

  let currentBeatTime = firstBeatSec;
  while (currentBeatTime < durationSec) {
    const startIndex = Math.floor(currentBeatTime * sampleRate);
    const clickSamples = Math.floor(clickDurationSec * sampleRate);

    for (let i = 0; i < clickSamples && startIndex + i < totalSamples; i++) {
      const t = i / sampleRate;
      // Exponential decay envelope
      const env = Math.exp(-t * 60);
      pcm[startIndex + i] = Math.sin(2 * Math.PI * clickFrequency * t) * env;
    }

    currentBeatTime += beatIntervalSec;
  }

  return pcm;
}

/**
 * Generates pure white noise of given duration.
 */
export function generateNoiseTrack(durationSec: number, sampleRate = 44100): Float32Array {
  if (durationSec <= 0 || sampleRate <= 0) return new Float32Array(0);
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    pcm[i] = (Math.random() * 2 - 1) * 0.2;
  }
  return pcm;
}

/**
 * Generates a tonal chord track (e.g. C major chord: C, E, G or A minor chord: A, C, E)
 */
export function generateTonalTrack(
  frequencies: number[],
  durationSec: number,
  sampleRate = 44100
): Float32Array {
  if (durationSec <= 0 || frequencies.length === 0) return new Float32Array(0);
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const freq of frequencies) {
      sample += Math.sin(2 * Math.PI * freq * t);
    }
    pcm[i] = (sample / frequencies.length) * 0.5;
  }

  return pcm;
}

/**
 * Generates a track with distinct intro (quiet), steady body (loud), and outro (decay).
 */
export function generateStructuredTrack(options: {
  bpm: number;
  durationSec: number;
  introDurationSec: number;
  outroStartSec: number;
  sampleRate?: number;
}): Float32Array {
  const { bpm, durationSec, introDurationSec, outroStartSec, sampleRate = 44100 } = options;
  const pcm = generateSyntheticClickTrack({ bpm, durationSec, sampleRate });

  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate;
    if (t < introDurationSec) {
      // Intro quiet ramp
      pcm[i] = (pcm[i] ?? 0) * 0.2;
    } else if (t >= outroStartSec) {
      // Outro decay
      const decay = Math.max(0.1, 1 - (t - outroStartSec) / (durationSec - outroStartSec));
      pcm[i] = (pcm[i] ?? 0) * 0.2 * decay;
    }
  }

  return pcm;
}
