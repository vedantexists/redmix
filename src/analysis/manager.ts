import type { Track, TrackAnalysis } from '@/shared/types';
import { db } from '@/library/db';
import { CURRENT_ANALYSIS_VERSION, runTrackAnalysis } from './pipeline';
import type { WorkerInMessage, WorkerOutMessage } from './worker';

export type AnalysisStatus = 'idle' | 'queued' | 'analyzing' | 'done' | 'failed' | 'cancelled';

export interface AnalysisState {
  status: AnalysisStatus;
  progress: number;
  error?: string;
}

export type StatusListener = (trackId: string, state: AnalysisState) => void;

export interface AudioDataProvider {
  (): Promise<{ pcm: Float32Array; sampleRate: number; durationSec: number }>;
}

interface QueuedItem {
  track: Track;
  provider: AudioDataProvider;
  resolve: (analysis: TrackAnalysis) => void;
  reject: (err: Error) => void;
}

export class AnalysisManager {
  private queue: QueuedItem[] = [];
  private activeJobs = new Map<string, { worker?: Worker; cancel: () => void }>();
  private pendingCancellations = new Map<string, () => void>();
  private states = new Map<string, AnalysisState>();
  private listeners = new Set<StatusListener>();

  // Mobile limit: 1, Desktop limit: 2 (AUTOMIX_PLAN.md Section 5.2)
  public maxConcurrency: number;

