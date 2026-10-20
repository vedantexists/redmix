export interface WaveformData {
  durationSec: number;
  sampleRate: number;
  peaks: Float32Array;
  numBins: number;
}

export interface BeatMarker {
  timeSec: number;
  isDownbeat: boolean;
  barNumber: number;
  beatInBar: number; // 1, 2, 3, 4
}

/**
 * Extracts downsampled peak amplitudes for fast, smooth rendering.
 * Optimized for performance: handles 10+ minute tracks in a single fast pass.
 */
export function extractWaveformData(
  pcm: Float32Array,
  sampleRate: number,
  targetBins = 1000
): WaveformData {
  if (!pcm || pcm.length === 0 || sampleRate <= 0) {
    return {
      durationSec: 0,
      sampleRate: sampleRate > 0 ? sampleRate : 44100,
      peaks: new Float32Array(0),
      numBins: 0,
    };
  }

  const durationSec = pcm.length / sampleRate;
  const numBins = Math.min(targetBins, pcm.length);
  const peaks = new Float32Array(numBins);
  const samplesPerBin = pcm.length / numBins;

  for (let b = 0; b < numBins; b++) {
    const startIdx = Math.floor(b * samplesPerBin);
    const endIdx = Math.min(pcm.length, Math.floor((b + 1) * samplesPerBin));
    let max = 0;

    for (let i = startIdx; i < endIdx; i++) {
      const val = Math.abs(pcm[i] ?? 0);
      if (val > max) max = val;
    }

    // Clamp normalized amplitude
    peaks[b] = Math.min(1.0, max);
  }

  return {
    durationSec,
    sampleRate,
    peaks,
    numBins,
  };
}

/**
 * Computes beat grid markers based on effective firstBeatSec and bpm.
 */
export function getBeatGridMarkers(
  firstBeatSec: number,
  bpm: number,
  durationSec: number,
  beatsPerBar = 4
): BeatMarker[] {
  if (bpm <= 0 || durationSec <= 0) return [];

  const markers: BeatMarker[] = [];
  const beatIntervalSec = 60 / bpm;

  // Find initial beat in view range
  let beatIndex = 0;
  let currentBeatTime = firstBeatSec;

  // Trace back if firstBeatSec is positive and has previous beats
  if (currentBeatTime > 0) {
    const beatsBefore = Math.floor(currentBeatTime / beatIntervalSec);
    currentBeatTime -= beatsBefore * beatIntervalSec;
    beatIndex = -beatsBefore;
  }

  while (currentBeatTime < durationSec + beatIntervalSec) {
    if (currentBeatTime >= 0 && currentBeatTime <= durationSec) {
      // Modulo arithmetic handling negative beat indices
      const beatInBar = (((beatIndex % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
      const isDownbeat = beatInBar === 1;
      const barNumber = Math.floor(beatIndex / beatsPerBar) + 1;

      markers.push({
        timeSec: Math.round(currentBeatTime * 1000) / 1000,
        isDownbeat,
        barNumber,
        beatInBar,
      });
    }

    currentBeatTime += beatIntervalSec;
    beatIndex += 1;
  }

  return markers;
}

export interface WaveformRenderOptions {
  firstBeatSec: number;
  bpm: number;
  currentTime?: number;
  viewStartSec?: number;
  viewEndSec?: number;
}

/**
 * Draws waveform and beat grid on an HTML5 Canvas.
 */
export function renderWaveformToCanvas(
  canvas: HTMLCanvasElement,
  waveform: WaveformData,
  options: WaveformRenderOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const durationSec = waveform.durationSec;

  if (width === 0 || height === 0 || durationSec <= 0) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  const viewStartSec = Math.max(0, options.viewStartSec ?? 0);
  const viewEndSec = Math.min(durationSec, options.viewEndSec ?? durationSec);
  const viewDuration = Math.max(0.1, viewEndSec - viewStartSec);

  const timeToX = (t: number): number => {
    return ((t - viewStartSec) / viewDuration) * width;
  };

  // 1. Clear background
  ctx.fillStyle = '#0B0F19';
  ctx.fillRect(0, 0, width, height);

  // 2. Draw Centerline
  const midY = height / 2;
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();

  // 3. Draw Waveform Peaks
  const peaks = waveform.peaks;
  if (peaks.length > 0) {
    ctx.fillStyle = '#6366F1'; // Indigo 500
    const binDuration = durationSec / peaks.length;

    for (let i = 0; i < peaks.length; i++) {
      const binTime = i * binDuration;
      if (binTime + binDuration < viewStartSec || binTime > viewEndSec) continue;

      const x = timeToX(binTime);
      const barW = Math.max(1, (binDuration / viewDuration) * width);
      const amp = peaks[i] ?? 0;
      const barH = Math.max(2, amp * (height * 0.45));

      ctx.fillRect(x, midY - barH, barW, barH * 2);
    }
  }

  // 4. Draw Beat Grid Overlay
  const beats = getBeatGridMarkers(options.firstBeatSec, options.bpm, durationSec);

  for (const beat of beats) {
    if (beat.timeSec < viewStartSec || beat.timeSec > viewEndSec) continue;
    const x = timeToX(beat.timeSec);

    if (beat.isDownbeat) {
      // Downbeat (Bar Line): Vibrant Emerald
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Bar Number Label
      ctx.fillStyle = '#10B981';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${beat.barNumber}`, x + 3, 12);
    } else {
      // Intermediate Beats: Subtle Cyan / White dashed line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  // 5. Draw Playhead
  if (options.currentTime !== undefined && options.currentTime >= viewStartSec && options.currentTime <= viewEndSec) {
    const playheadX = timeToX(options.currentTime);
    ctx.strokeStyle = '#F43F5E'; // Rose 500
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }
}
