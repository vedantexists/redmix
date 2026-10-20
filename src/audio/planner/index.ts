import type { Settings, Track, TrackAnalysis, TransitionPlan } from '@/shared/types';

/**
 * PURE FUNCTIONS: Transition planning, key compatibility, ordering.
 * Never contain UI, DOM, Web Audio, React, or storage imports.
 */

/**
 * Checks if two Camelot key codes are harmonically compatible.
 * Rules:
 * 1. Same key code (e.g. 8A to 8A, 11B to 11B)
 * 2. Relative major/minor: same number, different letter (e.g. 8A to 8B, 11B to 11A)
 * 3. Adjacent number on the wheel (+/-1) with same letter (e.g. 8A to 7A, 8A to 9A)
 * 4. Circular wraparound: 12 to 1 and 1 to 12 with same letter (e.g. 12A to 1A, 1B to 12B)
 */
export function camelotCompatible(k1: string, k2: string): boolean {
  if (!k1 || !k2) return false;
  const key1 = k1.trim().toUpperCase();
  const key2 = k2.trim().toUpperCase();

  if (key1 === key2) return true;

  const match1 = key1.match(/^(\d{1,2})([AB])$/);
  const match2 = key2.match(/^(\d{1,2})([AB])$/);
  if (!match1 || !match2) return false;

  const num1 = parseInt(match1[1]!, 10);
  const letter1 = match1[2]!;
  const num2 = parseInt(match2[1]!, 10);
  const letter2 = match2[2]!;

  if (num1 < 1 || num1 > 12 || num2 < 1 || num2 > 12) return false;

  // Same number: identical key or relative major/minor
  if (num1 === num2) return true;

  // Adjacent number on circle of fifths with same mode
  if (letter1 === letter2) {
    const diff = Math.abs(num1 - num2);
    if (diff === 1 || diff === 11) return true;
  }

  return false;
}

/**
 * Orders tracks into a continuous harmonic playlist.
 * Deterministic, non-mutating, handles 0, 1, 2 tracks.
 */
export function orderPlaylist(tracks: Track[], settings: Settings): Track[] {
  if (!tracks || tracks.length <= 2) {
    return tracks ? [...tracks] : [];
  }

  const pool = [...tracks];

  // Deterministic starting track: sort by ID or title first, pick lowest BPM
  pool.sort((a, b) => {
    const bpmA = a.analysis?.bpm ?? 120;
    const bpmB = b.analysis?.bpm ?? 120;
    if (bpmA !== bpmB) return bpmA - bpmB;
    return a.id.localeCompare(b.id);
  });

  const ordered: Track[] = [pool.shift()!];

  while (pool.length > 0) {
    const prev = ordered[ordered.length - 1]!;
    const prevBpm = prev.analysis?.bpm ?? 120;
    const prevKey = prev.analysis?.key?.camelot ?? '';

    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i]!;
      const candBpm = candidate.analysis?.bpm ?? 120;
      const candKey = candidate.analysis?.key?.camelot ?? '';

      // Score: lower is better
      const bpmDiff = Math.abs(candBpm - prevBpm);
      let score = bpmDiff;

      if (settings.keyAwareOrdering && prevKey && candKey) {
        if (prevKey === candKey) {
          score -= 30; // Strong bonus for same key
        } else if (camelotCompatible(prevKey, candKey)) {
          score -= 15; // Bonus for harmonic compatibility
        } else {
          score += 15; // Penalty for clashing keys
        }
      }

      // Tie breaker for determinism
      if (score < bestScore || (score === bestScore && candidate.id < pool[bestIdx]!.id)) {
        bestScore = score;
        bestIdx = i;
      }
    }

    ordered.push(pool.splice(bestIdx, 1)[0]!);
  }

  return ordered;
}

/**
 * Plans transition between outgoing track A and incoming track B.
 * Pure logic: bar alignment, tempo matching, fallback detection.
 */
