import { expect, test } from '@playwright/test';

test('OpenClaw tone snapshot pair is captured', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('https://openclaw.ai', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: testInfo.outputPath('openclaw-home.png'), fullPage: true });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'easy-openclaw' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('easy-openclaw-home.png'), fullPage: true });
});

test('easy-openclaw theme tokens follow OpenClaw palette', async ({ page }) => {
  await page.goto('/');

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bgDeep: style.getPropertyValue('--bg-deep').trim().toLowerCase(),
      coralBright: style.getPropertyValue('--coral-bright').trim().toLowerCase(),
      cyanBright: style.getPropertyValue('--cyan-bright').trim().toLowerCase(),
      displayFont: style.getPropertyValue('--font-display').trim().toLowerCase(),
      bodyFont: style.getPropertyValue('--font-body').trim().toLowerCase(),
    };
  });

  expect(tokens.bgDeep).toBe('#05070c');
  expect(tokens.coralBright).toBe('#ff4d4d');
  expect(tokens.cyanBright).toBe('#00e5cc');
  expect(tokens.displayFont).toContain('clash display');
  expect(tokens.bodyFont).toContain('satoshi');
});
