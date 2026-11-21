import { createLine } from '../project/factory';
import { interpolateWords, estimateLineTimings } from '../timing/distribute';
import { postProcess } from '../timing/postprocess';
import { normalizeForMatch } from './normalize';
import type { ParsedLyrics } from './parse';

/** Explicit cues are data, not strings to send back through a plain-text estimator. */
export function importLines(parsed: ParsedLyrics, durationUs: number | null) {
  const lines = parsed.lines.map(c => createLine(c.text));
  const estimates = estimateLineTimings(lines, { durationUs });
  if (!parsed.lines.some(c => c.start !== null)) return postProcess(estimates, { durationUs, applyLeadIn: true });
  const offset = parsed.meta.offsetUs ?? 0;
  const at = (t: number) => Math.max(0, Math.round(t + offset));
  return lines.map((line, i) => {
    const cue = parsed.lines[i]!;
    if (cue.start === null) return estimates[i]!;
    const start = at(cue.start);
    const last = cue.words.at(-1);
    const next = parsed.lines[i+1]?.start;
    const inferredEnd = next != null && next > cue.start ? at(next) : Math.max(start + 2e6, last ? at(last.end) : 0);
    const end = Math.max(start, cue.end != null ? at(cue.end) : durationUs != null ? Math.min(durationUs,inferredEnd) : inferredEnd);
    const words = cue.words.length ? cue.words.map((w,j) => {
      const ws = Math.min(end, Math.max(start, at(w.start)));
      const we = w.end > w.start ? at(w.end) : cue.words[j+1] ? at(cue.words[j+1]!.start) : end;
      return { id: `${line.id}_w${j}`, text: w.text, norm: normalizeForMatch(w.text), start: ws, end: Math.min(end, Math.max(ws,we)), source: 'human' as const, confidence: 1, locked: false };
    }) : interpolateWords({ ...line, confidence: 0.45 }, start, end);
    return { ...line, start, end, words, source: 'human' as const, confidence: 1 };
  });
}
