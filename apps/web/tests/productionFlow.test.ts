import { describe, expect, it } from 'vitest';
import { useEditor } from '../src/state/store';
import { createLine, createProject } from '../src/core/project/factory';
import { loadProjectJson } from '../src/core/project/migrate';
import { planShots, applyShots } from '../src/core/director/plan';
import { importLines } from '../src/core/lyrics/importLines';
import { parseLyrics } from '../src/core/lyrics/parse';
import { confirmWord, pendingWords } from '../src/core/timing/review';
import { matchTranscript } from '../src/core/timing/transcriptMatch';
import { voiceoverSourceSignature } from '../src/core/audio/voiceover';
import { toEnhancedLrc } from '../src/core/export/subtitles';

describe('timed media production', () => {
  it('imports repeated LRC cues/word occurrences without showing timestamps as text', () => {
    const input='[offset:20]\n[00:00.22][00:01.22]<00:00.22>Go <00:00.56>go';
    const lines=importLines(parseLyrics(input,'song.lrc'),2e6);
    expect(lines.map(l=>[l.text,l.start,l.end])).toEqual([['Go go',200000,1200000],['Go go',1200000,2000000]]);
    expect(lines.map(l=>l.words.map(w=>w.start))).toEqual([[200000,540000],[1200000,1540000]]);
    const p=createProject();p.lyrics.lines=lines;
    const again=importLines(parseLyrics(toEnhancedLrc(p,{offsetUs:100000}),'again.lrc'),2e6);
    expect(again.map(l=>[l.text,l.start,l.words[1]?.start])).toEqual([['Go go',300000,640000],['Go go',1300000,1640000]]);
  });
  it('preserves explicit SRT ranges, does not destroy a project on malformed import and supports undo',()=>{
    const store=useEditor.getState();store.newProject();store.setLyricsFromText('Before','user');
    expect(store.setLyricsFromText('1\n00:00:01,123 --> 00:00:01,299\nAfter','file','cues.srt')).toBe(true);
    const after=useEditor.getState().project;
    expect(after.lyrics.lines[0]).toMatchObject({text:'After',start:1123000,end:1299000});
    expect(store.setLyricsFromText('garbage','file','bad.vtt')).toBe(false);
    expect(useEditor.getState().project).toBe(after);store.undo();expect(useEditor.getState().project.lyrics.lines[0]?.text).toBe('Before');
  });
  it('matches repeated phrases monotonically while preserving a human anchor',()=>{
    const lines=['go now','hold','go now'].map(s=>createLine(s));lines[1]={...lines[1]!,source:'human',start:2e6,end:3e6};
    const result=matchTranscript(lines,[{text:'Go now',startUs:0,endUs:1e6},{text:'hold',startUs:2e6,endUs:3e6},{text:'go now',startUs:3.2e6,endUs:5e6}]);
    expect(result.size).toBe(2);expect(result.get(lines[2]!.id)?.start).toBe(3.2e6);
    expect(result.has(lines[1]!.id)).toBe(false);
    expect(matchTranscript(lines,[{text:'go now',startUs:2e6,endUs:4e6}]).size).toBe(0);
  });
  it('reviews one occurrence and enforces neighbouring confirmed boundaries',()=>{
    const [line]=importLines(parseLyrics('Echo echo'),4e6); const second=line!.words[1]!;
    const confirmed=confirmWord(line!,second.id,second.start-1000,second.end);
    expect(confirmed.words[0]!.end).toBe(second.start-1000);
    expect(pendingWords([confirmed]).map(w=>w.word.id)).toEqual([line!.words[0]!.id]);
    expect(()=>confirmWord(confirmed,confirmed.words[0]!.id,line!.start,second.end)).toThrow();
  });
  it('plans repeatably and applies styling without rewriting speech, times, images or locked content',()=>{
    const p=createProject();p.lyrics.lines=[createLine('Same',{locked:true,scene:{narration:'Speak this.',background:{kind:'image',assetId:'pic'}}}),createLine('Same')];
    const before=voiceoverSourceSignature(p.lyrics.lines),shots=planShots(p,null,'afterglow',false);
    expect(shots).toEqual(planShots(p,null,'afterglow',false));const next=applyShots(p,shots);
    expect(voiceoverSourceSignature(next.lyrics.lines)).toBe(before);expect(next.lyrics.lines[0]!.scene?.background?.assetId).toBe('pic');expect(next.lyrics.lines[0]!.words).toBe(p.lyrics.lines[0]!.words);
    expect(loadProjectJson(next).project.lyrics.lines[1]?.scene?.background?.kind).toBe('horizon');
    expect(applyShots(p,[shots[1]!]).lyrics.lines[0]).toBe(p.lyrics.lines[0]);
  });
});

