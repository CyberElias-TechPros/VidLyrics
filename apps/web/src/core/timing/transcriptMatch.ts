import type { Line } from '../types';
import type { TranscriptCue } from '../lyrics/transcript';
import { normalizeForMatch } from '../lyrics/normalize';
import { interpolateWords } from './distribute';

/** Ordered phrase matching within Whisper segments, not acoustic forced alignment.
 * Repeated phrases consume different occurrences. Keep uncertain/conflicting lines unchanged. */
export function matchTranscript(lines: Line[], cues: TranscriptCue[]): Map<string, Line> {
  const tokens = cues.flatMap(cue => {
    const text = normalizeForMatch(cue.text);
    if (!text || cue.endUs <= cue.startUs) return [];
    const words = text.split(' '), span = cue.endUs - cue.startUs;
    return words.map((word,i) => ({ word, start: cue.startUs + Math.round(i * span / words.length), end: cue.startUs + Math.round((i+1)*span / words.length) }));
  });
  const positions = new Map<string,number[]>();
  tokens.forEach((t,i) => { const list = positions.get(t.word); if (list) list.push(i); else positions.set(t.word,[i]); });
  const patches = new Map<string,Line>();
  let cursor = 0;
  for (const line of lines) {
    const parts = normalizeForMatch(line.text).split(' ');
    const indices = positions.get(parts[0]!);
    if (!indices) continue;
    // Binary search avoids scanning repeated refrains already consumed.
    let lo = 0, hi = indices.length;
    while (lo < hi) { const mid = (lo+hi) >>> 1; if (indices[mid]! < cursor) lo = mid+1; else hi = mid; }
    const index = indices.slice(lo,lo+48).find(i => parts.every((t,n) => tokens[i+n]?.word === t));
    if (index === undefined) continue;
    cursor = index + parts.length;
    if (line.locked || ['human','tap','tts'].includes(line.source) || line.words.some(w => w.locked || w.source === 'human')) continue;
    const start = tokens[index]!.start, end = tokens[cursor-1]!.end;
    if (end <= start) continue;
    const updated: Line = { ...line, start, end, source:'align', confidence:0.65 };
    updated.words = interpolateWords(updated,start,end);
    patches.set(line.id,updated);
  }
  // Preserve authored order against unchanged anchors. Reject an entire run if
  // it crosses an anchor rather than silently moving any unmatched line.
  for (let i = 0; i < lines.length;) {
    if (!patches.has(lines[i]!.id)) { i++; continue; }
    let j = i+1;
    while (j < lines.length && patches.has(lines[j]!.id)) j++;
    let bound = lines[i-1]?.end ?? 0, conflict = false;
    for (let k=i; k<j; k++) { const p=patches.get(lines[k]!.id)!; if (p.start < bound) conflict=true; bound=p.end; }
    if (conflict || bound > (lines[j]?.start ?? Infinity)) for (let k=i;k<j;k++) patches.delete(lines[k]!.id);
    i = j;
  }
  return patches;
}
