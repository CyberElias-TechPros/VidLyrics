/** Headless adapter for tools/native-render. Not imported into the studio bundle. */
import { loadProjectJson } from '../../core/project/migrate';
import { compileVideoSpec } from '../../core/spec/compiler';
import { isVideoSpecJson, parseVideoSpecJson } from '../../core/spec/schema';
import { buildScene, totalDuration } from '../../core/render/scene';
import { renderFrame } from '../../core/render/frame';
import { createMeasureFn } from '../canvasMeasurer';
import { computeSpectrum } from '../../core/audio/spectrum';
import { detectBeatGrid } from '../../core/audio/beats';
import { mixVoiceover, voiceoverSourceSignature } from '../../core/audio/voiceover';
import { decodeWav } from '../../core/audio/wav';
import { frameToUs } from '../../core/time';
import { encodeWav } from './encoder';

let paint: ((i: number) => string) | null = null;
let wav: Blob | null = null;

export async function prepare(source: string, hashes: string[], files: Blob[]) {
  const raw = JSON.parse(source);
  const spec = isVideoSpecJson(source) ? parseVideoSpecJson(source) : null;
  if (spec && !spec.spec) throw new Error(spec.issues.map(v => v.message).join('; '));
  const p = spec?.spec ? compileVideoSpec(spec.spec) : loadProjectJson(raw).project;
  if (!p.lyrics.lines.length) throw new Error('Add at least one scene before rendering.');
  const file = (hash: string | undefined, role: string) => {
    const f = hash && files[hashes.indexOf(hash)];
    if (!f) throw new Error(`Missing matching ${role}. Pass the original asset file after the output path.`);
    return f;
  };
  const images = new Map<string, CanvasImageSource>();
  const imageIds = new Set([p.design.background.assetId, p.design.brand.logoAssetId, ...p.lyrics.lines.map(l => l.scene?.background?.assetId)]);
  for (const id of imageIds) if (id) {
    const record = Array.isArray(raw.assets) && raw.assets.find((r: {id?: string}) => r?.id === id);
    images.set(id, await createImageBitmap(file(record?.contentHash, `image ${id}`)));
  }
  const sceneBase = buildScene(p);
  const start = p.export.rangeStartUs, end = p.export.rangeEndUs > start ? p.export.rangeEndUs : totalDuration(sceneBase);
  const { fps, width, height, videoBitrate, audioBitrate } = p.export;
  const count = Math.max(1, Math.round((end-start)*fps/1e6));
  if (end <= start || end-start > 3600e6 || width % 2 || height % 2) throw new Error('Use even output dimensions and an export range of up to one hour.');
  const rate = p.audio?.sampleRate ?? 48000;
  const song = p.audio ? await new OfflineAudioContext(1,1,rate).decodeAudioData(await file(p.audio.contentHash,'song').arrayBuffer()) : null;
  const channels = song?.numberOfChannels ?? 1;
  if (p.export.includeAudio && (p.audio || p.voiceover?.enabled) && (end-start)/1e6 * rate * channels > 64_000_000) throw new Error('Audio exceeds this runner’s mix buffer. Render a shorter range.');
  const voice = p.export.includeAudio && p.voiceover?.enabled ? p.voiceover : null;
  if (voice && voice.sourceSignature !== voiceoverSourceSignature(p.lyrics.lines,{voiceIdB:voice.voiceIdB})) throw new Error('Narration is stale. Regenerate it and export the project again.');
  const speech = voice ? decodeWav(await file(voice.contentHash,'generated WAV').arrayBuffer()) : null;
  const mono = song ? new Float32Array(song.length) : speech?.samples;
  const music = song && p.export.includeAudio ? new Float32Array(song.length*channels) : new Float32Array();
  if (song && mono) for (let c=0;c<channels;c++) {
    const samples=song.getChannelData(c);
    for(let i=0;i<samples.length;i++){ mono[i]! += samples[i]!/channels; if(music.length) music[i*channels+c]=samples[i]!; }
  }
  const spectrum = mono ? await computeSpectrum(mono, song?.sampleRate ?? speech!.sampleRate) : null;
  const scene = buildScene(p,{spectrum, beatGrid: spectrum && song ? detectBeatGrid(spectrum) : null, assets:{images}});
  wav = null;
  if (p.export.includeAudio && (song || speech)) {
    const mixed = mixVoiceover({music, musicSampleRate:rate,channels,voice:speech?.samples ?? new Float32Array(), voiceSampleRate:speech?.sampleRate ?? rate,
      voiceTimelineOffsetUs:scene.introUs + p.export.globalOffsetUs, musicGain:voice?.musicGain ?? 1,voiceGain:voice?.speechGain ?? 1,
      rangeStartUs:start,rangeEndUs:end,extendToRangeEnd:true});
    wav = encodeWav(mixed,rate,channels);
  }
  const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false})!;
  const fit=Math.min(width/scene.width,height/scene.height);
  ctx.setTransform(fit,0,0,fit,(width-scene.width*fit)/2,(height-scene.height*fit)/2);
  await document.fonts.ready;
  const measure=createMeasureFn(scene.design.typography.fontStack);
  paint = i => { renderFrame(ctx,scene,start+frameToUs(i,fps),{measure, showHeat:false,showGuides:false}); return canvas.toDataURL('image/png').split(',')[1]!; };
  return {count,fps,videoBitrate,audioBitrate,wavBytes:wav?.size ?? 0};
}
export function frame(i:number) { return paint!(i); }
export async function audioChunk(offset:number) {
  const bytes=new Uint8Array(await wav!.slice(offset,offset+65536).arrayBuffer());
  return btoa(String.fromCharCode(...bytes));
}
