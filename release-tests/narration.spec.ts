import { expect, test } from '@playwright/test';

test('default Norman and LJSpeech dialogue survives reopen and is audible inside the exported MP4', async ({ page }, info) => {
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const ready = page.getByRole('heading', { name: 'Voiceover ready' });
  await page.goto('/app');
  await button('Script to video').click();
  await page.locator('#lyric-paste').fill(JSON.stringify({
    title: 'Narration release check', aspect: 'custom', customSize: { width: 320, height: 568 },
    fps: 12,
    scenes: [
      { text: 'The turning point', narration: 'The verdict does not have to define you.' },
      { speaker: 'B', layout: 'quote', kicker: 'YOUR NEXT STEP', text: 'Walk in grace.', narration: 'Take the next faithful step.' }
    ], outro: { title: 'Walk in Grace', subtitle: 'Thanks for watching.', duration: 2.5 }
  }));
  await button('Apply & narrate').click();
  // Surface model/storage errors immediately instead of waiting out a timeout.
  await expect(ready.or(page.locator('.ed-generation-error')).first()).toBeVisible({ timeout: 120_000 });
  await expect(ready).toBeVisible();
  await expect(page.getByText(/Generated with en_US-norman-medium \+ en_US-ljspeech-medium/)).toBeVisible();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await button('Projects').click();
  await page.getByRole('dialog', { name: 'Projects' }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(ready).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), button('Export video').click()]);
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);

  const [wav] = await Promise.all([page.waitForEvent('download'), button('Download WAV').click()]);
  await page.getByRole('tab',{name:'export',exact:true}).click();
  const [project] = await Promise.all([page.waitForEvent('download'), button('Export project').click()]);
  await wav.saveAs(info.outputPath('narration.wav'));
  await project.saveAs(info.outputPath('narration.vidlyricsproject'));
  // A restored WAV must have the exact content hash referenced by the project.
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  expect(createHash('sha256').update(await readFile(info.outputPath('narration.wav'))).digest('hex')).toBe(JSON.parse(await readFile(info.outputPath('narration.vidlyricsproject'),'utf8')).project.voiceover.contentHash);

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

test('real local speech can be transcribed into editable subtitle cues', async ({page, context}) => {
  await page.goto('/app');
  await page.getByRole('button',{name:'Script to video',exact:true}).click();
  await page.locator('#lyric-paste').fill('Welcome to the studio. Today we are making a video about music.');
  await page.getByRole('button',{name:'Build & narrate',exact:true}).click();
  const download=page.getByRole('button',{name:'Download WAV'});
  await expect(download).toBeEnabled({timeout:120000});
  const [wav]=await Promise.all([page.waitForEvent('download'),download.click()]);
  const song=await context.newPage();await song.goto('/app');
  await song.locator('input[type=file][accept^="audio/"]').setInputFiles({name:'spoken-word.wav',mimeType:'audio/wav',buffer:await (await import('node:fs/promises')).readFile((await wav.path())!)});
  await expect(song.getByText('Audio ready',{exact:true})).toBeVisible();
  await song.getByRole('button',{name:'Transcribe audio',exact:true}).click();
  const accept=song.getByRole('button',{name:'Use generated subtitles'});
  await expect(accept.or(song.locator('.ed-generation-error')).first()).toBeVisible({timeout:120000});
  await expect(song.locator('.ed-generated-lines').filter({hasText:/studio|music|video/i})).toBeVisible();
  await accept.click();await expect(song.getByRole('button',{name:'Review uncertain timings'})).toBeEnabled();
  await song.getByRole('button',{name:'Undo',exact:true}).click();
  await song.getByRole('button',{name:'Create lyric video draft'}).click();
  await expect(song.getByRole('button',{name:'Review uncertain timings'})).toBeEnabled({timeout:120000});
  await song.getByRole('tab',{name:'export',exact:true}).click();
  const [draft] = await Promise.all([song.waitForEvent('download'),song.getByRole('button',{name:'Export project',exact:true}).click()]);
  const json=JSON.parse(await (await import('node:fs/promises')).readFile((await draft.path())!,'utf8'));
  expect(json.project.lyrics.lines.some((l:{text:string})=>/studio|music|video/i.test(l.text))).toBe(true);
  expect(json.project.lyrics.lines[0].scene.background.kind).toBe('horizon');
});

// Keep the visible failure stage in CI annotations even when runner log archives expire.
test.afterEach(async ({context}, info) => {
  if (info.status === info.expectedStatus) return;
  const states = await Promise.all(context.pages().map(p => p.locator('.ed-generation-error, [role="status"], .ed-banner h3').allTextContents().catch(()=>[])));
  const diagnostic = `${info.title}: ${info.error?.message ?? info.status} Visible states: ${states.flat().join('; ')}`;
  console.error(`::error title=Speech release check::${diagnostic.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A')}`);
});
