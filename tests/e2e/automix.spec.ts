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

test.describe('M7 Full AutoMix E2E Flow & Mobile Usability', () => {
  test('verifies 360px mobile responsiveness and 44px minimum touch targets', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');

    // Check bottom navigation tabs
    const tabs = ['tab-mixing', 'tab-library', 'tab-playlist', 'tab-editor', 'tab-settings'];
    for (const tabId of tabs) {
      const tab = page.getByTestId(tabId);
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Navigate to Now Mixing and verify primary transport buttons touch target
    const playPauseBtn = page.getByTestId('btn-play-pause');
    const playBox = await playPauseBtn.boundingBox();
    expect(playBox).not.toBeNull();
    if (playBox) {
      expect(playBox.width).toBeGreaterThanOrEqual(44);
      expect(playBox.height).toBeGreaterThanOrEqual(44);
    }

    const skipBtn = page.getByTestId('btn-skip');
    const skipBox = await skipBtn.boundingBox();
    expect(skipBox).not.toBeNull();
    if (skipBox) {
      expect(skipBox.width).toBeGreaterThanOrEqual(44);
      expect(skipBox.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('covers full lifecycle: import -> analyze -> playlist queue -> auto-order -> play -> automatic transition -> skip', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Navigate to Library
    await page.getByTestId('tab-library').click();
    await expect(page.getByTestId('screen-library')).toBeVisible();

    // 2. Generate 3 synthetic audio tracks with click beats at 120 BPM
    const wav1 = createClickWavBuffer({ bpm: 120, durationSec: 6.0, clickFrequency: 880 });
    const wav2 = createClickWavBuffer({ bpm: 120, durationSec: 4.0, clickFrequency: 440 });
    const wav3 = createClickWavBuffer({ bpm: 120, durationSec: 5.0, clickFrequency: 660 });

    const fileInput = page.getByTestId('input-file-fallback');
    await fileInput.setInputFiles([
      {
        name: 'Track Alpha.wav',
        mimeType: 'audio/wav',
        buffer: wav1,
      },
      {
        name: 'Track Beta.wav',
        mimeType: 'audio/wav',
        buffer: wav2,
      },
      {
        name: 'Track Gamma.wav',
        mimeType: 'audio/wav',
        buffer: wav3,
      },
    ]);

    // Verify tracks are imported and visible in library
    await expect(page.getByTestId('track-list')).toBeVisible();
    await expect(page.getByText('Track Alpha', { exact: true })).toBeVisible();
    await expect(page.getByText('Track Beta', { exact: true })).toBeVisible();
    await expect(page.getByText('Track Gamma', { exact: true })).toBeVisible();

    // 3. Trigger and await Analysis (F1 fix)
    await page.getByTestId('btn-analyze-all').click();
    // Await all 3 tracks to complete analysis (badges rendered)
    await expect(page.locator('[data-testid^="badge-bpm-"]')).toHaveCount(3, { timeout: 15000 });
    await expect(page.locator('[data-testid^="badge-key-"]')).toHaveCount(3);

    // 4. Add analyzed tracks to playlist queue
    await page.getByTestId('btn-add-all-to-playlist').click();

    // 5. Navigate to Playlist screen
    await page.getByTestId('tab-playlist').click();
    await expect(page.getByTestId('screen-playlist')).toBeVisible();

    // Assert all 3 tracks in playlist queue
    await expect(page.getByTestId('playlist-item-0')).toBeVisible();
    await expect(page.getByTestId('playlist-item-1')).toBeVisible();
    await expect(page.getByTestId('playlist-item-2')).toBeVisible();
    await expect(page.getByTestId('playlist-item-0')).toContainText('Track Alpha');
    await expect(page.getByTestId('playlist-item-1')).toContainText('Track Beta');
    await expect(page.getByTestId('playlist-item-2')).toContainText('Track Gamma');

    // 6. Test manual reordering (Move Track Alpha down)
    await page.getByTestId('btn-move-down-0').click();
    await expect(page.getByTestId('playlist-item-0')).toContainText('Track Beta');
    await expect(page.getByTestId('playlist-item-1')).toContainText('Track Alpha');

    // 7. Test Auto-Order button
    const autoOrderBtn = page.getByTestId('btn-auto-order');
    await expect(autoOrderBtn).toBeVisible();
    await autoOrderBtn.click();

    // Re-verify queue after auto-order
    await expect(page.getByTestId('playlist-item-0')).toBeVisible();

    // 8. Start playback from playlist
    await page.getByTestId('btn-playlist-play').click();

    // 9. Navigate to Now Mixing view
    await page.getByTestId('tab-mixing').click();
    await expect(page.getByTestId('screen-now-mixing')).toBeVisible();

    // Verify active track is populated
    await expect(page.getByTestId('now-mixing-current')).toBeVisible();
    const track1Text = (await page.getByTestId('now-mixing-current').textContent()) || '';
    expect(track1Text.length).toBeGreaterThan(0);

    // Verify transition countdown indicator is rendered
    await expect(page.getByTestId('transition-countdown')).toBeVisible();

    // 10. Automatic Transition Verification (F2 fix)
    // As Track 1 reaches its transition start point, the lookahead scheduler fires.
    // The mixing status activates and Track 1 automatically blends into Track 2.
    // Wait for the automatic transition to complete and verify active track changed without manual intervention.
    await expect(page.getByTestId('now-mixing-current')).not.toHaveText(track1Text, {
      timeout: 12000,
    });
    const track2Text = (await page.getByTestId('now-mixing-current').textContent()) || '';
    expect(track2Text.length).toBeGreaterThan(0);
    expect(track2Text).not.toEqual(track1Text);

    // 11. Beat-aligned Skip Verification with Concrete State Change (F3 fix)
    await page.getByTestId('btn-skip').click();

    // The skip initiates a 1.0s crossfade to the next track.
    // Await crossfade completion and verify active track text changes to Track 3.
    await expect(page.getByTestId('now-mixing-current')).not.toHaveText(track2Text, {
      timeout: 5000,
    });
    const track3Text = (await page.getByTestId('now-mixing-current').textContent()) || '';
    expect(track3Text.length).toBeGreaterThan(0);
    expect(track3Text).not.toEqual(track2Text);

    // 12. Transport Controls: Pause and Resume
    const playPauseBtn = page.getByTestId('btn-play-pause');
    await playPauseBtn.click();
    await expect(playPauseBtn).toContainText('Play');
    await playPauseBtn.click();
    await expect(playPauseBtn).toContainText('Pause');
  });
});