  constructor() {
    const isMobile =
      typeof navigator !== 'undefined' &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.maxConcurrency = isMobile ? 1 : 2;
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getState(trackId: string): AnalysisState {
    return this.states.get(trackId) || { status: 'idle', progress: 0 };
  }

  private setState(trackId: string, state: AnalysisState): void {
    this.states.set(trackId, state);
    for (const listener of this.listeners) {
      listener(trackId, state);
    }
  }

  public async analyzeTrack(track: Track, provider: AudioDataProvider): Promise<TrackAnalysis> {
    // Synchronous memory cache check
    if (track.analysis && track.analysis.analysisVersion === CURRENT_ANALYSIS_VERSION) {
      this.setState(track.id, { status: 'done', progress: 1 });
      return track.analysis;
    }

    return new Promise<TrackAnalysis>((resolve, reject) => {
      let isCancelled = false;

      const onCancel = () => {
        isCancelled = true;
        this.pendingCancellations.delete(track.id);
        const active = this.activeJobs.get(track.id);
        if (active) {
          active.cancel();
        }
        // Remove from queue if present
        const qIdx = this.queue.findIndex((item) => item.track.id === track.id);
        if (qIdx !== -1) {
          this.queue.splice(qIdx, 1);
        }
        this.setState(track.id, { status: 'cancelled', progress: 0 });
        reject(new Error('Analysis cancelled'));
      };

      this.pendingCancellations.set(track.id, onCancel);

      // Async DB lookup followed by enqueue
      db.getTrack(track.id)
        .then((existing) => {
          if (isCancelled) return;

          if (existing?.analysis && existing.analysis.analysisVersion === CURRENT_ANALYSIS_VERSION) {
            track.analysis = existing.analysis;
            this.pendingCancellations.delete(track.id);
            this.setState(track.id, { status: 'done', progress: 1 });
            resolve(existing.analysis);
            return;
          }

          // Enqueue for processing
          this.queue.push({
            track,
            provider,
            resolve: (analysis) => {
              this.pendingCancellations.delete(track.id);
              resolve(analysis);
            },
            reject: (err) => {
              this.pendingCancellations.delete(track.id);
              reject(err);
            },
          });
          this.setState(track.id, { status: 'queued', progress: 0 });
          this.processNext();
        })
        .catch((err) => {
          this.pendingCancellations.delete(track.id);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  public cancel(trackId: string): void {
    const cancelFn = this.pendingCancellations.get(trackId);
    if (cancelFn) {
      cancelFn();
      return;
    }

    // If already in active jobs
    const active = this.activeJobs.get(trackId);
    if (active) {
      this.activeJobs.delete(trackId);
      this.setState(trackId, { status: 'cancelled', progress: 0 });
      active.cancel();
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.activeJobs.size >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    const { track, provider, resolve, reject } = item;
    const trackId = track.id;

    let isCancelled = false;
    let isSettled = false;
    let workerRef: Worker | undefined;

    const cancelJob = () => {
      isCancelled = true;
      if (workerRef) {
        try {
          workerRef.postMessage({ type: 'CANCEL', trackId } as WorkerInMessage);
          workerRef.terminate();
        } catch {
          // ignore
        }
      }
      if (!isSettled) {
        isSettled = true;
        reject(new Error('Analysis cancelled'));
      }
    };

    this.activeJobs.set(trackId, { worker: workerRef, cancel: cancelJob });
    this.setState(trackId, { status: 'analyzing', progress: 0 });

    try {
      const { pcm, sampleRate, durationSec } = await provider();
      if (isCancelled) {
        if (!isSettled) {
          isSettled = true;
          reject(new Error('Analysis cancelled'));
        }
        return;
      }

      // Check if Worker is supported
      if (typeof Worker !== 'undefined') {
        const analysis = await new Promise<TrackAnalysis>((workerResolve, workerReject) => {
          try {
            const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
            workerRef = worker;
            const activeEntry = this.activeJobs.get(trackId);
            if (activeEntry) activeEntry.worker = worker;

            worker.onmessage = async (e: MessageEvent<WorkerOutMessage>) => {
              const msg = e.data;
              if (msg.trackId !== trackId) return;

              if (msg.type === 'PROGRESS') {
                if (!isCancelled) {
                  this.setState(trackId, { status: 'analyzing', progress: msg.progress });
                }
              } else if (msg.type === 'SUCCESS') {
                worker.terminate();
                workerResolve(msg.analysis);
              } else if (msg.type === 'ERROR') {
                worker.terminate();
                workerReject(new Error(msg.error));
              } else if (msg.type === 'CANCELLED') {
                worker.terminate();
                workerReject(new Error('Analysis cancelled'));
              }
            };

            worker.onerror = (err) => {
              worker.terminate();
              workerReject(new Error(err.message || 'Worker execution error'));
            };

            worker.postMessage(
              {
                type: 'ANALYZE',
                trackId,
                pcm,
                sampleRate,
                durationSec,
              } as WorkerInMessage,
              [pcm.buffer]
            );
          } catch {
            // Worker instantiation failed, fall back to sync
            try {
              if (isCancelled) {
                workerReject(new Error('Analysis cancelled'));
                return;
              }
              const result = runTrackAnalysis(pcm, sampleRate, durationSec, (p) => {
                if (!isCancelled) {
                  this.setState(trackId, { status: 'analyzing', progress: p });
                }
              });
              if (isCancelled) {
                workerReject(new Error('Analysis cancelled'));
              } else {
                workerResolve(result);
              }
            } catch (syncErr) {
              workerReject(syncErr);
            }
          }
        });

        if (isCancelled) {
          if (!isSettled) {
            isSettled = true;
            reject(new Error('Analysis cancelled'));
          }
          return;
        }

        // Save to cache / db
        track.analysis = analysis;
        await db.saveTrack(track);

        if (!isSettled) {
          isSettled = true;
          this.setState(trackId, { status: 'done', progress: 1 });
          this.activeJobs.delete(trackId);
          resolve(analysis);
        }
      } else {
        // Fallback for Node / test environments without Web Worker
        if (isCancelled) {
          if (!isSettled) {
            isSettled = true;
            reject(new Error('Analysis cancelled'));
          }
          return;
        }

        const analysis = runTrackAnalysis(pcm, sampleRate, durationSec, (p) => {
          if (!isCancelled) {
            this.setState(trackId, { status: 'analyzing', progress: p });
          }
        });

        if (isCancelled) {
          if (!isSettled) {
            isSettled = true;
            reject(new Error('Analysis cancelled'));
          }
          return;
        }

        track.analysis = analysis;
        await db.saveTrack(track);

        if (!isSettled) {
          isSettled = true;
          this.setState(trackId, { status: 'done', progress: 1 });
          this.activeJobs.delete(trackId);
          resolve(analysis);
        }
      }
    } catch (err) {
      this.activeJobs.delete(trackId);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (isCancelled || errMsg.includes('cancelled')) {
        this.setState(trackId, { status: 'cancelled', progress: 0 });
        if (!isSettled) {
          isSettled = true;
          reject(err instanceof Error ? err : new Error(errMsg));
        }
      } else {
        this.setState(trackId, { status: 'failed', progress: 0, error: errMsg });
        if (!isSettled) {
          isSettled = true;
          reject(err instanceof Error ? err : new Error(errMsg));
        }
      }
    } finally {
      // Continue queue
      this.processNext();
    }
  }
}

export const analysisManager = new AnalysisManager();
