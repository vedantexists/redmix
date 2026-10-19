import { test, expect } from '@playwright/test';

test.describe('Library & File Import Flow', () => {
  test('imports track, displays in library, and persists across full page reload', async ({
    page,
  }) => {
    await page.goto('/');

    // Navigate to Library
    await page.getByRole('button', { name: /Library/i }).click();
    await expect(page.getByTestId('screen-library')).toBeVisible();

    // Verify empty library state
    await expect(page.getByTestId('library-empty-state')).toBeVisible();

    // Create synthetic WAV audio buffer
    const mockAudioHeader = Buffer.from('RIFF$   WAVEfmt     data    ', 'ascii');

    // Import file via fallback file input
    const fileInput = page.getByTestId('input-file-fallback');
    await fileInput.setInputFiles({
      name: 'Test Artist - Midnight Dream.wav',
      mimeType: 'audio/wav',
      buffer: mockAudioHeader,
    });

    // Verify track list is populated
    await expect(page.getByTestId('track-list')).toBeVisible();
    await expect(page.getByText('Midnight Dream', { exact: true })).toBeVisible();
    await expect(page.getByText('Test Artist · ')).toBeVisible();

    // Reload the page completely to test IndexedDB persistence
    await page.reload();

    // Navigate back to Library
    await page.getByRole('button', { name: /Library/i }).click();
    await expect(page.getByTestId('screen-library')).toBeVisible();

    // Assert track persists after reload
    await expect(page.getByTestId('track-list')).toBeVisible();
    await expect(page.getByText('Midnight Dream', { exact: true })).toBeVisible();

    // Test rejection of unsupported file
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Some plain text', 'utf-8'),
    });

    // Error banner should display
    await expect(page.getByTestId('import-error-banner')).toBeVisible();
    await expect(page.getByText(/Unsupported file format/i)).toBeVisible();
  });
});
