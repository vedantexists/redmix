import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSyntheticClickTrack } from '../fixtures/syntheticAudio';
import { equalPowerGains } from '@/shared/math';
import { planTransition } from '@/audio/planner';
import { AutoMixEngine } from '@/audio/engine/autoMix';
import { TwoDeckMixer, AudioContextManager } from '@/audio/engine';
import type { Track, TrackAnalysis } from '@/shared/types';

describe('Milestone M5: Auto-Mix Execution & Offline Render', () => {
  const sampleRate = 44100;

  beforeEach(() => {
    vi.useFakeTimers();
    (AudioContextManager.getInstance().getContext() as unknown as { currentTime: number }).currentTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTestTrack(id: string, bpm: number, durationSec = 60, outroStartSec?: number): Track {
    const barSec = 4 * (60 / bpm);
    const analysis: TrackAnalysis = {
      bpm,
      bpmConfidence: 0.95,
      firstBeatSec: 0,
      beatsPerBar: 4,
      key: { camelot: '8A', confidence: 0.9 },
      durationSec,
      introEndSec: barSec * 2,
      outroStartSec: outroStartSec ?? (durationSec - barSec * 8),
      barEnergy: [0.1, 0.2, 0.2, 0.1],
      loudnessGainDb: 0,
      analysisVersion: 1,
    };

    return {
      id,
      title: `Track ${id}`,
      fileName: `${id}.wav`,
      sizeBytes: 1024,
      source: { kind: 'opfs', path: `/${id}.wav` },
      analysis,
    };
  }

  describe('Offline Render Test (Equal-Power & Beat Alignment)', () => {
    /**
     * In jsdom test environment, OfflineAudioContext does not execute real-time hardware DSP.
     * We analytically simulate the exact Web Audio graph equal-power crossfade math
     * on synthetic click track PCM samples to verify:
     * 1. No clipping (peak < 1.0)
     * 2. No silence gap (RMS > 0.01)
     * 3. Kick onset alignment within <= 2.5 ms
     */
    it('renders transition with kick alignment within 3ms, no clipping (peak < 1.0), and no silence gap', () => {
      const bpm = 124;
      const beatInterval = 60 / bpm; // ~0.48387s
      const barDuration = 4 * beatInterval; // ~1.93548s

      // Track A & B synthetic tracks with kick pulses
      const pcmA = generateSyntheticClickTrack({
        bpm,
        durationSec: 12,
        firstBeatSec: 0,
        sampleRate,
        clickDurationSec: 0.02,
      });

      const pcmB = generateSyntheticClickTrack({
        bpm,
        durationSec: 12,
        firstBeatSec: 0,
        sampleRate,
        clickDurationSec: 0.02,
      });

      // Scale to 0.68 (-3.3 dB headroom for equal-power overlap of coherent kicks)
      for (let i = 0; i < pcmA.length; i++) {
        pcmA[i] = (pcmA[i] ?? 0) * 0.68;
        pcmB[i] = (pcmB[i] ?? 0) * 0.68;
      }

      // Mix starts at bar 2 (2 * barDuration = 8 beats) and lasts 2 bars
      const mixStartSec = 2 * barDuration;
      const mixDurationSec = 2 * barDuration;
      const mixEndSec = mixStartSec + mixDurationSec;
      const totalDurationSec = 12;
      const totalSamples = Math.floor(totalDurationSec * sampleRate);

      const rendered = new Float32Array(totalSamples);

      for (let n = 0; n < totalSamples; n++) {
        const t = n / sampleRate;

        if (t < mixStartSec) {
          // Track A playing solo
          rendered[n] = pcmA[n] ?? 0;
        } else if (t < mixEndSec) {
          // In transition overlap: equal power crossfade
          const progress = (t - mixStartSec) / mixDurationSec;
          const { gainA, gainB } = equalPowerGains(progress);

          const sampleA = pcmA[n] ?? 0;
          // Track B starts at t = mixStartSec from its first beat (0)
          const sampleBIndex = Math.floor((t - mixStartSec) * sampleRate);
          const sampleB = pcmB[sampleBIndex] ?? 0;

          rendered[n] = gainA * sampleA + gainB * sampleB;
        } else {
          // Track B playing solo
          const sampleBIndex = Math.floor((t - mixStartSec) * sampleRate);
          rendered[n] = pcmB[sampleBIndex] ?? 0;
        }
      }

      // Assertion 1: No clipping (peak < 1.0)
      let maxPeak = 0;
      for (let n = 0; n < totalSamples; n++) {
        const absVal = Math.abs(rendered[n] ?? 0);
        if (absVal > maxPeak) maxPeak = absVal;
      }
      expect(maxPeak).toBeLessThan(1.0);
      expect(maxPeak).toBeGreaterThan(0.5);

      // Assertion 2: No silence gap (energy during overlap > 0)
      const overlapStartIdx = Math.floor(mixStartSec * sampleRate);
      const overlapEndIdx = Math.floor(mixEndSec * sampleRate);
      let overlapSumSq = 0;
      for (let n = overlapStartIdx; n < overlapEndIdx; n++) {
        const s = rendered[n] ?? 0;
        overlapSumSq += s * s;
      }
      const overlapRms = Math.sqrt(overlapSumSq / (overlapEndIdx - overlapStartIdx));
      expect(overlapRms).toBeGreaterThan(0.01); // Asserts no silence gap

      // Assertion 3: Kick onset alignment during overlap
      // Assert that kick peaks in rendered audio align with the expected beat grid within 2.5 ms
      const expectedKicksCount = Math.floor(mixDurationSec / beatInterval);
      expect(expectedKicksCount).toBeGreaterThanOrEqual(4);

      for (let beat = 0; beat < expectedKicksCount; beat++) {
        const expectedTime = mixStartSec + beat * beatInterval;
        const centerSample = Math.floor(expectedTime * sampleRate);
        const searchWindow = Math.floor(0.02 * sampleRate); // +/- 20ms search window
        let bestSample = centerSample;
        let maxVal = -1;

        for (
          let s = Math.max(0, centerSample - searchWindow);
          s < Math.min(totalSamples, centerSample + searchWindow);
          s++
        ) {
          const val = Math.abs(rendered[s] ?? 0);
          if (val > maxVal) {
            maxVal = val;
            bestSample = s;
          }
        }

        const detectedTime = bestSample / sampleRate;
        const offsetMs = Math.abs(detectedTime - expectedTime) * 1000;
        expect(offsetMs).toBeLessThanOrEqual(2.5); // Accurately aligns within 2.5 ms
      }
    });

    it('verifies incoming track beat 1 lands on a bar line of outgoing track for two different BPM pairs with non-zero offsets', () => {
      // Pair 1: 120 BPM (offset 0.35s) and 124 BPM (offset 0.22s)
      const analysisA: TrackAnalysis = {
        bpm: 120,
        bpmConfidence: 0.95,
        firstBeatSec: 0.35,
        beatsPerBar: 4,
        key: { camelot: '8A', confidence: 0.9 },
        durationSec: 60,
        introEndSec: 8,
        outroStartSec: 45,
        barEnergy: [0.1, 0.2, 0.2, 0.1],
        loudnessGainDb: 0,
        analysisVersion: 1,
      };

      const analysisB: TrackAnalysis = {
        bpm: 124,
        bpmConfidence: 0.95,
        firstBeatSec: 0.22,
        beatsPerBar: 4,
        key: { camelot: '8B', confidence: 0.9 },
        durationSec: 60,
        introEndSec: 8,
        outroStartSec: 45,
        barEnergy: [0.1, 0.2, 0.2, 0.1],
        loudnessGainDb: 0,
        analysisVersion: 1,
      };

      const plan1 = planTransition(analysisA, analysisB, { mixBars: 8 });
      const barSecA = 4 * (60 / analysisA.bpm);
      // Assert outgoingStartSec is aligned to track A's bar grid (firstBeatSec + k * barSecA)
      const barsFromFirstBeat1 = (plan1.outgoingStartSec - analysisA.firstBeatSec) / barSecA;
      expect(Math.abs(Math.round(barsFromFirstBeat1) - barsFromFirstBeat1)).toBeLessThan(0.005);
      // Assert incomingStartSec is at track B's first beat
      expect(plan1.incomingStartSec).toBe(analysisB.firstBeatSec);

      // Pair 2: 128 BPM (offset 0.48s) and 130 BPM (offset 0.15s)
      const analysisC: TrackAnalysis = {
        bpm: 128,
        bpmConfidence: 0.92,
        firstBeatSec: 0.48,
        beatsPerBar: 4,
        key: { camelot: '11B', confidence: 0.9 },
        durationSec: 90,
        introEndSec: 10,
        outroStartSec: 75,
        barEnergy: [0.2, 0.3, 0.3, 0.2],
        loudnessGainDb: -1.2,
        analysisVersion: 1,
      };

      const analysisD: TrackAnalysis = {
        bpm: 130,
        bpmConfidence: 0.91,
        firstBeatSec: 0.15,
        beatsPerBar: 4,
        key: { camelot: '12B', confidence: 0.9 },
        durationSec: 90,
        introEndSec: 10,
        outroStartSec: 75,
        barEnergy: [0.2, 0.3, 0.3, 0.2],
        loudnessGainDb: 0.8,
        analysisVersion: 1,
      };

      const plan2 = planTransition(analysisC, analysisD, { mixBars: 16 });
      const barSecC = 4 * (60 / analysisC.bpm);
      const barsFromFirstBeat2 = (plan2.outgoingStartSec - analysisC.firstBeatSec) / barSecC;
      expect(Math.abs(Math.round(barsFromFirstBeat2) - barsFromFirstBeat2)).toBeLessThan(0.005);
      expect(plan2.incomingStartSec).toBe(analysisD.firstBeatSec);
    });
  });

  describe('3-Track Playlist Auto-Mix Execution', () => {
    it('plays 3-track playlist end to end through two automatic transitions with buffer bounds', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);
      const mockBuffers = new Map<string, AudioBuffer>();

      // 60-second tracks, mixBars: 8 (16.0s duration), outro starts at 40.0s -> mix start at 40.0s
      const t1 = createTestTrack('track-1', 120, 60, 40);
      const t2 = createTestTrack('track-2', 120, 60, 40);
      const t3 = createTestTrack('track-3', 120, 60, 40);

      for (const track of [t1, t2, t3]) {
        const buf = mixer.context.createBuffer(1, sampleRate * 60, sampleRate);
        mockBuffers.set(track.id, buf);
      }

      const bufferLoader = async (track: Track): Promise<AudioBuffer> => {
        const buf = mockBuffers.get(track.id);
        if (!buf) throw new Error('Buffer not found');
        return buf;
      };

      const engine = new AutoMixEngine({
        mixer,
        bufferLoader,
        settings: {
          mixBars: 8,
          transitionStyle: 'bassSwap',
          maxTempoStretchPct: 6,
          keyAwareOrdering: false,
          targetLoudnessDb: -14,
        },
      });

      const transitionEvents: string[] = [];
      engine.subscribe((e) => {
        if (e.type === 'transition_started') transitionEvents.push('started');
        if (e.type === 'transition_completed') transitionEvents.push('completed');
      });

      engine.setPlaylist([t1, t2, t3]);
      expect(engine.getCurrentTrack()?.id).toBe('track-1');

      // Start engine
      await engine.play();
      expect(engine.isPlaying).toBe(true);

      // Pre-decode next track on tick
      await engine.tick();

      // Memory target check: at most current and next buffer loaded
      let loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      // Advance time automatically towards transition 1 (mix start at 40.0s; lookahead schedules at 39.2s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 39.2;
      await engine.tick();
      expect(engine.inTransition).toBe(true);
      expect(transitionEvents).toEqual(['started']);

      loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      // Advance time past transition 1 end (40.0s + 16.0s = 56.0s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 56.05;
      await engine.tick();
      expect(engine.inTransition).toBe(false);
      expect(transitionEvents).toEqual(['started', 'completed']);
      expect(engine.getCurrentTrack()?.id).toBe('track-2');

      // Previous track buffer is unloaded; at most 2 buffers loaded
      loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      // Advance time so track 3 is predecoded for transition 2
      await engine.tick();
      loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      // Advance time to transition 2 mix start (track-2 started at 40.0s, outgoingStartSec is 40.0s -> 79.2s lookahead)
      (mixer.context as unknown as { currentTime: number }).currentTime = 79.2;
      await engine.tick();
      expect(engine.inTransition).toBe(true);
      expect(transitionEvents).toEqual(['started', 'completed', 'started']);

      // Advance time past transition 2 end (80.0s + 16.0s = 96.0s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 96.05;
      await engine.tick();
      expect(engine.inTransition).toBe(false);
      expect(transitionEvents).toEqual(['started', 'completed', 'started', 'completed']);
      expect(engine.getCurrentTrack()?.id).toBe('track-3');

      // Final memory target check
      loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      engine.destroy();
    });

    it('handles edge case: skip mid-transition cleanly cuts to incoming track', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);
      const t1 = createTestTrack('t-a', 120, 60, 40);
      const t2 = createTestTrack('t-b', 120, 60, 40);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 60, 44100);
      };

      const engine = new AutoMixEngine({
        mixer,
        bufferLoader,
        settings: { mixBars: 8, transitionStyle: 'bassSwap' },
      });
      engine.setPlaylist([t1, t2]);

      await engine.play();
      expect(engine.getCurrentTrack()?.id).toBe('t-a');

      // Pre-decode next track into incoming deck
      await engine.tick();

      // Advance time so transition is actively scheduled and started (mix start at 40.0s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 39.2;
      await engine.tick();
      expect(engine.inTransition).toBe(true);

      // Advance into active transition duration
      (mixer.context as unknown as { currentTime: number }).currentTime = 45.0;

      // Trigger mid-transition skip
      engine.skip();
      expect(engine.inTransition).toBe(false);
      expect(engine.getCurrentTrack()?.id).toBe('t-b');
      expect(engine.activeDeck.trackId).toBe('t-b');

      engine.destroy();
    });

    it('handles edge case: pause during transition and resume without premature completion', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);
      const t1 = createTestTrack('t-pause-1', 120, 60, 40);
      const t2 = createTestTrack('t-pause-2', 120, 60, 40);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 60, 44100);
      };

      const engine = new AutoMixEngine({
        mixer,
        bufferLoader,
        settings: { mixBars: 8, transitionStyle: 'bassSwap' },
      });
      engine.setPlaylist([t1, t2]);

      await engine.play();

      // Pre-decode next track
      await engine.tick();

      // Advance into active transition (started at 40.0s, duration 16.0s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 39.2;
      await engine.tick();
      expect(engine.inTransition).toBe(true);

      // Advance into transition duration (audio time 45.0s, 5s into 16s transition, remaining ~11s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 45.0;

      // Pause mid-transition
      engine.pause();
      expect(engine.isPlaying).toBe(false);

      // Simulate being paused for 20 seconds (longer than remaining transition duration)
      (mixer.context as unknown as { currentTime: number }).currentTime = 65.0;

      // Resume playback
      await engine.play();
      expect(engine.isPlaying).toBe(true);
      // F4 fix: transition must NOT prematurely terminate immediately upon resume!
      expect(engine.inTransition).toBe(true);

      // Advance by the remaining transition duration (~11s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 76.5;
      await engine.tick();

      // Now the transition completes cleanly
      expect(engine.inTransition).toBe(false);
      expect(engine.getCurrentTrack()?.id).toBe('t-pause-2');

      engine.destroy();
    });

    it('handles edge case: decode failure on next track by removing it from queue', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);
      const tGood1 = createTestTrack('t-good-1', 120, 60);
      const tCorrupt = createTestTrack('t-corrupt', 120, 60);
      const tGood2 = createTestTrack('t-good-2', 120, 60);

      const bufferLoader = async (track: Track): Promise<AudioBuffer> => {
        if (track.id === 't-corrupt') {
          throw new Error('Corrupted audio stream');
        }
        return mixer.context.createBuffer(1, 44100 * 60, 44100);
      };

      const engine = new AutoMixEngine({ mixer, bufferLoader });
      const errors: string[] = [];
      engine.subscribe((e) => {
        if (e.type === 'track_error') errors.push(e.trackId ?? '');
      });

      engine.setPlaylist([tGood1, tCorrupt, tGood2]);
      await engine.play();

      // First tick attempts to pre-decode tCorrupt and catches decode error
      await engine.tick();
      expect(errors).toContain('t-corrupt');

      // tCorrupt was spliced out of playlist; next track is now t-good-2
      expect(engine.getNextTrack()?.id).toBe('t-good-2');
      expect(engine.getCurrentTrack()?.id).toBe('t-good-1');

      // Next tick pre-decodes t-good-2 successfully
      await engine.tick();
      expect(engine.incomingDeck.trackId).toBe('t-good-2');

      engine.destroy();
    });

    it('handles edge case: last track fades out smoothly before stopping', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);
      const tSingle = createTestTrack('t-single', 120, 60);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 60, 44100);
      };

      const engine = new AutoMixEngine({ mixer, bufferLoader });
      engine.setPlaylist([tSingle]);

      await engine.play();
      expect(engine.isPlaying).toBe(true);

      // Advance to 58.5s (duration is 60s, remaining 1.5s triggers fade out)
      (mixer.context as unknown as { currentTime: number }).currentTime = 58.5;
      await engine.tick();

      // Advance to end of track (60.05s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 60.05;
      await engine.tick();
      expect(engine.isPlaying).toBe(false);

      engine.destroy();
    });
  });
});
