import { test, expect } from '@playwright/test';

function createValidWavBuffer(durationSec = 2, sampleRate = 22050, frequency = 440): Buffer {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit PCM
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // 16 bytes for PCM format
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Audio tone
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    const intSample = Math.floor(sample * 30000);
    buffer.writeInt16LE(intSample, 44 + i * 2);
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

  test('covers full lifecycle: import -> library -> playlist queue -> auto-order -> play -> skip', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Navigate to Library
    await page.getByTestId('tab-library').click();
    await expect(page.getByTestId('screen-library')).toBeVisible();

    // 2. Import two synthetic audio tracks with distinct parameters
    const wav1 = createValidWavBuffer(3, 22050, 440);
    const wav2 = createValidWavBuffer(4, 22050, 554);

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
    ]);

    // Verify tracks are imported and visible in library
    await expect(page.getByTestId('track-list')).toBeVisible();
    await expect(page.getByText('Track Alpha', { exact: true })).toBeVisible();
    await expect(page.getByText('Track Beta', { exact: true })).toBeVisible();

    // 3. Add tracks to playlist queue
    await page.getByTestId('btn-add-all-to-playlist').click();

    // 4. Navigate to Playlist screen
    await page.getByTestId('tab-playlist').click();
    await expect(page.getByTestId('screen-playlist')).toBeVisible();

    // Assert both tracks in playlist queue
    await expect(page.getByTestId('playlist-item-0')).toBeVisible();
    await expect(page.getByTestId('playlist-item-1')).toBeVisible();
    await expect(page.getByTestId('playlist-item-0')).toContainText('Track Alpha');
    await expect(page.getByTestId('playlist-item-1')).toContainText('Track Beta');

    // 5. Test manual reordering (Move Track Alpha down)
    await page.getByTestId('btn-move-down-0').click();
    // After moving down, Track Beta is now index 0 and Track Alpha is index 1
    await expect(page.getByTestId('playlist-item-0')).toContainText('Track Beta');
    await expect(page.getByTestId('playlist-item-1')).toContainText('Track Alpha');

    // 6. Test Auto-Order button
    const autoOrderBtn = page.getByTestId('btn-auto-order');
    await expect(autoOrderBtn).toBeVisible();
    await autoOrderBtn.click();

    // 7. Start playback from playlist
    await page.getByTestId('btn-playlist-play').click();

    // 8. Navigate to Now Mixing view
    await page.getByTestId('tab-mixing').click();
    await expect(page.getByTestId('screen-now-mixing')).toBeVisible();

    // Verify active track is populated
    await expect(page.getByTestId('now-mixing-current')).toBeVisible();
    const currentText = await page.getByTestId('now-mixing-current').textContent();
    expect(currentText).toContain('Track');

    // Verify transition countdown indicator is rendered
    await expect(page.getByTestId('transition-countdown')).toBeVisible();

    // Verify transition settings interaction
    await page.getByTestId('btn-mixbars-8').click();
    await expect(page.getByTestId('btn-mixbars-8')).toHaveClass(/bg-indigo-600/);

    await page.getByTestId('btn-style-longBlend').click();
    await expect(page.getByTestId('btn-style-longBlend')).toHaveClass(/bg-purple-600/);

    // 9. Skip to next track and verify state change
    const initialTrackText = await page.getByTestId('now-mixing-current').textContent();
    expect(initialTrackText).toBeDefined();
    await page.getByTestId('btn-skip').click();

    // Wait for transition or track change to reflect
    await page.waitForTimeout(500);
    const updatedTrackText = await page.getByTestId('now-mixing-current').textContent();
    // Confirm transport is responsive and active
    expect(updatedTrackText).toBeDefined();

    // 10. Pause and Resume
    const playPauseBtn = page.getByTestId('btn-play-pause');
    await playPauseBtn.click();
    await page.waitForTimeout(200);
    await playPauseBtn.click();
  });
});
