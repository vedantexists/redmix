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

export function generateSyntheticClickTrack(
  options: SyntheticTrackOptions
): Float32Array {
  const {
    bpm,
    durationSec,
    firstBeatSec = 0,
    sampleRate = 44100,
    clickFrequency = 880,
    clickDurationSec = 0.02,
  } = options;

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
