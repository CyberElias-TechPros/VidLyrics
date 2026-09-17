import type { Line, Microseconds } from '../types';
import { usFromMs } from '../time';
import { interpolateWords, refreshWordTimings } from './distribute';

/**
 * Timing post-processing.
 *
 * Runs after import, after tap-sync and after machine alignment. Every pass is
 * idempotent and never touches a line the user locked.
 *
 * Invariant maintained by `enforceOrdering`: for sorted lines,
 *   line[i].start <= line[i].end  and  line[i].end <= line[i+1].start
 * unless the project intentionally uses cross-fade overlap, which the motion
 * spec handles at render time rather than in stored data.
 */

export interface PostProcessOptions {
  minLineUs?: Microseconds;
  /**
   * Lead-in is an AUTHORING transform, not a normalising one: it converts
   * "when it is sung" into "when it is displayed". Applying it twice pulls every
   * line 300 ms earlier again, so it is opt-in and the editor invokes it exactly
   * once when timings are generated. `postProcess` stays idempotent without it.
   */
  applyLeadIn?: boolean;
  leadInUs?: Microseconds;
  /** Extend a line's end into a short silence so the screen never blanks. */
  gapFillUs?: Microseconds;
  durationUs?: Microseconds | null;
  beatGrid?: Microseconds[];
  beatToleranceUs?: Microseconds;
}

export const DEFAULT_POSTPROCESS: Required<Omit<PostProcessOptions, 'durationUs' | 'beatGrid'>> = {
  minLineUs: usFromMs(600),
  applyLeadIn: false,
  leadInUs: usFromMs(300),
  gapFillUs: usFromMs(400),
  beatToleranceUs: usFromMs(90)
};

export function byStart(a: Line, b: Line): number {
  return a.start - b.start;
}

/** Sort a copy, resolving ties by id so ordering is deterministic. */
export function sortLines(lines: Line[]): Line[] {
  return [...lines].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** Clamp every timestamp into [0, duration] and guarantee start <= end. */
export function clampTimings(lines: Line[], durationUs: Microseconds | null): Line[] {
  return lines.map((line) => {
    const start = Math.max(0, Math.round(line.start));
    const end = Math.max(start, Math.round(durationUs === null ? line.end : Math.min(line.end, durationUs)));
    if (start === line.start && end === line.end) return line;
    return { ...line, start, end, words: clampWords(line, start, end) };
  });
}

function clampWords(line: Line, start: Microseconds, end: Microseconds): Line['words'] {
  return line.words.map((w) => {
    const ws = Math.min(Math.max(w.start, start), end);
    const we = Math.min(Math.max(w.end, ws), end);
    if (ws === w.start && we === w.end) return w;
    return { ...w, start: ws, end: we };
  });
}

/** Every line gets at least `minLineUs` on screen; a flash is unreadable. */
export function enforceMinimumDuration(lines: Line[], minLineUs: Microseconds): Line[] {
  return lines.map((line) => {
    if (line.end - line.start >= minLineUs) return line;
    const end = line.start + minLineUs;
    return {
      ...line,
      end,
      words: line.words.length > 0 ? stretchWords(line, line.start, end) : line.words
    };
  });
}

function stretchWords(line: Line, start: Microseconds, end: Microseconds): Line['words'] {
  const first = line.words[0];
  const last = line.words[line.words.length - 1];
  if (!first || !last) return line.words;
  const oldSpan = Math.max(1, last.end - first.start);
  const newSpan = Math.max(1, end - start);
  const scale = newSpan / oldSpan;
  return line.words.map((w) => ({
    ...w,
    start: Math.round(start + (w.start - first.start) * scale),
    end: Math.round(start + (w.end - first.start) * scale)
  }));
}

/**
 * Pull each line's start slightly earlier so text appears before it is sung.
 *
 * NOT idempotent — it converts sung-time into display-time, so calling it twice
 * pulls everything earlier twice. The editor calls it once, when timings are
 * generated. That is why `postProcess` gates it behind an explicit option.
 */
export function applyLeadIn(lines: Line[], leadInUs: Microseconds): Line[] {
  let previousEnd = 0;
  return lines.map((line) => {
    if (line.locked) {
      previousEnd = line.end;
      return line;
    }
    const start = Math.max(previousEnd, line.start - leadInUs);
    previousEnd = line.end;
    if (start === line.start) return line;
    return { ...line, start, words: shiftWords(line, start - line.start) };
  });
}

function shiftWords(line: Line, deltaUs: Microseconds): Line['words'] {
  return line.words.map((w) => ({
    ...w,
    start: Math.max(0, w.start + deltaUs),
    end: Math.max(0, w.end + deltaUs)
  }));
}

/**
 * Close small silences between lines by extending the earlier line's end.
 * Long silences are preserved — blank space during an instrumental is correct.
 */
export function fillGaps(lines: Line[], gapFillUs: Microseconds): Line[] {
  const sorted = sortLines(lines);
  const nextStartById = new Map<string, Microseconds>();
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current && next) nextStartById.set(current.id, next.start);
  }
  return lines.map((line) => {
    const nextStart = nextStartById.get(line.id);
    if (nextStart === undefined || line.locked) return line;
    const gap = nextStart - line.end;
    if (gap <= 0 || gap > gapFillUs) return line;
    return { ...line, end: nextStart };
  });
}

