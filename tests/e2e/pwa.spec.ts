import { test, expect } from '@playwright/test';

test.describe('M9 PWA, Manifest, and Mobile Hardening E2E', () => {
  test('serves valid PWA manifest, service worker, and app icons with 200 OK', async ({
    request,
  }) => {
    // 1. Verify Manifest
    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);

    const manifest = await manifestRes.json();
    expect(manifest.name).toBe('AutoMix Continuous DJ Mix');
    expect(manifest.short_name).toBe('AutoMix');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    // 2. Verify Icons
    const icon192Res = await request.get('/icon-192.png');
    expect(icon192Res.status()).toBe(200);
    expect(icon192Res.headers()['content-type']).toContain('image/png');

    const icon512Res = await request.get('/icon-512.png');
    expect(icon512Res.status()).toBe(200);
    expect(icon512Res.headers()['content-type']).toContain('image/png');

    // 3. Verify Service Worker script
    const swRes = await request.get('/sw.js');
    expect(swRes.status()).toBe(200);
    const swText = await swRes.text();
    expect(swText).toContain('CACHE_NAME');
    expect(swText).toContain('automix-v1');
  });

  test('displays mobile hardening settings, honest iOS/Android notes, and cache controls', async ({
    page,
  }) => {
    await page.goto('/');

    // Navigate to Settings
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('screen-settings')).toBeVisible();

    // Verify platform documentation card
    await expect(page.getByTestId('mobile-limitations-doc')).toBeVisible();
    await expect(page.getByText('iOS Safari Quirks & Background Audio')).toBeVisible();
    await expect(page.getByText('Android Chrome & Desktop Chrome')).toBeVisible();

    // Test settings toggles
    await page.getByTestId('settings-mixbars-32').click();
    await expect(page.getByTestId('settings-mixbars-32')).toHaveClass(/bg-indigo-600/);

    await page.getByTestId('settings-style-longBlend').click();
    await expect(page.getByTestId('settings-style-longBlend')).toHaveClass(/bg-purple-600/);

    await page.getByTestId('settings-key-ordering-toggle').click();

    // Test clear cache button
    await page.getByTestId('btn-clear-cache').click();
    await expect(page.getByTestId('settings-status-banner')).toBeVisible();
  });
});
