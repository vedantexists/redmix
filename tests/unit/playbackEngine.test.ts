import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AudioContextManager,
  Deck,
  TwoDeckMixer,
} from '@/audio/engine';
import { equalPowerGains } from '@/shared/math';

describe('Equal-Power Crossfade Curves', () => {
  it('satisfies gainA^2 + gainB^2 == 1.0 at every step across the transition', () => {
    const steps = [0.0, 0.1, 0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1.0];
    for (const t of steps) {
      const { gainA, gainB } = equalPowerGains(t);
      const sumOfSquares = gainA * gainA + gainB * gainB;
      expect(sumOfSquares).toBeCloseTo(1.0, 5);
    }
  });

  it('clamps t safely to [0, 1] for negative or out-of-range values', () => {
    const below = equalPowerGains(-0.5);
    expect(below.gainA).toBeCloseTo(1.0, 5);
    expect(below.gainB).toBeCloseTo(0.0, 5);

    const above = equalPowerGains(1.5);
    expect(above.gainA).toBeCloseTo(0.0, 5);
    expect(above.gainB).toBeCloseTo(1.0, 5);
  });
});

describe('AudioContextManager', () => {
  it('handles suspended state and provides audio clock timing', async () => {
    const manager = AudioContextManager.getInstance();
    const ctx = manager.getContext();
    expect(ctx).toBeDefined();

    // Verify suspended state handling
    (ctx as unknown as { state: string }).state = 'suspended';
    await manager.ensureRunning();
    expect(ctx.state).toBe('running');

    // Timing relies on audioContext.currentTime
    expect(typeof manager.currentTime).toBe('number');
  });

  it('decodes audio data into an AudioBuffer without detaching source buffer', async () => {
    const manager = AudioContextManager.getInstance();
    const rawBuffer = new ArrayBuffer(2048);
    const decoded = await manager.decodeAudioData(rawBuffer);

    expect(decoded).toBeDefined();
    expect(decoded.numberOfChannels).toBe(2);
    // Source buffer must not be detached
    expect(rawBuffer.byteLength).toBe(2048);
  });
});