import { focusCentre } from '../src/core/audio/vocalFocus';
it('vocal focus preserves centred tones and attenuates a wide tone without changing sample timing',()=>{
  const tone=Float32Array.from({length:16000},(_,i)=>0.4*Math.sin(i*2*Math.PI*330/16000));
  const centred=focusCentre(tone,new Float32Array(tone.length)),wide=focusCentre(tone,tone);
  expect(centred).toHaveLength(tone.length);expect(Math.max(...centred.map((x,i)=>Math.abs(x-tone[i]!)))).toBeLessThan(.0001);
  expect(Math.max(...wide)).toBeLessThan(.08);
});

it('keeps confirmed occurrences fixed across auto-time reruns and restores estimates on undo',()=>{
  const store=useEditor.getState();store.newProject();store.setLyricsFromText('Same again\nSame again\nSame again','user');
  const before=useEditor.getState().project.lyrics.lines;
  const middle=before[1]!,word=middle.words[0]!;
  const anchor=confirmWord(middle,word.id,word.start,word.end-10000);
  store.commit('Confirm',p=>({...p,lyrics:{...p.lyrics,lines:[before[0]!,anchor,before[2]!]}}));
  store.generateTimings();const edited=useEditor.getState().project.lyrics.lines;
  expect(edited[1]).toBe(anchor);expect(edited[0]!.end).toBeLessThanOrEqual(anchor.start);expect(edited[2]!.start).toBeGreaterThanOrEqual(anchor.end);
  store.undo();expect(useEditor.getState().project.lyrics.lines[0]).toBe(before[0]);
});

import { applyPreset, readPresets, savePreset } from '../src/core/design/savedPresets';
it('round-trips resolved user styles without sharing mutations, title, media or layout size',()=>{
  const a=createProject(),b=createProject();a.design.motion.enter='rise';a.design.typography.weight=800;
  const items=savePreset([],' Golden ',a.design);a.design.typography.weight=400;
  expect(()=>savePreset(items,'GOLDEN',a.design)).toThrow();
  const [item]=readPresets(JSON.stringify({version:1,presets:items})); const applied=applyPreset(b.design,item!);
  expect(applied.typography.weight).toBe(800);expect(applied.motion.enter).toBe('rise');expect(applied.background).toBe(b.design.background);
  expect(()=>readPresets('{"version":99,"presets":[]}')).toThrow();
});

import { suggestEnergyMap } from '../src/core/audio/energyMap';
it('separates dynamic changes without inventing a chorus during silence',()=>{
  const env={frameUs:1e6,frameCount:6,bands:Uint8Array.of(0,0,30,30,100,100),bandMeans:new Float32Array(1),fftSize:1024,sampleRate:48000};
  expect(suggestEnergyMap(env,6e6)).toEqual([{start:0,level:'quiet'},{start:2e6,level:'steady'},{start:4e6,level:'lift'}]);
  expect(suggestEnergyMap({...env,bands:new Uint8Array(6)},6e6)).toEqual([{start:0,level:'quiet'}]);
});
