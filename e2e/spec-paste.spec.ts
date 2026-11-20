import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const example = JSON.parse(readFileSync(new URL('../examples/the-sin-cycle.spec.json', import.meta.url), 'utf8'));

test('paste a chat spec, preview it, undo, reopen and recover from a bad paste', async ({ page }) => {
  await page.goto('/app');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const count = page.getByRole('complementary', { name: 'Inspector' }).getByText('13 scenes', { exact: true });
  const draft = page.locator('#lyric-paste');
  await button('Script to video').click();
  const legacy = { ...example, voice: { ...example.voice, voiceId: 'en_US-ryan-medium' } };
  const escaped = JSON.stringify(legacy, null, 2).replace(/[\[\]_]/g, '\\$&');
  await draft.fill('```json\n' + escaped + '\n```');
  await button('Apply video spec').click();
  await expect(count).toBeVisible();
  // Before any play or scrub, the first paused frame must already contain its
  // light title text, not a black canvas cleared by a late resize effect.
  const preview = page.locator('canvas.ed-preview-canvas');
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let light = 0;
    for (let i = 0; i < pixels.length; i += 16) if (pixels[i] > 180 && pixels[i + 1] > 180) light++;
    return light;
  })).toBeGreaterThan(500);
  await expect(page.getByRole('textbox', { name: 'Project title' })).toHaveValue(example.title);
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toHaveValue(legacy.voice.voiceId);
  await button('Undo').click();
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByText('0 scenes', { exact: true })).toBeVisible();
  await button('Redo').click();
  await expect(count).toBeVisible();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await button('Projects').click();
  await page.getByRole('dialog', { name: 'Projects' }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(count).toBeVisible();
  if (!await draft.isVisible()) await button('Paste script / lyrics').click();
  const broken = '{"kind":"vidlyrics.spec","scenes":[';
  await draft.fill(broken);
  await button('Apply & narrate').click();
  await expect(page.getByText('Invalid video spec', { exact: true })).toBeVisible();
  await expect(draft).toHaveValue(broken);
  await expect(count).toBeVisible();
});

test('exports a pasted portrait scene and outro as an MP4 without an audio track', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Script to video' }).click();
  await page.locator('#lyric-paste').fill(JSON.stringify({
    aspect: 'custom', customSize: { width: 320, height: 568 }, fps: 12, codec: 'vp9',
    scenes: [{ layout: 'quote', text: 'A visible quotation.', kicker: 'VERSE', duration: 1 }],
    outro: { title: 'Walk in Grace', subtitle: example.outro.subtitle, duration: 1 }
  }));
  await page.getByRole('button', { name: 'Apply video spec' }).click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export video', exact: true }).click()
  ]);
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);
  const data = readFileSync((await file.path())!);
  expect(data.toString('ascii', 4, 8)).toBe('ftyp');
  expect(data.includes(Buffer.from('mdat'))).toBe(true);
});


test('Code panel retains an unapplied draft when clicking Apply with Live off', async ({ page }) => {
  await page.goto('/app?panel=code');
  await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  const editor = page.getByLabel('Declarative video JSON specification');
  await editor.fill('```json\n' + JSON.stringify(example) + '\n```');
  await page.getByRole('button', { name: 'Apply spec', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Project title' })).toHaveValue(example.title);
});

test('an imported track and its waveform are saved separately and reopen without relinking', async ({ page }) => {
  await page.goto('/app');
  await page.locator('input[type=file][accept^="audio/"]').setInputFiles('apps/web/tests/fixtures/audio/alac24-mono.m4a');
  await expect(page.getByText('Audio ready', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const records = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const req = indexedDB.open('vidlyrics');
    req.onsuccess = () => {
      const db = req.result;
      const read = db.transaction('assets').objectStore('assets').getAllKeys();
      read.onsuccess = () => { resolve(read.result.map(String)); db.close(); };
      read.onerror = () => reject(read.error);
    };
    req.onerror = () => reject(req.error);
  }));
  expect(records.some(id => id.startsWith('aud_'))).toBe(true);
  expect(records.some(id => id.startsWith('pk_'))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('dialog', { name: 'Projects' }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Audio ready', { exact: true })).toBeVisible();
});
