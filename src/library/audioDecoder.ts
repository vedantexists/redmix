import type { Track } from '@/shared/types';
import { getFileFromSource } from './fileAccess';

export interface DecodedAudioData {
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
}

/**
 * Extracts mono Float32Array PCM and metadata from an AudioBuffer.
 */
export function extractMonoFromAudioBuffer(audioBuffer: AudioBuffer): DecodedAudioData {
  const sampleRate = audioBuffer.sampleRate;
  const durationSec = audioBuffer.duration;
  const numChannels = audioBuffer.numberOfChannels;
  const numSamples = audioBuffer.length;
  const pcm = new Float32Array(numSamples);

  if (numChannels === 1) {
    pcm.set(audioBuffer.getChannelData(0));
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < numSamples; i++) {
      pcm[i] = 0.5 * ((ch0[i] ?? 0) + (ch1[i] ?? 0));
    }
  }

  return { pcm, sampleRate, durationSec };
}

/**
 * Decodes audio file from Track source into mono PCM for analysis.
 */
export async function decodeTrackForAnalysis(track: Track): Promise<DecodedAudioData> {
  const file = await getFileFromSource(track.source);
  const arrayBuffer = await file.arrayBuffer();

  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtxClass) {
    throw new Error('Web Audio API is not supported in this environment.');
  }

  const ctx = new AudioCtxClass();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return extractMonoFromAudioBuffer(audioBuffer);
  } finally {
    if (ctx.state !== 'closed') {
      void ctx.close();
    }
  }
}
