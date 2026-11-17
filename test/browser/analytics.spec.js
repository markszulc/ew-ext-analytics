import { test, expect } from '@playwright/test';
import { demoReport } from '../../src/data.js';

test('date ranges, comparisons, chart keyboard access, and CSV export work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.metric-value')).toHaveCount(4);
  await expect(page.locator('.source-button')).toContainText('Demo data');
  const original = await page.locator('.metric-value').first().textContent();
  await page.locator('sp-picker').click();
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click();
  await expect(page.locator('.chart-legend')).toContainText('Last 7 days');
  await expect(page.locator('.metric-value').first()).not.toHaveText(original);
  await page.locator('sp-switch').click();
  await expect(page.locator('.previous-line')).toHaveCount(0);
  await expect(page.locator('.delta')).toHaveCount(0);
  await page.locator('.chart-interaction').focus();
  await page.keyboard.press('End');
  await expect(page.locator('.chart-tooltip')).toBeVisible();
  await expect(page.locator('.chart-interaction')).toHaveAttribute('aria-valuenow', '7');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report as CSV' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('page-insights-demo-7d.csv');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain('DEMO DATA - not actual page performance');
  expect(errors).toEqual([]);
});

test('connection settings explain setup without accepting browser-side secrets', async ({ page }) => {
  await page.route('**/api/connection', (route) => route.fulfill({ json: { configured: false, suite: '' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Data connection settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Live connection not configured');
  await expect(page.getByRole('button', { name: 'Use live Analytics' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('live errors never silently fall back to demo data and can be retried', async ({ page }) => {
  await page.route('**/api/connection', (route) => route.fulfill({ json: { configured: true, suite: 'Test suite' } }));
  await page.route('**/api/analytics?**', (route) => route.fulfill({ status: 502, json: { error: 'Adobe returned HTTP 403.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Data connection settings' }).click();
  await page.getByRole('button', { name: 'Use live Analytics' }).click();
  await expect(page.getByRole('alert')).toContainText('Adobe returned HTTP 403.');
  await expect(page.locator('.metric-card')).toHaveCount(0);
  await expect(page.locator('.source-button')).toContainText('Adobe Analytics');
  const report = { ...demoReport(30), source: 'live', suite: 'Test suite' };
  await page.route('**/api/analytics?**', (route) => route.fulfill({ json: report }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.metric-card')).toHaveCount(4);
  await expect(page.locator('.insight-note')).toContainText('published page');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('narrow embedded layout has no horizontal overflow and footer remains visible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/tools/analytics.html');
  await expect(page.locator('.metric-card')).toHaveCount(4);
  await expect(page.locator('.workspace-shell')).toHaveCount(0);
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    panel: document.querySelector('.insights-panel').scrollWidth,
    footerBottom: document.querySelector('.panel-footer').getBoundingClientRect().bottom,
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.width);
  expect(layout.panel).toBeLessThanOrEqual(layout.width);
  expect(layout.footerBottom).toBeLessThanOrEqual(740);
});

test('iframe receives current page context through the real SDK handshake', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'workspace-extension';
    frame.src = '/tools/analytics.html';
    frame.style.cssText = 'position:fixed;inset:0;width:430px;height:100%;z-index:10;background:white;border:0';
    document.body.append(frame);
  });
  const frame = page.frameLocator('#workspace-extension');
  await expect(frame.locator('analytics-app')).toBeVisible();
  // The host sends its context after the iframe SDK has registered its listener.
  await page.waitForFunction(() => {
    const element = document.querySelector('#workspace-extension');
    return element.contentDocument?.querySelector('analytics-app')?.loading;
  });
  await page.evaluate(async () => {
    const frameWindow = document.querySelector('#workspace-extension').contentWindow;
    await import('https://da.live/nx/utils/sdk.js');
    const channel = new MessageChannel();
    frameWindow.postMessage({
      ready: true, context: { org: 'example', repo: 'site', path: '/products/single-origin' },
    }, location.origin, [channel.port2]);
    window.testPort = channel.port1;
  });
  await expect(frame.locator('.metric-card')).toHaveCount(4);
  await expect.poll(() => frame.locator('analytics-app').evaluate((app) => app.page.path)).toBe('/products/single-origin');
});
