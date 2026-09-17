import type { Line, Microseconds } from '../types';
import { usFromMs } from '../time';
import { graphemes, highlightTokens } from '../lyrics/segment';
import { normalizeForMatch } from '../lyrics/normalize';
import type { ParsedLine } from '../lyrics/parse';

/**
 * Timing distribution.
 *
 * Three situations occur in practice:
 *   1. The file carried per-word timings  -> use them directly.
 *   2. The file carried line timings      -> synthesise word timings inside.
 *   3. The file carried bare text         -> estimate everything from weight.
 *
 * All estimates are marked `source: 'estimate'` with a low confidence so the
 * editor paints them as heat and never presents them as certain.
 */

export interface DistributeOptions {
  /** Silence inserted between lines, microseconds. */
  gapUs?: Microseconds;
  /** Lead-in before the first line, microseconds. */
  leadInUs?: Microseconds;
  /** Total available audio duration; null when unknown. */
  durationUs?: Microseconds | null;
  /** Minimum time a line may occupy, microseconds. */
  minLineUs?: Microseconds;
}

const DEFAULTS = {
  gapUs: usFromMs(250),
  leadInUs: usFromMs(400),
  minLineUs: usFromMs(900)
};

/**
 * Speech-rate weight of a line. Character count alone under-serves long words
 * and over-serves short ones, so blend characters with a syllable estimate.
 */
export function lineWeight(text: string): number {
  const norm = normalizeForMatch(text);
  if (!norm) return 1;
  const chars = graphemes(norm).length;
  const syllables = estimateSyllables(norm);
  return Math.max(1, chars * 0.6 + syllables * 6);
}

/** Rough English-centric syllable estimate; only ever used for weighting. */
export function estimateSyllables(text: string): number {
  const words = normalizeForMatch(text).split(' ').filter(Boolean);
  let total = 0;
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, '');
    if (!clean) {
      total += 1;
      continue;
    }
    const groups = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
    total += Math.max(1, groups?.length ?? 1);
  }
  return Math.max(1, total);
}

/**
 * Estimate line timings from bare text across a known duration.
 * Non-destructive: existing human-set timings are preserved.
 */
export function estimateLineTimings(
  lines: Line[],
  options: DistributeOptions = {}
): Line[] {
  const gapUs = options.gapUs ?? DEFAULTS.gapUs;
  const leadInUs = options.leadInUs ?? DEFAULTS.leadInUs;
  const minLineUs = options.minLineUs ?? DEFAULTS.minLineUs;

  const weights = lines.map((l) => lineWeight(l.text));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const spanStart = leadInUs;
  const spanEnd = options.durationUs ?? lines.length * usFromMs(3000);
  const usable = Math.max(minLineUs, spanEnd - spanStart - gapUs * Math.max(0, lines.length - 1));

  let cursor = spanStart;
  return lines.map((line, i) => {
    if (line.locked || line.source === 'human' || line.source === 'tap') return line;
    const share = Math.max(minLineUs, Math.round((usable * (weights[i] ?? 1)) / totalWeight));
    const start = Math.round(cursor);
    const end = Math.round(start + share);
    cursor = end + gapUs;
    return { ...line, start, end, source: 'estimate' as const, confidence: 0.3, words: interpolateWords(line, start, end) };
  });
}

/**
 * Synthesise per-word timings inside a line by spreading the line duration
 * across word weights. Word boundaries land on grapheme-safe positions so
 * karaoke fill never splits an emoji or a combining mark.
 */
export function interpolateWords(line: Line, start: Microseconds, end: Microseconds): Line['words'] {
  const tokens = highlightTokens(line.text);
  if (tokens.length === 0) return [];
  const duration = Math.max(0, end - start);
  const weights = tokens.map((t) => Math.max(1, graphemes(t.text).length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  let cursor = start;
  return tokens.map((token, i) => {
    const share = Math.round((duration * (weights[i] ?? 1)) / totalWeight);
    const wStart = Math.round(cursor);
    const wEnd = i === tokens.length - 1 ? end : Math.round(cursor + share);
    cursor = wEnd;
    return {
      id: `${line.id}_w${i}`,
      text: token.text.trim(),
      norm: normalizeForMatch(token.text),
      start: wStart,
      end: Math.max(wEnd, wStart),
      confidence: line.confidence ?? 1,
      source: line.source,
      locked: line.locked
    };
  });
}

/** Refresh word timings for lines that already have authoritative line timings. */
export function refreshWordTimings(lines: Line[]): Line[] {
  return lines.map((line) => {
    if (line.words.some((w) => w.source === 'human')) return line;
    return { ...line, words: interpolateWords(line, line.start, line.end) };
  });
}

/**
 * Merge parsed import data into project lines.
 * Existing human timings win; imported data fills everything else.
 */
export function mergeParsedTimings(lines: Line[], parsed: ParsedLine[]): Line[] {
  const bySignature = new Map<string, ParsedLine>();
  for (const p of parsed) {
    if (p.start === null) continue;
    const sig = normalizeForMatch(p.text);
    if (!sig) continue;
    if (!bySignature.has(sig)) bySignature.set(sig, p);
  }

  let cursor = 0;
  return lines.map((line, index) => {
    if (line.source === 'human' || line.source === 'tap' || line.locked) {
      cursor = line.end;
      return line;
    }
    const sig = normalizeForMatch(line.text);
    const match = bySignature.get(sig);
    if (match && match.start !== null) {
      const start = match.start;
      const end = match.end ?? start + usFromMs(2000);
      cursor = end;
      return {
        ...line,
        start,
        end,
        source: 'align' as const,
        confidence: 0.8,
        words: mergeWordTimings(line, match, start, end)
      };
    }
    // No textual match: slot it after the previous line rather than at zero,
    // which would stack every unmatched line on top of the first second.
    const fallbackStart = Math.max(cursor, index === 0 ? 0 : cursor);
    cursor = fallbackStart;
    return line;
  });
}

function mergeWordTimings(line: Line, parsed: ParsedLine, start: Microseconds, end: Microseconds): Line['words'] {
  if (parsed.words.length === 0) return interpolateWords(line, start, end);
  const tokens = highlightTokens(line.text);
  const byText = new Map<string, number>();
  parsed.words.forEach((w, i) => {
    const key = normalizeForMatch(w.text);
    if (key && !byText.has(key)) byText.set(key, i);
  });

  const assigned = new Map<number, Microseconds[]>();
  tokens.forEach((token, tokenIndex) => {
    const idx = byText.get(normalizeForMatch(token.text));
    const w = idx !== undefined ? parsed.words[idx] : undefined;
    if (w) assigned.set(tokenIndex, [w.start, Math.max(w.end, w.start)]);
  });

  if (assigned.size === 0) return interpolateWords(line, start, end);

  let cursor = start;
  return tokens.map((token, i) => {
    const range = assigned.get(i);
    const wStart = range?.[0] ?? Math.max(start, cursor);
    const wEnd = range?.[1] ?? Math.max(wStart, start);
    cursor = wEnd;
    return {
      id: `${line.id}_w${i}`,
      text: token.text.trim(),
      norm: normalizeForMatch(token.text),
      start: wStart,
      end: wEnd,
      confidence: range ? 0.85 : 0.4,
      source: range ? ('align' as const) : ('estimate' as const),
      locked: line.locked
    };
  });
}
