import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });
    test('moves between complete workspaces without losing a draft', async ({ page }) => {
      await page.goto('/app');
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      const panel = page.getByLabel('Inspector');
      await expect(panel).toBeHidden();
      for (const path of ['Script to video', 'Song to lyric video', 'Video as code']) await expect(button(path)).toBeVisible();
      await button('Script to video').tap();
      await expect(panel).toBeVisible();
      await expect(page.getByRole('main')).toBeHidden();
      const draft = page.locator('#lyric-paste');
      await draft.fill('One scene. Another scene.');
      await button('Preview & timeline').tap();
      await button('Edit project').tap();
      await expect(draft).toHaveValue('One scene. Another scene.');
      await button('Build scenes').tap();
      for (const name of ['design', 'code', 'export']) {
        await page.getByRole('tab', { name, exact: true }).tap();
        const sizes = await panel.locator('.ed-panel-body').evaluate(el => [el.scrollWidth, el.clientWidth]);
        expect(sizes[0]).toBeLessThanOrEqual(sizes[1] + 1);
      }
      await button('Preview & timeline').tap();
      await expect(page.getByRole('group', { name: 'Timeline' })).toBeVisible();
      await button('Actions').tap();
      await button('Projects').tap();
      await expect(page.getByRole('dialog', { name: 'Projects' })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(button('Actions')).toHaveAttribute('aria-expanded', 'false');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    });
  });
}

test.describe('phone creation paths', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  test('song starts from a touch file picker without entering script mode', async ({ page }) => {
    await page.goto('/app');
    const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Song to lyric video' }).tap()]);
    await picker.setFiles('apps/web/tests/fixtures/audio/alac24-mono.m4a');
    await expect(page.getByText('Audio ready', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Timeline' })).toBeVisible();
  });
  test('code starts with editable template scenes and needs no audio', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Video as code', exact: true }).tap();
    await expect(page.getByLabel('Declarative video JSON specification')).toBeVisible();
    await page.getByRole('button', { name: 'Preview & timeline' }).tap();
    await expect(page.getByRole('img', { name: /Composition preview/ })).toBeVisible();
  });
});
