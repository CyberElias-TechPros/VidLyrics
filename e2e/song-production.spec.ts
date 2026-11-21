import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Original two-tone accompaniment; explicit cue annotation, not an ASR accuracy benchmark.
function track() {
  const rate=48000, frames=rate*3, b=Buffer.alloc(44+frames*2);
  b.write('RIFF'); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++) if(i>=rate/4 && i<rate*2.5) b.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*(i<rate*1.4?220:330)*i/rate)),44+i*2);
  return b;
}
test('song → corrected repeated lyric → directed scenes → reopen → narrated-free MP4 with original track', async({page},info)=>{
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  await page.goto('/app');const buffer=track();
  await page.locator('input[type=file][accept^="audio/"]').setInputFiles({name:'melody.wav',mimeType:'audio/wav',buffer});
  await expect(page.getByText('Audio ready',{exact:true})).toBeVisible();
  await page.locator('input[type=file][accept^=".lrc"]').setInputFiles({name:'chorus.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,250 --> 00:00:01,150\nGo again\n\n2\n00:00:01,400 --> 00:00:02,500\nGo again')});
  await button('Review uncertain timings').click();await page.getByLabel('Word end (s)').fill('0.55');await button('Confirm word timing').click();
  await page.getByRole('tab',{name:'design',exact:true}).click();await page.getByLabel('Visual treatment').selectOption('afterglow');await button('Apply scene direction').click();
  await page.getByRole('tab',{name:'export',exact:true}).click();await button('Advanced settings').click();
  await page.getByLabel('Width',{exact:true}).fill('320');await page.getByLabel('Height',{exact:true}).fill('180');await page.getByLabel('Frame rate',{exact:true}).fill('12');await page.getByLabel('Range end (s)').fill('3');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();await page.reload();await button('Projects').click();await page.getByRole('dialog',{name:'Projects'}).getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.getByText('Audio ready',{exact:true})).toBeVisible();await page.getByRole('tab',{name:'export',exact:true}).click();
  const [project]=await Promise.all([page.waitForEvent('download'),button('Export project').click()]);const data=JSON.parse(await readFile((await project.path())!,'utf8'));
  const lines=data.project.lyrics.lines;expect(lines.map((l:{start:number})=>l.start)).toEqual([250000,1400000]);expect(lines[0].words[0]).toMatchObject({end:550000,source:'human'});expect(lines[1].scene.background.kind).toBe('horizon');
  const [video]=await Promise.all([page.waitForEvent('download'),button('Export video').click()]);expect(video.suggestedFilename()).toMatch(/\.mp4$/);
  const player=await page.context().newPage();await player.goto('/');await player.setContent('<input type="file">');await player.locator('input').setInputFiles((await video.path())!);
  const stats=await player.evaluate(async()=>{const ctx=new AudioContext();const audio=await ctx.decodeAudioData(await document.querySelector('input')!.files![0]!.arrayBuffer());const samples=audio.getChannelData(0);const rms=(at:number)=>{const slice=samples.slice(at*audio.sampleRate,(at+0.1)*audio.sampleRate);return Math.sqrt(slice.reduce((sum,v)=>sum+v*v,0)/slice.length);};await ctx.close();return [audio.duration,rms(0),rms(1),rms(2.8)];});
  expect(stats[0]).toBeCloseTo(3,1);expect(stats[1]).toBeLessThan(.01);expect(stats[2]).toBeGreaterThan(.07);expect(stats[3]).toBeLessThan(.01);
  await project.saveAs(info.outputPath('proof.vidlyricsproject'));await (await import('node:fs/promises')).writeFile(info.outputPath('melody.wav'),buffer);
});
