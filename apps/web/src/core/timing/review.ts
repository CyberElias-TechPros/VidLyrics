import type { Line } from '../types';

export function pendingWords(lines: Line[]) {
  return lines.filter(line => !line.locked).flatMap(line => line.words.filter(word =>
    !word.locked && word.source !== 'human' && (word.source === 'estimate' || word.confidence < 0.75)
  ).map(word => ({ line, word }))).sort((a,b) => a.word.start - b.word.start);
}

/** Move shared edges only when necessary. Confirmed neighbouring words are anchors. */
export function confirmWord(line: Line, id: string, start: number, end: number): Line {
  const i = line.words.findIndex(w => w.id === id);
  const word = line.words[i], prev = line.words[i-1], next = line.words[i+1];
  const fixed = (w: typeof word) => w?.locked || w?.source === 'human';
  const min = prev ? (fixed(prev) ? prev.end : prev.start + 1) : line.start;
  const max = next ? (fixed(next) ? next.start : next.end - 1) : line.end;
  if (!word || line.locked || word.locked || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < Math.max(line.start,min) || end > Math.min(line.end,max) || end <= start) {
    throw new Error('Keep the word inside this line, in order, and clear of confirmed neighbours.');
  }
  return { ...line, words: line.words.map((w,n) => n === i ? { ...w, start, end, source: 'human', confidence: 1 } :
    n === i-1 && w.end > start ? { ...w, end: start } : n === i+1 && w.start < end ? { ...w, start: end } : w) };
}
