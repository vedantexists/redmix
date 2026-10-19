import type { TrackAnalysis } from '@/shared/types';
import { runTrackAnalysis } from './pipeline';

export type WorkerInMessage =
  | {
      type: 'ANALYZE';
      trackId: string;
      pcm: Float32Array;
      sampleRate: number;
      durationSec: number;
    }
  | {
      type: 'CANCEL';
      trackId: string;
    };

export type WorkerOutMessage =
  | {
      type: 'PROGRESS';
      trackId: string;
      progress: number;
    }
  | {
      type: 'SUCCESS';
      trackId: string;
      analysis: TrackAnalysis;
    }
  | {
      type: 'ERROR';
      trackId: string;
      error: string;
    }
  | {
      type: 'CANCELLED';
      trackId: string;
    };

const cancelledJobs = new Set<string>();

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === 'CANCEL') {
    cancelledJobs.add(msg.trackId);
    self.postMessage({ type: 'CANCELLED', trackId: msg.trackId } as WorkerOutMessage);
    return;
  }

  if (msg.type === 'ANALYZE') {
    const { trackId, pcm, sampleRate, durationSec } = msg;
    cancelledJobs.delete(trackId);

    try {
      const analysis = runTrackAnalysis(pcm, sampleRate, durationSec, (progress) => {
        if (!cancelledJobs.has(trackId)) {
          self.postMessage({
            type: 'PROGRESS',
            trackId,
            progress,
          } as WorkerOutMessage);
        }
      });

      if (cancelledJobs.has(trackId)) {
        cancelledJobs.delete(trackId);
        self.postMessage({ type: 'CANCELLED', trackId } as WorkerOutMessage);
        return;
      }

      self.postMessage({
        type: 'SUCCESS',
        trackId,
        analysis,
      } as WorkerOutMessage);
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        trackId,
        error: err instanceof Error ? err.message : String(err),
      } as WorkerOutMessage);
    }
  }
};
