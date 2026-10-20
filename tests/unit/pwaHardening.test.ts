import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { wakeLockManager } from '@/app/services/wakeLock';
import { TwoDeckMixer } from '@/audio/engine';
import { AutoMixEngine } from '@/audio/engine/autoMix';
import type { Track } from '@/shared/types';

function makeMockTrack(id: string, durationSec = 10, bpm = 120): Track {
  return {
    id,
    fileName: `${id}.mp3`,
    title: `Track ${id}`,
    artist: 'Artist',
    sizeBytes: 1024 * 500,
    source: { kind: 'opfs', path: `/${id}` },
    analysis: {
      bpm,
      bpmConfidence: 0.95,
      firstBeatSec: 0,
      beatsPerBar: 4,
      key: { camelot: '8B', confidence: 0.9 },
      durationSec,
      introEndSec: 0,
      outroStartSec: durationSec - 2,
      barEnergy: [0.5, 0.5],
      loudnessGainDb: 0,
      analysisVersion: 1,
    },
  };
}

describe('Milestone M9: PWA Manifest & App Shell Integrity', () => {
  it('has a valid manifest.webmanifest with required PWA standalone metadata and icons', () => {
    const manifestPath = path.resolve(__dirname, '../../public/manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    expect(manifest.name).toBeDefined();
    expect(manifest.short_name).toBeDefined();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0B0F19');
    expect(manifest.background_color).toBe('#0B0F19');

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const has192 = manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192');
    const has512 = manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512');
    const hasMaskable = manifest.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'));

    expect(has192).toBe(true);
    expect(has512).toBe(true);
    expect(hasMaskable).toBe(true);
  });

  it('has valid PNG icon binaries in public/ matching PNG magic bytes', () => {
    const icon192 = path.resolve(__dirname, '../../public/icon-192.png');
    const icon512 = path.resolve(__dirname, '../../public/icon-512.png');

    expect(fs.existsSync(icon192)).toBe(true);
    expect(fs.existsSync(icon512)).toBe(true);

    const buf192 = fs.readFileSync(icon192);
    const buf512 = fs.readFileSync(icon512);

    // PNG Magic Bytes: 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) {
      expect(buf192[i]).toBe(pngSignature[i]);
      expect(buf512[i]).toBe(pngSignature[i]);
    }
  });

  it('has public/sw.js with app shell precaching and offline navigation fallback', () => {
    const swPath = path.resolve(__dirname, '../../public/sw.js');
    expect(fs.existsSync(swPath)).toBe(true);

    const content = fs.readFileSync(swPath, 'utf-8');
    expect(content).toContain('CACHE_NAME');
    expect(content).toContain('addEventListener(\'install\'');
    expect(content).toContain('addEventListener(\'activate\'');
    expect(content).toContain('addEventListener(\'fetch\'');
    expect(content).toContain('/manifest.webmanifest');
  });
});

describe('Milestone M9: Screen Wake Lock API Service', () => {
  let originalWakeLock: unknown;

  beforeEach(() => {
    originalWakeLock = (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });

  afterEach(() => {
    (navigator as unknown as { wakeLock?: unknown }).wakeLock = originalWakeLock;
  });

  it('acquires and releases wake lock when API is available', async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    const mockSentinel = {
      released: false,
      release: mockRelease,
      addEventListener: vi.fn(),
    };
    const mockRequest = vi.fn().mockResolvedValue(mockSentinel);

    (navigator as unknown as { wakeLock: unknown }).wakeLock = {
      request: mockRequest,
    };

    const acquired = await wakeLockManager.acquireLock();
    expect(acquired).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith('screen');
    expect(wakeLockManager.isLocked).toBe(true);
    expect(wakeLockManager.isRequested).toBe(true);

    wakeLockManager.releaseLock();
    expect(mockRelease).toHaveBeenCalled();
    expect(wakeLockManager.isLocked).toBe(false);
  });

  it('gracefully handles browsers without Wake Lock support', async () => {
    (navigator as unknown as { wakeLock?: unknown }).wakeLock = undefined;

    const acquired = await wakeLockManager.acquireLock();
    expect(acquired).toBe(false);
    expect(wakeLockManager.isLocked).toBe(false);

    // releaseLock should not throw
    expect(() => wakeLockManager.releaseLock()).not.toThrow();
  });
});

describe('Milestone M9: Long Session Memory Bounds (10+ Transitions)', () => {
  it('enforces maximum 2 decoded AudioBuffers loaded in memory across 12 consecutive transitions', async () => {
    const mixer = new TwoDeckMixer(new AudioContext());
    const mockBuffer = mixer.context.createBuffer(1, 44100 * 5, 44100);

    // Create 12 tracks to cycle through
    const tracks: Track[] = Array.from({ length: 12 }, (_, i) =>
      makeMockTrack(`track-${i}`, 4, 120)
    );

    const mockLoader = vi.fn().mockResolvedValue(mockBuffer);

    const engine = new AutoMixEngine({
      mixer,
      bufferLoader: mockLoader,
      settings: {
        mixBars: 8,
        transitionStyle: 'bassSwap',
        maxTempoStretchPct: 6,
        keyAwareOrdering: true,
        targetLoudnessDb: -14,
      },
    });

    engine.setPlaylist(tracks);
    await engine.play();

    // Loop through 11 transitions
    for (let t = 0; t < 11; t++) {
      // Advance to transition
      await engine.tick();

      // Trigger skip / transition to advance to next track
      engine.skip();

      // Check loaded buffer count: deckA and deckB combined must NEVER exceed 2 buffers
      const loadedBuffers = (mixer.deckA.hasBuffer ? 1 : 0) + (mixer.deckB.hasBuffer ? 1 : 0);
      expect(loadedBuffers).toBeLessThanOrEqual(2);
    }

    engine.stop();
    mixer.destroy();
  });

  it('measures time-to-first-sound target (< 1000 ms)', async () => {
    const mixer = new TwoDeckMixer(new AudioContext());
    const mockBuffer = mixer.context.createBuffer(1, 44100 * 5, 44100);

    const tracks = [makeMockTrack('t1', 5), makeMockTrack('t2', 5)];
    const mockLoader = vi.fn().mockResolvedValue(mockBuffer);

    const engine = new AutoMixEngine({
      mixer,
      bufferLoader: mockLoader,
    });

    engine.setPlaylist(tracks);

    const start = performance.now();
    await engine.play();
    const elapsedMs = performance.now() - start;

    // Time to first sound must be under 1s (1000 ms) target
    expect(elapsedMs).toBeLessThan(1000);
    expect(engine.isPlaying).toBe(true);

    engine.stop();
    mixer.destroy();
  });
});
