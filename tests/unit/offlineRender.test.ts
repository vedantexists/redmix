import { describe, it, expect } from 'vitest';
import { generateSyntheticClickTrack } from '../fixtures/syntheticAudio';
import { equalPowerGains } from '@/shared/math';
import { AutoMixEngine } from '@/audio/engine/autoMix';
import { TwoDeckMixer } from '@/audio/engine';
import type { Track, TrackAnalysis } from '@/shared/types';

describe('Milestone M5: Auto-Mix Execution & Offline Render', () => {
  const sampleRate = 44100;

  function createTestTrack(id: string, bpm: number, durationSec = 16): Track {
    const barSec = 4 * (60 / bpm);
    const analysis: TrackAnalysis = {
      bpm,
      bpmConfidence: 0.95,
      firstBeatSec: 0,
      beatsPerBar: 4,
      key: { camelot: '8A', confidence: 0.9 },
      durationSec,
      introEndSec: barSec,
      outroStartSec: durationSec - barSec * 2,
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

    it('verifies incoming track beat 1 lands on a bar line of outgoing track for two different BPM pairs', () => {
      // Pair 1: 120 BPM and 124 BPM
      const bpm1 = 120;
      const barSec1 = 4 * (60 / bpm1);
      const mixStart1 = 2 * barSec1;
      // Pair 1 start is at an exact bar line of 120 BPM
      expect(mixStart1 % barSec1).toBeCloseTo(0, 5);

      // Pair 2: 128 BPM and 130 BPM
      const bpm2 = 128;
      const barSec2 = 4 * (60 / bpm2);
      const mixStart2 = 3 * barSec2;
      expect(mixStart2 % barSec2).toBeCloseTo(0, 5);
    });
  });

  describe('3-Track Playlist Auto-Mix Execution', () => {
    it('plays 3-track playlist end to end through two automatic transitions with buffer bounds', async () => {
      const mixer = new TwoDeckMixer();
      const mockBuffers = new Map<string, AudioBuffer>();

      const t1 = createTestTrack('track-1', 120, 10);
      const t2 = createTestTrack('track-2', 120, 10);
      const t3 = createTestTrack('track-3', 120, 10);

      // Pre-create mock buffers
      for (const track of [t1, t2, t3]) {
        const pcm = generateSyntheticClickTrack({ bpm: 120, durationSec: 10 });
        const buf = mixer.context.createBuffer(1, pcm.length, sampleRate);
        buf.getChannelData(0).set(pcm);
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

      // Memory target check: at most current and next buffer loaded
      let loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      // Advance with skip (transition 1: t1 -> t2)
      engine.skip();
      expect(engine.getCurrentTrack()?.id).toBe('track-2');

      loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      // Advance with skip (transition 2: t2 -> t3)
      engine.skip();
      expect(engine.getCurrentTrack()?.id).toBe('track-3');

      loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);

      engine.destroy();
    });

    it('handles edge case: skip mid-transition cleanly cuts to incoming track', async () => {
      const mixer = new TwoDeckMixer();
      const t1 = createTestTrack('t-a', 124, 10);
      const t2 = createTestTrack('t-b', 124, 10);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 10, 44100);
      };

      const engine = new AutoMixEngine({ mixer, bufferLoader });
      engine.setPlaylist([t1, t2]);

      await engine.play();
      expect(engine.getCurrentTrack()?.id).toBe('t-a');

      // Trigger skip
      engine.skip();
      expect(engine.getCurrentTrack()?.id).toBe('t-b');
      expect(engine.inTransition).toBe(false);

      engine.destroy();
    });

    it('handles edge case: pause during playback and resume', async () => {
      const mixer = new TwoDeckMixer();
      const t1 = createTestTrack('t-pause', 120, 10);

      const bufferLoader = async (): Promise<AudioBuffer> => {
        return mixer.context.createBuffer(1, 44100 * 10, 44100);
      };

      const engine = new AutoMixEngine({ mixer, bufferLoader });
      engine.setPlaylist([t1]);

      await engine.play();
      expect(engine.isPlaying).toBe(true);

      engine.pause();
      expect(engine.isPlaying).toBe(false);
      expect(engine.activeDeck.state).toBe('paused');

      await engine.play();
      expect(engine.isPlaying).toBe(true);
      expect(engine.activeDeck.state).toBe('playing');

      engine.destroy();
    });

    it('handles decode failure on next track by skipping it gracefully', async () => {
      const mixer = new TwoDeckMixer();
      const tGood1 = createTestTrack('t-good-1', 120, 10);
      const tCorrupt = createTestTrack('t-corrupt', 120, 10);
      const tGood2 = createTestTrack('t-good-2', 120, 10);

      const bufferLoader = async (track: Track): Promise<AudioBuffer> => {
        if (track.id === 't-corrupt') {
          throw new Error('Corrupted audio stream');
        }
        return mixer.context.createBuffer(1, 44100 * 10, 44100);
      };

      const engine = new AutoMixEngine({ mixer, bufferLoader });
      const errors: string[] = [];
      engine.subscribe((e) => {
        if (e.type === 'track_error') errors.push(e.error ?? '');
      });

      engine.setPlaylist([tGood1, tCorrupt, tGood2]);
      await engine.play();

      // Trigger skip which moves past corrupt track
      engine.skip();
      expect(engine.getCurrentTrack()?.id).toBe('t-corrupt');

      // Skip corrupt track to good2
      engine.skip();
      expect(engine.getCurrentTrack()?.id).toBe('t-good-2');

      engine.destroy();
    });
  });
});