export function planTransition(
  a: TrackAnalysis,
  b: TrackAnalysis,
  settings: Partial<Settings> = {}
): TransitionPlan {
  const bpmA = a.bpm;
  const bpmB = b.bpm;
  const barSecA = 4 * (60 / bpmA);
  const barSecB = 4 * (60 / bpmB);

  // 1. Check confidence
  if (a.bpmConfidence < 0.6 || b.bpmConfidence < 0.6) {
    const durSec = Math.min(8.0, Math.max(2.0, a.durationSec * 0.25, b.durationSec * 0.25));
    const outStart = Math.max(0, a.durationSec - durSec);
    return {
      outgoingStartSec: Math.round(outStart * 1000) / 1000,
      incomingStartSec: 0,
      durationBars: Math.max(1, Math.round(durSec / barSecA)),
      durationSec: Math.round(durSec * 1000) / 1000,
      incomingRate: 1.0,
      rateRamp: 'toNeutral',
      style: 'simpleCrossfade',
      fallbackReason: 'low_confidence',
    };
  }

  // 2. Tempo stretch matching
  const maxStretch = (settings.maxTempoStretchPct ?? 6) / 100;
  const minRate = 1 - maxStretch - 1e-6;
  const maxRate = 1 + maxStretch + 1e-6;

  let incomingRate = bpmA / bpmB;
  let stretchOk = incomingRate >= minRate && incomingRate <= maxRate;

  // Try half-time or double-time alternatives before giving up
  if (!stretchOk) {
    const doubleRate = bpmA / (bpmB * 2);
    if (doubleRate >= minRate && doubleRate <= maxRate) {
      incomingRate = doubleRate;
      stretchOk = true;
    } else {
      const halfRate = bpmA / (bpmB / 2);
      if (halfRate >= minRate && halfRate <= maxRate) {
        incomingRate = halfRate;
        stretchOk = true;
      }
    }
  }

  // 3. Explicit simpleCrossfade or fallback on tempo gap
  if (settings.transitionStyle === 'simpleCrossfade') {
    const durSec = Math.min(8.0, Math.max(2.0, a.durationSec * 0.25, b.durationSec * 0.25));
    const outStart = a.outroStartSec > 0 && a.outroStartSec <= a.durationSec - durSec
      ? a.outroStartSec
      : Math.max(0, a.durationSec - durSec);
    return {
      outgoingStartSec: Math.round(outStart * 1000) / 1000,
      incomingStartSec: Math.round(b.firstBeatSec * 1000) / 1000,
      durationBars: Math.max(1, Math.round(durSec / barSecA)),
      durationSec: Math.round(durSec * 1000) / 1000,
      incomingRate: 1.0,
      rateRamp: 'toNeutral',
      style: 'simpleCrossfade',
    };
  }

  if (!stretchOk) {
    const durSec = Math.min(8.0, Math.max(2.0, a.durationSec * 0.25, b.durationSec * 0.25));
    const outStart = Math.max(0, a.durationSec - durSec);
    return {
      outgoingStartSec: Math.round(outStart * 1000) / 1000,
      incomingStartSec: 0,
      durationBars: Math.max(1, Math.round(durSec / barSecA)),
      durationSec: Math.round(durSec * 1000) / 1000,
      incomingRate: 1.0,
      rateRamp: 'toNeutral',
      style: 'simpleCrossfade',
      fallbackReason: 'tempo_gap_too_large',
    };
  }

  // 4. Mix duration in bars (respects settings or adapts to incoming intro)
  let durationBars: number = settings.mixBars ?? 16;
  if (!settings.mixBars && b.introEndSec > b.firstBeatSec) {
    const introBarsB = Math.round((b.introEndSec - b.firstBeatSec) / barSecB);
    if (introBarsB >= 4 && introBarsB <= 32) {
      durationBars = introBarsB;
    }
  }

  const maxBarsA = Math.floor(Math.max(0, a.durationSec - a.firstBeatSec) / barSecA);
  const maxBarsB = Math.floor(Math.max(0, b.durationSec - b.firstBeatSec) / barSecB);
  const maxPossibleBars = Math.max(1, Math.min(maxBarsA, maxBarsB));

  if (durationBars > maxPossibleBars) {
    durationBars = maxPossibleBars;
  }

  let durationSec = durationBars * barSecA;

  // 5. outgoingStartSec: aligned to track A's bar grid
  // Grid line for bar k: t_k = firstBeatSec + k * barSecA
  const firstBeatA = a.firstBeatSec;
  const latestPossibleStart = Math.max(0, a.durationSec - durationSec);

  // Target start: outroStartSec if valid, else latestPossibleStart
  let targetStart = latestPossibleStart;
  if (a.outroStartSec > 0 && a.outroStartSec <= latestPossibleStart) {
    targetStart = a.outroStartSec;
  }

  // Snap to closest bar boundary of track A
  let k = Math.round((targetStart - firstBeatA) / barSecA);
  let snapStart = firstBeatA + k * barSecA;

  // Ensure within track bounds
  while (snapStart + durationSec > a.durationSec + 1e-4 && k > 0) {
    k -= 1;
    snapStart = firstBeatA + k * barSecA;
  }
  while (snapStart < 0) {
    k += 1;
    snapStart = firstBeatA + k * barSecA;
  }
  while (snapStart + durationSec > a.durationSec + 1e-4 && durationBars > 1) {
    durationBars -= 1;
    durationSec = durationBars * barSecA;
  }

  const outgoingStartSec = Math.max(0, Math.round(snapStart * 1000) / 1000);

  // 6. incomingStartSec: start B at its first bar
  const incomingStartSec = Math.max(0, Math.round(b.firstBeatSec * 1000) / 1000);

  return {
    outgoingStartSec,
    incomingStartSec,
    durationBars,
    durationSec: Math.round(durationSec * 1000) / 1000,
    incomingRate: Math.round(incomingRate * 10000) / 10000,
    rateRamp: 'toNeutral',
    style: settings.transitionStyle ?? 'bassSwap',
  };
}
