import { test, expect } from '@playwright/test';

test.describe('AutoMix Application Shell', () => {
  test('loads placeholder application and navigates screens', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/AutoMix/i);

    // Check header
    const headerTitle = page.locator('header h1');
    await expect(headerTitle).toContainText(/AutoMix/i);

    // Default screen should be Now Mixing
    await expect(page.getByTestId('screen-now-mixing')).toBeVisible();

    // Navigate to Library
    await page.getByRole('button', { name: /Library/i }).click();
    await expect(page.getByTestId('screen-library')).toBeVisible();

    // Navigate to Playlist
    await page.getByRole('button', { name: /Playlist/i }).click();
    await expect(page.getByTestId('screen-playlist')).toBeVisible();

    // Navigate to Settings
    await page.getByRole('button', { name: /Settings/i }).click();
    await expect(page.getByTestId('screen-settings')).toBeVisible();
  });
});
