import { test, expect } from '@playwright/test';
import { generateSyntheticClickTrack } from '../fixtures/syntheticAudio';

function createClickWavBuffer(options: {
  bpm: number;
  durationSec: number;
  sampleRate?: number;
  firstBeatSec?: number;
  clickFrequency?: number;
}): Buffer {
  const sampleRate = options.sampleRate ?? 22050;
  const pcm = generateSyntheticClickTrack({
    bpm: options.bpm,
    durationSec: options.durationSec,
    sampleRate,
    firstBeatSec: options.firstBeatSec ?? 0,
    clickFrequency: options.clickFrequency ?? 880,
  });

  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = pcm.length * numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    const val = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    buffer.writeInt16LE(Math.floor(val * 32000), 44 + i * 2);
  }

  return buffer;
}

test.describe('M8 Track Editor E2E Flow', () => {
  test('renders waveform, allows nudging and bpm edits, persists across reload, and tests audition player', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Navigate to Library and import a track
    await page.getByTestId('tab-library').click();
    await expect(page.getByTestId('screen-library')).toBeVisible();

    const wav = createClickWavBuffer({ bpm: 120, durationSec: 5.0, clickFrequency: 880 });
    const fileInput = page.getByTestId('input-file-fallback');
    await fileInput.setInputFiles([
      {
        name: 'Editor Test Track.wav',
        mimeType: 'audio/wav',
        buffer: wav,
      },
    ]);

    await expect(page.getByText('Editor Test Track', { exact: true })).toBeVisible();

    // 2. Analyze track so it has analysis metadata
    await page.getByTestId('btn-analyze-all').click();
    await expect(page.locator('[data-testid^="badge-bpm-"]')).toHaveCount(1, { timeout: 15000 });

    // 3. Navigate to Track Editor screen
    await page.getByTestId('tab-editor').click();
    await expect(page.getByTestId('screen-track-editor')).toBeVisible();

    // 4. Verify Waveform Canvas renders
    await expect(page.getByTestId('waveform-canvas')).toBeVisible();

    // Verify initial BPM badge
    await expect(page.getByTestId('badge-editor-bpm')).toContainText('120.0 BPM');
    const initialBeatText = (await page.getByTestId('badge-editor-first-beat').textContent()) || '';

    // 5. Nudge Beat Grid (+10ms)
    await page.getByTestId('btn-nudge-right').click();
    // Override badge should appear
    await expect(page.getByTestId('badge-override-active')).toBeVisible();
    await expect(page.getByTestId('badge-editor-first-beat')).not.toHaveText(initialBeatText);

    // 6. BPM Adjustments: Double then Halve
    await page.getByTestId('btn-double-bpm').click();
    await expect(page.getByTestId('badge-editor-bpm')).toContainText('240.0 BPM');

    await page.getByTestId('btn-half-bpm').click();
    await expect(page.getByTestId('badge-editor-bpm')).toContainText('120.0 BPM');

    // Fine-tune BPM (+0.5)
    await page.getByTestId('btn-bpm-inc').click();
    await expect(page.getByTestId('badge-editor-bpm')).toContainText('120.5 BPM');

    // 7. Audition Player Controls & Metronome
    const auditionPlayBtn = page.getByTestId('btn-audition-play');
    await auditionPlayBtn.click();
    await expect(auditionPlayBtn).toContainText('Pause Audition');

    const metronomeBtn = page.getByTestId('btn-audition-metronome');
    await metronomeBtn.click();
    await expect(metronomeBtn).toContainText('ON');

    // Tap First Beat while auditioning
    await page.getByTestId('btn-tap-first-beat').click();
    await auditionPlayBtn.click();
    await expect(auditionPlayBtn).toContainText('Audition Play');

    // 8. Test Persistence Across Full Page Reload
    await page.reload();

    // Navigate back to Editor
    await page.getByTestId('tab-editor').click();
    await expect(page.getByTestId('screen-track-editor')).toBeVisible();

    // Verify user overrides persisted in IndexedDB
    await expect(page.getByTestId('badge-override-active')).toBeVisible();
    await expect(page.getByTestId('badge-editor-bpm')).toContainText('120.5 BPM');

    // 9. Reset Overrides
    await page.getByTestId('btn-reset-overrides').click();
    await expect(page.getByTestId('badge-override-active')).not.toBeVisible();
    await expect(page.getByTestId('badge-editor-bpm')).toContainText('120.0 BPM');
  });
});
