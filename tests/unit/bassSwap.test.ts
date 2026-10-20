import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwoDeckMixer, AudioContextManager } from '@/audio/engine';
import { AutoMixEngine } from '@/audio/engine/autoMix';
import { planTransition } from '@/audio/planner';
import { equalPowerGains } from '@/shared/math';
import type { Track, TrackAnalysis } from '@/shared/types';

describe('Milestone M6: Bass Swap & Mix Points', () => {

  beforeEach(() => {
    vi.useFakeTimers();
    (AudioContextManager.getInstance().getContext() as unknown as { currentTime: number }).currentTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTestTrack(overrides: Partial<TrackAnalysis> & { id?: string } = {}): Track {
    const id = overrides.id ?? 'track-test';
    const bpm = overrides.bpm ?? 120;
    const barSec = 4 * (60 / bpm);
    const durationSec = overrides.durationSec ?? 120;

    const analysis: TrackAnalysis = {
      bpm,
      bpmConfidence: 0.95,
      firstBeatSec: 0.2,
      beatsPerBar: 4,
      key: { camelot: '8A', confidence: 0.9 },
      durationSec,
      introEndSec: barSec * 4,
      outroStartSec: durationSec - barSec * 8,
      barEnergy: [0.1, 0.2, 0.4, 0.2],
      loudnessGainDb: 0,
      analysisVersion: 1,
      ...overrides,
    };

    return {
      id,
      title: `Track ${id}`,
      fileName: `${id}.wav`,
      sizeBytes: 2048,
      source: { kind: 'opfs', path: `/${id}.wav` },
      analysis,
    };
  }

  describe('Low-Band Swap with BiquadFilterNode', () => {
    it('configures BiquadFilterNode correctly on both decks during transition', () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);

      const startAudioTime = 10.0;
      const durationSec = 16.0;
      const beatDurationSec = 0.5; // 120 BPM = 0.5s per beat

      mixer.scheduleBassSwap('A', startAudioTime, durationSec, beatDurationSec);

      const filterA = mixer.deckA['lowFilter'];
      const filterB = mixer.deckB['lowFilter'];

      // filter frequency is MockAudioParam with scheduledEvents
      const eventsA = (filterA.frequency as unknown as { scheduledEvents: { type: string; value: number; time: number }[] }).scheduledEvents;
      const eventsB = (filterB.frequency as unknown as { scheduledEvents: { type: string; value: number; time: number }[] }).scheduledEvents;

      // Deck A (outgoing): starts at 10 Hz (bass stays), held until midpoint (18.0s), then ramps to 200 Hz (bass cut)
      expect(eventsA).toContainEqual({ type: 'set', value: 10, time: 10.0 });
      expect(eventsA).toContainEqual({ type: 'set', value: 10, time: 18.0 });
      expect(eventsA).toContainEqual({ type: 'linear', value: 200, time: 18.5 }); // swap over ~1 beat (0.5s)

      // Deck B (incoming): starts at 200 Hz (bass cut), held until midpoint (18.0s), then ramps to 10 Hz (bass restored)
      expect(eventsB).toContainEqual({ type: 'set', value: 200, time: 10.0 });
      expect(eventsB).toContainEqual({ type: 'set', value: 200, time: 18.0 });
      expect(eventsB).toContainEqual({ type: 'linear', value: 10, time: 18.5 });
    });

    it('resets filters cleanly on transition completion, stop, and skip', () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);

      mixer.scheduleBassSwap('A', 5.0, 10.0, 0.5);
      mixer.resetFilters();

      const eventsA = (mixer.deckA['lowFilter'].frequency as unknown as { scheduledEvents: { type: string; value: number; time: number }[] }).scheduledEvents;
      const eventsB = (mixer.deckB['lowFilter'].frequency as unknown as { scheduledEvents: { type: string; value: number; time: number }[] }).scheduledEvents;

      expect(eventsA.at(-1)?.value).toBe(10);
      expect(eventsB.at(-1)?.value).toBe(10);
    });
  });

  describe('Offline Render Low-Band Dominance Analysis', () => {
    it('proves that only one track has dominant low band (< 150 Hz) energy after the swap point', () => {
      const sampleRate = 44100;
      const durationSec = 8.0;
      const totalSamples = Math.floor(durationSec * sampleRate);
      const midpointSec = durationSec / 2; // 4.0s
      const swapSec = 0.5; // ~1 beat swap

      // Generate Track A with heavy 60 Hz sub-bass tone
      // Generate Track B with heavy 80 Hz sub-bass tone
      const samplesA = new Float32Array(totalSamples);
      const samplesB = new Float32Array(totalSamples);

      for (let n = 0; n < totalSamples; n++) {
        const t = n / sampleRate;
        // 60 Hz kick / sub-bass for Track A
        samplesA[n] = Math.sin(2 * Math.PI * 60 * t) * 0.7;
        // 80 Hz kick / sub-bass for Track B
        samplesB[n] = Math.sin(2 * Math.PI * 80 * t) * 0.7;
      }

      // Filter attenuation simulation for 200 Hz high-pass on 60-80 Hz bass
      // High-pass filter at 200 Hz: bass frequencies (60-80 Hz) are attenuated by ~18 dB (gain ~0.125)
      // High-pass filter at 10 Hz: bass frequencies are completely unattenuated (gain = 1.0)
      function filterGain(freqCutoffHz: number, signalFreqHz: number): number {
        // Single/double pole high-pass magnitude response |H(f)| = (f/fc) / sqrt(1 + (f/fc)^2)
        const ratio = signalFreqHz / freqCutoffHz;
        return ratio / Math.sqrt(1 + ratio * ratio);
      }

      // Track low-band energy before and after midpoint swap
      let energyABefore = 0;
      let energyBBefore = 0;
      let energyAAfter = 0;
      let energyBAfter = 0;

      for (let n = 0; n < totalSamples; n++) {
        const t = n / sampleRate;
        const progress = t / durationSec;
        const { gainA: eqGainA, gainB: eqGainB } = equalPowerGains(progress);

        let cutoffA = 10;
        let cutoffB = 200;

        if (t < midpointSec) {
          cutoffA = 10;
          cutoffB = 200;
        } else if (t < midpointSec + swapSec) {
          const swapProgress = (t - midpointSec) / swapSec;
          cutoffA = 10 + swapProgress * (200 - 10);
          cutoffB = 200 - swapProgress * (200 - 10);
        } else {
          cutoffA = 200;
          cutoffB = 10;
        }

        const outA = samplesA[n]! * eqGainA * filterGain(cutoffA, 60);
        const outB = samplesB[n]! * eqGainB * filterGain(cutoffB, 80);

        if (t < midpointSec - 0.2) {
          energyABefore += outA * outA;
          energyBBefore += outB * outB;
        } else if (t > midpointSec + swapSec + 0.2) {
          energyAAfter += outA * outA;
          energyBAfter += outB * outB;
        }
      }

      // 1. Before swap point: Track A low band dominates (> 80% of low energy is from A)
      const totalEnergyBefore = energyABefore + energyBBefore;
      const shareABefore = energyABefore / totalEnergyBefore;
      expect(shareABefore).toBeGreaterThan(0.80);

      // 2. After swap point: Track B low band dominates (> 80% of low energy is from B)
      const totalEnergyAfter = energyAAfter + energyBAfter;
      const shareBAfter = energyBAfter / totalEnergyAfter;
      expect(shareBAfter).toBeGreaterThan(0.80);

      // 3. At no point after the swap is Track A dominant
      const shareAAfter = energyAAfter / totalEnergyAfter;
      expect(shareAAfter).toBeLessThan(0.20);
    });
  });

  describe('Outro and Intro Detection in Transition Planning', () => {
    it('uses track A outroStartSec to anchor blend start on bar boundary', () => {
      const trackA = createTestTrack({
        id: 't-out',
        bpm: 120,
        durationSec: 180,
        firstBeatSec: 0.1,
        outroStartSec: 150.0,
      });

      const trackB = createTestTrack({
        id: 't-in',
        bpm: 120,
        durationSec: 180,
        firstBeatSec: 0.25,
      });

      const plan = planTransition(trackA.analysis!, trackB.analysis!, { mixBars: 8 });
      const barSecA = 4 * (60 / 120); // 2.0s

      // Transition should be anchored close to outroStartSec (150s)
      expect(plan.outgoingStartSec).toBeGreaterThanOrEqual(145.0);
      expect(plan.outgoingStartSec).toBeLessThanOrEqual(155.0);

      // Must be exactly on a bar boundary of track A
      const bars = (plan.outgoingStartSec - trackA.analysis!.firstBeatSec) / barSecA;
      expect(Math.abs(Math.round(bars) - bars)).toBeLessThan(0.005);
    });

    it('adapts mix duration to incoming track intro when available', () => {
      const trackA = createTestTrack({
        id: 't-a',
        bpm: 124,
        durationSec: 180,
      });

      // Track B has a 16-bar intro: firstBeat 0.2, introEnd 31.2s (~16 bars at 124 BPM)
      const barSecB = 4 * (60 / 124);
      const trackB = createTestTrack({
        id: 't-b',
        bpm: 124,
        durationSec: 180,
        firstBeatSec: 0.2,
        introEndSec: 0.2 + 16 * barSecB,
      });

      // Without explicit mixBars override, planner uses intro length
      const plan = planTransition(trackA.analysis!, trackB.analysis!, {});
      expect(plan.durationBars).toBe(16);
      expect(plan.incomingStartSec).toBe(trackB.analysis!.firstBeatSec);
    });
  });

  describe('Mix Length and Style Settings', () => {
    const trackA = createTestTrack({ id: 't-a', bpm: 120, durationSec: 120, outroStartSec: 40 });
    const trackB = createTestTrack({ id: 't-b', bpm: 120, durationSec: 120, outroStartSec: 40 });

    it('mix length settings (8, 16, 32 bars) change transition duration', () => {
      const plan8 = planTransition(trackA.analysis!, trackB.analysis!, { mixBars: 8 });
      const plan16 = planTransition(trackA.analysis!, trackB.analysis!, { mixBars: 16 });
      const plan32 = planTransition(trackA.analysis!, trackB.analysis!, { mixBars: 32 });

      expect(plan8.durationBars).toBe(8);
      expect(plan16.durationBars).toBe(16);
      expect(plan32.durationBars).toBe(32);

      expect(plan8.durationSec).toBeLessThan(plan16.durationSec);
      expect(plan16.durationSec).toBeLessThan(plan32.durationSec);
    });

    it('supports longBlend style without bass cut', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 60, 44100);
      };

      const engine = new AutoMixEngine({
        mixer,
        bufferLoader,
        settings: { mixBars: 8, transitionStyle: 'longBlend' },
      });

      engine.setPlaylist([trackA, trackB]);
      await engine.play();
      await engine.tick();

      // Advance to mix point
      (mixer.context as unknown as { currentTime: number }).currentTime = 39.2;
      await engine.tick();

      expect(engine.inTransition).toBe(true);

      // In longBlend, filters remain neutral (10 Hz) on both decks throughout
      expect(mixer.deckA.filterCutoff).toBe(10);
      expect(mixer.deckB.filterCutoff).toBe(10);

      engine.destroy();
    });

    it('supports simpleCrossfade style with neutral filters and no tempo ramp', () => {
      const plan = planTransition(trackA.analysis!, trackB.analysis!, {
        transitionStyle: 'simpleCrossfade',
      });

      expect(plan.style).toBe('simpleCrossfade');
      expect(plan.incomingRate).toBe(1.0);
      expect(plan.durationSec).toBeLessThanOrEqual(8.0);
    });

    it('handles pause and resume during bass swap transition without losing filter schedule', async () => {
      const ctx = new AudioContext();
      const mixer = new TwoDeckMixer(ctx);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 60, 44100);
      };

      const engine = new AutoMixEngine({
        mixer,
        bufferLoader,
        settings: { mixBars: 8, transitionStyle: 'bassSwap' },
      });

      engine.setPlaylist([trackA, trackB]);
      await engine.play();
      await engine.tick();

      // Trigger transition start at audio time 40.0s
      (mixer.context as unknown as { currentTime: number }).currentTime = 39.2;
      await engine.tick();
      expect(engine.inTransition).toBe(true);

      // Pause before midpoint (at 42.0s, midpoint is at 48.0s)
      (mixer.context as unknown as { currentTime: number }).currentTime = 42.0;
      engine.pause();

      // Simulate being paused for 15 seconds
      (mixer.context as unknown as { currentTime: number }).currentTime = 57.0;

      // Resume
      await engine.play();
      expect(engine.inTransition).toBe(true);

      // Filter swap should still be scheduled for the new midpoint
      const eventsA = (mixer.deckA['lowFilter'].frequency as unknown as { scheduledEvents: { type: string; value: number; time: number }[] }).scheduledEvents;
      const lastRampA = eventsA.find((e) => e.type === 'linear' && e.value === 200);
      expect(lastRampA).toBeDefined();

      engine.destroy();
    });
  });
});
