export type TrackId = string;

export interface TrackAnalysis {
  bpm: number;
  bpmConfidence: number;
  firstBeatSec: number;
  beatsPerBar: 4;
  key: {
    camelot: string;
    confidence: number;
  };
  durationSec: number;
  introEndSec: number;
  outroStartSec: number;
  barEnergy: number[];
  loudnessGainDb: number;
  analysisVersion: number;
  userOverrides?: {
    bpm?: number;
    firstBeatSec?: number;
  };
}

export type TrackSource =
  | { kind: 'fileHandle'; handle: FileSystemFileHandle }
  | { kind: 'opfs'; path: string };

export interface Track {
  id: TrackId;
  title: string;
  artist?: string;
  fileName: string;
  sizeBytes: number;
  source: TrackSource;
  analysis?: TrackAnalysis;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: TrackId[];
}

export interface Settings {
  mixBars: 8 | 16 | 32;
  transitionStyle: 'bassSwap' | 'longBlend' | 'simpleCrossfade';
  maxTempoStretchPct: number;
  keyAwareOrdering: boolean;
  targetLoudnessDb: number;
}

export interface TransitionPlan {
  outgoingStartSec: number;
  incomingStartSec: number;
  durationBars: number;
  durationSec: number;
  incomingRate: number;
  rateRamp: 'toNeutral' | 'hold';
  style: Settings['transitionStyle'];
  fallbackReason?: string;
}
