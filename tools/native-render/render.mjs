// Offline, trusted-operator batch runner. No listener, API keys or media uploads.
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { createReadStream } from 'node:fs';
import { access, link, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, output, ...assets] = process.argv.slice(2);
if (!source || !output || !output.toLowerCase().endsWith('.mp4')) {
  console.error('Usage: npm run render:native -- project.vidlyricsproject output.mp4 [original-song generated-voice.wav image ...]'); process.exit(2);
}
await access(output).then(() => { throw new Error('Output exists; choose a new filename.'); }, e => { if(e.code !== 'ENOENT') throw e; });
if ((await stat(source)).size > 20*1024**2) throw new Error('Project exceeds 20 MiB.');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const hashes=[];
for (const path of assets) {
  const h=createHash('sha256'); for await(const buf of createReadStream(path)) h.update(buf); hashes.push(h.digest('hex'));
}
const built=await build({configFile:false,logLevel:'error',build:{write:false,target:'es2022',minify:true,lib:{entry:fileURLToPath(new URL('../../apps/web/src/media/export/nativeFrames.ts',import.meta.url)),name:'VLFrames',formats:['iife']}}});
const script=(Array.isArray(built)?built[0]:built).output.find(c=>c.type==='chunk').code;
const dir=await mkdtemp(join(dirname(resolve(output)),'.vidlyrics-render-'));
let browser,proc,interrupted=false;
const stop=()=>{interrupted=true; proc?.kill(); void browser?.close();};
process.once('SIGINT',stop); process.once('SIGTERM',stop);
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  const page=await browser.newPage();
  // Playwright fulfills only these exact in-memory routes; no server or outbound requests.
  const origin='https://studio.invalid';
  const supplied=new Map(hashes.map((hash,i)=>[`${origin}/asset/${hash}`,assets[i]]));
  await page.route('**/*', r=>{
    const url=r.request().url(), path=supplied.get(url);
    if (path) return r.fulfill({path});
    if (url===`${origin}/`) return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Render</title>'});
    return r.abort();
  });
  await page.goto(`${origin}/`); await page.addScriptTag({content:script});
  const s=await page.evaluate(async ([text,hashes])=>{
    const blobs=await Promise.all(hashes.map(async hash=>(await fetch(`/asset/${hash}`)).blob()));
    return globalThis.VLFrames.prepare(text,hashes,blobs);
  },[await readFile(source,'utf8'),hashes]);
  const audioPath=join(dir,'track.wav'), result=join(dir,'render.mp4');
  if(s.wavBytes) {
    const f=await open(audioPath,'wx');
    try { for(let offset=0;offset<s.wavBytes;offset+=65536) await f.writeFile(Buffer.from(await page.evaluate(n=>globalThis.VLFrames.audioChunk(n),offset),'base64')); } finally {await f.close();}
  }
  const args=['-hide_banner','-loglevel','error','-nostdin','-f','image2pipe','-framerate',String(s.fps),'-vcodec','png','-i','pipe:0',...(s.wavBytes?['-i',audioPath,'-c:a','aac','-b:a',String(s.audioBitrate)]:[]),'-c:v','libx264','-b:v',String(s.videoBitrate),'-pix_fmt','yuv420p','-movflags','+faststart',result];
  proc=spawn(ffmpeg,args,{stdio:['pipe','ignore','inherit']});
  let failure;
  const done=new Promise(resolve=>{proc.once('error',e=>{failure=e;resolve();});proc.once('close',code=>{if(code!==0)failure??=new Error(`FFmpeg exited ${code}`); resolve();});});
  proc.stdin.on('error',e=>{failure??=e;});
  for(let i=0;i<s.count;i++) {
    if(failure || interrupted) throw failure ?? new Error('Cancelled');
    const bytes=Buffer.from(await page.evaluate(i=>globalThis.VLFrames.frame(i),i),'base64');
    await new Promise((ok,fail)=>proc.stdin.write(bytes,e=>e?fail(e):ok()));
    if(i%s.fps===0) console.error(`Frame ${i+1}/${s.count}`);
  }
  proc.stdin.end(); await done; if(failure || interrupted) throw failure ?? new Error('Cancelled');
  await link(result,resolve(output)); console.log(`Rendered ${s.count} frames to ${output} (${s.wavBytes?'H.264 + AAC':'H.264, silent'}).`);
} finally {proc?.kill(); await browser?.close(); await rm(dir,{recursive:true,force:true});process.off('SIGINT',stop);process.off('SIGTERM',stop);}
