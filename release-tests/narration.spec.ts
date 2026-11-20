import { expect, test } from '@playwright/test';

test('default Norman synthesis survives reopen and is audible inside the exported MP4', async ({ page }) => {
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const ready = page.getByRole('heading', { name: 'Voiceover ready' });
  await page.goto('/app');
  await button('Script to video').click();
  await page.locator('#lyric-paste').fill(JSON.stringify({
    title: 'Narration release check', aspect: 'custom', customSize: { width: 320, height: 568 },
    fps: 12,
    scenes: [
      { text: 'The turning point', narration: 'The verdict does not have to define you.' },
      { layout: 'quote', kicker: 'YOUR NEXT STEP', text: 'Walk in grace.', narration: 'Take the next faithful step.' }
    ], outro: { title: 'Walk in Grace', subtitle: 'Thanks for watching.', duration: 2.5 }
  }));
  await button('Apply & narrate').click();
  // Surface model/storage errors immediately instead of waiting out a timeout.
  await expect(ready.or(page.locator('.ed-generation-error')).first()).toBeVisible({ timeout: 120_000 });
  await expect(ready).toBeVisible();
  await expect(page.getByText(/Generated with en_US-norman-medium/)).toBeVisible();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await button('Projects').click();
  await page.getByRole('dialog', { name: 'Projects' }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(ready).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), button('Export video').click()]);
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);

  // Decode the actual download in a browser, independently of editor state.
  const player = await page.context().newPage();
  await player.goto('/');
  await player.setContent('<input type="file"/><video muted></video>');
  await player.locator('input').setInputFiles((await file.path())!);
  const stats = await player.evaluate(async () => {
    const file = document.querySelector('input')!.files![0]!;
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const pcm = audio.getChannelData(0);
    let peak = 0;
    for (const s of pcm) peak = Math.max(peak, Math.abs(s));
    await ctx.close();
    const video = document.querySelector('video')!;
    const url = URL.createObjectURL(file);
    try {
      const loaded = new Promise<void>((ok, fail) => { video.onloadedmetadata = () => ok(); video.onerror = fail; });
      video.src = url;
      await loaded;
      const seeked = new Promise<void>(ok => { video.onseeked = () => ok(); });
      video.currentTime = video.duration - 1.25;
      await seeked;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const draw = canvas.getContext('2d')!;
      draw.drawImage(video, 0, 0);
      const { data } = draw.getImageData(0, 0, canvas.width, canvas.height);
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] > 170) bright++;
      return { peak, bright, audioDuration: audio.duration, videoDuration: video.duration };
    } finally { URL.revokeObjectURL(url); }
  });
  expect(stats.peak).toBeGreaterThan(0.02);
  expect(stats.videoDuration).toBeGreaterThan(3);
  expect(Math.abs(stats.audioDuration - stats.videoDuration)).toBeLessThan(0.15);
  expect(stats.bright).toBeGreaterThan(100);
});

test('build and narrate generates speech directly from a plain script', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Script to video', exact: true }).click();
  await page.locator('#lyric-paste').fill('One voice and no microphone. Each scene gets its own timing.');
  await page.getByRole('button', { name: 'Build & narrate', exact: true }).click();
  const ready = page.getByRole('heading', { name: 'Voiceover ready' });
  await expect(ready.or(page.locator('.ed-generation-error')).first()).toBeVisible({ timeout: 120_000 });
  await expect(ready).toBeVisible();
  await expect(page.getByText(/Generated with en_US-norman-medium/)).toBeVisible();
});
