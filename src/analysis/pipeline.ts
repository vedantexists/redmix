import type { TrackAnalysis } from '@/shared/types';
import { analyzeBeats } from './beats';
import { analyzeKey } from './key';
import { analyzeStructure } from './structure';
import { analyzeLoudness } from './loudness';

export const CURRENT_ANALYSIS_VERSION = 1;

export type ProgressCallback = (progress: number) => void;

/**
 * Runs the complete audio analysis pipeline on mono PCM audio.
 */
export function runTrackAnalysis(
  pcm: Float32Array,
  sampleRate: number,
  durationSec: number,
  onProgress?: ProgressCallback
): TrackAnalysis {
  onProgress?.(0.1);
  const beats = analyzeBeats(pcm, sampleRate);

  onProgress?.(0.4);
  const key = analyzeKey(pcm, sampleRate);

  onProgress?.(0.7);
  const structure = analyzeStructure(pcm, sampleRate, beats.bpm, beats.firstBeatSec, durationSec);

  onProgress?.(0.9);
  const loudness = analyzeLoudness(pcm);

  onProgress?.(1.0);

  return {
    bpm: beats.bpm,
    bpmConfidence: beats.bpmConfidence,
    firstBeatSec: beats.firstBeatSec,
    beatsPerBar: 4,
    key,
    durationSec,
    introEndSec: structure.introEndSec,
    outroStartSec: structure.outroStartSec,
    barEnergy: structure.barEnergy,
    loudnessGainDb: loudness.loudnessGainDb,
    analysisVersion: CURRENT_ANALYSIS_VERSION,
  };
}