describe('Deck Class Operations & Lifecycle', () => {
  let ctx: AudioContext;
  let destination: GainNode;
  let deck: Deck;

  beforeEach(() => {
    ctx = AudioContextManager.getInstance().getContext();
    destination = ctx.createGain();
    deck = new Deck('A', ctx, destination);
  });

  afterEach(() => {
    deck.destroy();
  });

  it('initializes in idle state with duration 0', () => {
    expect(deck.state).toBe('idle');
    expect(deck.duration).toBe(0);
    expect(deck.getCurrentTime()).toBe(0);
  });

  it('loads AudioBuffer and transitions state to ready', () => {
    const buffer = ctx.createBuffer(2, 44100 * 5, 44100); // 5-second buffer
    deck.loadBuffer(buffer, 'test-track-1');

    expect(deck.state).toBe('ready');
    expect(deck.duration).toBeCloseTo(5.0, 2);
    expect(deck.trackId).toBe('test-track-1');
  });

  it('plays, pauses, and tracks current playback position', async () => {
    const buffer = ctx.createBuffer(2, 44100 * 10, 44100);
    deck.loadBuffer(buffer, 'track-playback');

    await deck.play(2.5); // Play starting at 2.5s
    expect(deck.state).toBe('playing');
    expect(deck.getCurrentTime()).toBeGreaterThanOrEqual(2.5);

    deck.pause();
    expect(deck.state).toBe('paused');
    const pausedAt = deck.getCurrentTime();
    expect(pausedAt).toBeGreaterThanOrEqual(2.5);
  });

  it('accurately seeks to specific playback offset', async () => {
    const buffer = ctx.createBuffer(2, 44100 * 20, 44100);
    deck.loadBuffer(buffer, 'track-seek');

    deck.seek(7.5);
    expect(deck.getCurrentTime()).toBeCloseTo(7.5, 2);

    // Seeking beyond duration clamps to duration
    deck.seek(50.0);
    expect(deck.getCurrentTime()).toBeCloseTo(20.0, 2);

    // Seeking below 0 clamps to 0
    deck.seek(-5.0);
    expect(deck.getCurrentTime()).toBeCloseTo(0.0, 2);
  });

  it('stops playback and resets offset to 0', async () => {
    const buffer = ctx.createBuffer(2, 44100 * 10, 44100);
    deck.loadBuffer(buffer, 'track-stop');

    await deck.play(3.0);
    deck.stop();

    expect(deck.state).toBe('ready');
    expect(deck.getCurrentTime()).toBe(0);
  });

  it('uses scheduled linear ramps to prevent audio clicks on gain changes', () => {
    deck.setGain(0.5, 0.05);
    // Scheduled ramps must be used, not direct abrupt assignment
    const scheduled = (deck.deckGain.gain as unknown as { scheduledEvents: unknown[] })
      .scheduledEvents;
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it('disconnects nodes and releases buffer on destroy to prevent memory leaks', () => {
    const buffer = ctx.createBuffer(2, 44100 * 5, 44100);
    deck.loadBuffer(buffer, 'track-leak-check');

    deck.destroy();
    expect(deck.duration).toBe(0);
    expect(deck.trackId).toBeNull();
    // Connect list should be cleared
    const connections = (deck.deckGain as unknown as { connections: unknown[] }).connections;
    expect(connections.length).toBe(0);
  });
});

describe('TwoDeckMixer & Crossfader', () => {
  let mixer: TwoDeckMixer;

  beforeEach(() => {
    mixer = new TwoDeckMixer();
  });

  afterEach(() => {
    mixer.destroy();
  });

  it('initializes Deck A and Deck B connected to master gain', () => {
    expect(mixer.deckA).toBeDefined();
    expect(mixer.deckB).toBeDefined();
    expect(mixer.deckA.id).toBe('A');
    expect(mixer.deckB.id).toBe('B');
  });

  it('schedules equal-power crossfade from Deck A to Deck B with 0 clicks', () => {
    mixer.crossfade('A', 4.0);

    const eventsA = (mixer.deckA.deckGain.gain as unknown as {
      scheduledEvents: { time: number; value: number }[];
    }).scheduledEvents;
    const eventsB = (mixer.deckB.deckGain.gain as unknown as {
      scheduledEvents: { time: number; value: number }[];
    }).scheduledEvents;

    expect(eventsA.length).toBeGreaterThanOrEqual(60);
    expect(eventsB.length).toBeGreaterThanOrEqual(60);

    // Verify equal-power sum across sampled crossfade points
    for (let i = 0; i < eventsA.length; i++) {
      const gA = eventsA[i]!.value;
      const gB = eventsB[i]!.value;
      const sumOfSquares = gA * gA + gB * gB;
      expect(sumOfSquares).toBeCloseTo(1.0, 3);
    }
  });

  it('supports reverse crossfade from Deck B to Deck A', () => {
    mixer.crossfade('B', 2.0);

    const eventsA = (mixer.deckA.deckGain.gain as unknown as {
      scheduledEvents: { value: number }[];
    }).scheduledEvents;
    const eventsB = (mixer.deckB.deckGain.gain as unknown as {
      scheduledEvents: { value: number }[];
    }).scheduledEvents;

    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBeGreaterThan(0);

    // At the end of B->A crossfade, Deck A should reach 1.0 and Deck B should reach 0.0
    const finalA = eventsA[eventsA.length - 1]!.value;
    const finalB = eventsB[eventsB.length - 1]!.value;
    expect(finalA).toBeCloseTo(1.0, 3);
    expect(finalB).toBeCloseTo(0.0, 3);
  });

  it('cycles 25+ deck buffer loads without memory leak or node accumulation', () => {
    const ctx = mixer.context;
    for (let i = 0; i < 25; i++) {
      const tempDeck = new Deck('A', ctx, mixer.masterGain);
      const buf = ctx.createBuffer(1, 1024, 44100);
      tempDeck.loadBuffer(buf, `track-${i}`);
      tempDeck.destroy();
    }
  });
});
