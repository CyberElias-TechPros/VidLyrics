import type { Line } from '../types';
import { interpolateWords, lineWeight } from './distribute';

export function isTimingAnchor(line: Line): boolean {
  return line.locked || ['human', 'tap', 'tts'].includes(line.source) || line.words.some(w => w.locked || w.source === 'human');
}

/** Fit only the unconfirmed runs between anchors. Never normalize, sort, or
 * shift a confirmed occurrence as a side effect of estimating another line. */
export function estimateAroundAnchors(lines: Line[], duration: number): Line[] {
  const result = lines.slice();
  for (let first = 0; first < lines.length;) {
    if (isTimingAnchor(lines[first]!)) { first++; continue; }
    let last = first + 1;
    while (last < lines.length && !isTimingAnchor(lines[last]!)) last++;
    const start = lines[first - 1]?.end ?? 0;
    const end = Math.min(duration, lines[last]?.start ?? duration);
    if (end > start) {
      const weights = lines.slice(first, last).map(l => lineWeight(l.text));
      const sum = weights.reduce((a,b) => a + b, 0);
      let used = 0, at = start;
      weights.forEach((weight,i) => {
        used += weight;
        const until = start + Math.round((end - start) * used / sum);
        const line: Line = { ...lines[first + i]!, start: at, end: until, source: 'estimate', confidence: 0.3 };
        result[first + i] = { ...line, words: interpolateWords(line, at, until) };
        at = until;
      });
    }
    first = last;
  }
  return result;
}