/** Snap word starts to the nearest detected beat when it is close enough. */
export function snapToBeatGrid(lines: Line[], beatGrid: Microseconds[], toleranceUs: Microseconds): Line[] {
  if (beatGrid.length === 0) return lines;
  const snap = (t: Microseconds): Microseconds => {
    let best = t;
    let bestDelta = Infinity;
    // Beat grids are sorted and dense; a bounded scan is enough.
    for (const beat of beatGrid) {
      const delta = Math.abs(beat - t);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = beat;
      }
      if (beat > t + toleranceUs) break;
    }
    return bestDelta <= toleranceUs ? best : t;
  };

  return lines.map((line) => {
    if (line.locked || line.words.length === 0) return line;
    let changed = false;
    const words = line.words.map((w) => {
      const start = snap(w.start);
      if (start === w.start) return w;
      changed = true;
      return { ...w, start };
    });
    if (!changed) return line;
    return { ...line, words: repairWordOrder(words) };
  });
}

/** Snapping can invert word order on dense grids; repair rather than reject. */
function repairWordOrder(words: Line['words']): Line['words'] {
  let prevEnd = -1;
  return words.map((w) => {
    const start = Math.max(w.start, prevEnd);
    const end = Math.max(w.end, start);
    prevEnd = end;
    return start === w.start && end === w.end ? w : { ...w, start, end };
  });
}

/** Resolve overlaps so two lines are never on screen fighting for the same slot. */
export function resolveOverlaps(lines: Line[], durationUs: Microseconds | null): Line[] {
  const sorted = sortLines(lines);
  const trimmed = new Map<string, Line>();
  let previousEnd = 0;

  for (const line of sorted) {
    if (line.start < previousEnd) {
      const start = Math.min(previousEnd, line.end);
      trimmed.set(line.id, { ...line, start, words: shiftWords(line, start - line.start) });
    } else {
      trimmed.set(line.id, line);
    }
    previousEnd = Math.max(previousEnd, trimmed.get(line.id)?.end ?? line.end);
  }

  return clampTimings(
    lines.map((l) => trimmed.get(l.id) ?? l),
    durationUs
  );
}

/**
 * Find silences long enough to be instrumentals. Returned ranges are used to
 * suppress lyric display and to drive scene changes.
 */
export interface InstrumentalRegion {
  start: Microseconds;
  end: Microseconds;
}

export function detectInstrumentalRegions(
  lines: Line[],
  durationUs: Microseconds,
  minLengthUs: Microseconds = usFromMs(2500)
): InstrumentalRegion[] {
  if (durationUs <= 0) return [];
  const sorted = sortLines(lines).filter((l) => l.end > l.start);
  const regions: InstrumentalRegion[] = [];
  let cursor = 0;
  for (const line of sorted) {
    if (line.start - cursor >= minLengthUs) regions.push({ start: cursor, end: line.start });
    cursor = Math.max(cursor, line.end);
  }
  if (durationUs - cursor >= minLengthUs) regions.push({ start: cursor, end: durationUs });
  return regions;
}

/** Full post-processing pass, in the order the passes depend on each other. */
export function postProcess(lines: Line[], options: PostProcessOptions = {}): Line[] {
  const minLineUs = options.minLineUs ?? DEFAULT_POSTPROCESS.minLineUs;
  const leadInUs = options.leadInUs ?? DEFAULT_POSTPROCESS.leadInUs;
  const gapFillUs = options.gapFillUs ?? DEFAULT_POSTPROCESS.gapFillUs;
  const tolerance = options.beatToleranceUs ?? DEFAULT_POSTPROCESS.beatToleranceUs;
  const wantsLeadIn = options.applyLeadIn ?? DEFAULT_POSTPROCESS.applyLeadIn;

  let result = sortLines(lines);
  result = clampTimings(result, options.durationUs ?? null);
  result = enforceMinimumDuration(result, minLineUs);
  result = resolveOverlaps(result, options.durationUs ?? null);
  if (wantsLeadIn) result = applyLeadIn(result, leadInUs);
  result = fillGaps(result, gapFillUs);
  if (options.beatGrid && options.beatGrid.length > 0) {
    result = snapToBeatGrid(result, options.beatGrid, tolerance);
  }
  result = resolveOverlaps(result, options.durationUs ?? null);
  return refreshWordTimings(result);
}

/** Rebuild word timings after the user edits a line's text. */
export function rebuildWordsForLine(line: Line, newText: string): Line {
  const next: Line = { ...line, text: newText, words: [] };
  return { ...next, words: interpolateWords(next, next.start, next.end) };
}
