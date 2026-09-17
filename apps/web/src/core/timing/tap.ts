import type { Line, Microseconds } from '../types';
import { usFromMs } from '../time';
import { interpolateWords } from './distribute';

/**
 * Manual tap-sync.
 *
 * This is the recovery floor for the entire product. It requires no model, no
 * GPU, no download, and works in every browser and every language, so it must
 * remain reachable from every failure state the app can reach.
 *
 * Design constraints that matter:
 *   - Timestamps come from AudioContext.currentTime, never Date.now(). Wall
 *     clock drifts against the audio clock and produces a video that is subtly
 *     late everywhere.
 *   - The reducer is pure and synchronous, so it can be unit-tested without a
 *     browser and so a tap can never be lost to React batching.
 *   - Every tap is undoable individually.
 */

export interface Tap {
  /** Index of the line this tap opened. */
  lineIndex: number;
  timeUs: Microseconds;
  /** Monotonic sequence number, for stable ordering after undos. */
  seq: number;
}

export type TapCommand =
  | { type: 'TAP'; timeUs: Microseconds }
  | { type: 'REDO_LAST_TAP'; timeUs: Microseconds }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'SET_COMPENSATION'; compensationUs: Microseconds }
  | { type: 'SET_GAP'; gapUs: Microseconds }
  | { type: 'NUDGE'; lineIndex: number; deltaUs: Microseconds };

export interface TapSession {
  taps: Tap[];
  /** Line the next tap will open. */
  nextLineIndex: number;
  /** Subtracted from raw tap time; corrects for consistent late tapping. */
  compensationUs: Microseconds;
  /** Silence preserved between consecutive lines when deriving end times. */
  gapUs: Microseconds;
  seq: number;
}

export interface TapOptions {
  lineCount: number;
  compensationUs?: Microseconds;
  gapUs?: Microseconds;
}

export function createTapSession(options: TapOptions): TapSession {
  return {
    taps: [],
    nextLineIndex: 0,
    compensationUs: options.compensationUs ?? 0,
    gapUs: options.gapUs ?? usFromMs(150),
    seq: 0
  };
}

export function tapReducer(state: TapSession, command: TapCommand, lineCount: number): TapSession {
  switch (command.type) {
    case 'TAP': {
      if (state.nextLineIndex >= lineCount) return state;
      const timeUs = Math.max(0, command.timeUs - state.compensationUs);
      // Guard against a double-fire from a held key: ignore taps that land on
      // top of the previous one.
      const previous = state.taps[state.taps.length - 1];
      if (previous && timeUs - previous.timeUs < usFromMs(40)) return state;
      const tap: Tap = { lineIndex: state.nextLineIndex, timeUs, seq: state.seq + 1 };
      return {
        ...state,
        taps: [...state.taps.filter((t) => t.lineIndex !== tap.lineIndex), tap].sort((a, b) => a.lineIndex - b.lineIndex),
        nextLineIndex: state.nextLineIndex + 1,
        seq: state.seq + 1
      };
    }
    case 'REDO_LAST_TAP': {
      const previous = state.taps[state.taps.length - 1];
      if (!previous) return state;
      const timeUs = Math.max(0, command.timeUs - state.compensationUs);
      return {
        ...state,
        taps: [...state.taps.slice(0, -1), { ...previous, timeUs, seq: state.seq + 1 }],
        seq: state.seq + 1
      };
    }
    case 'UNDO': {
      if (state.taps.length === 0) return state;
      return { ...state, taps: state.taps.slice(0, -1), nextLineIndex: Math.max(0, state.nextLineIndex - 1) };
    }
    case 'RESET':
      return { ...createTapSession({ lineCount }), compensationUs: state.compensationUs, gapUs: state.gapUs };
    case 'SET_COMPENSATION':
      return { ...state, compensationUs: command.compensationUs };
    case 'SET_GAP':
      return { ...state, gapUs: Math.max(0, command.gapUs) };
    case 'NUDGE':
      return {
        ...state,
        taps: state.taps.map((t) =>
          t.lineIndex === command.lineIndex ? { ...t, timeUs: Math.max(0, t.timeUs + command.deltaUs) } : t
        )
      };
  }
}

/** How far through the song the user has tapped, 0..1. */
export function tapProgress(state: TapSession, lineCount: number): number {
  if (lineCount === 0) return 1;
  return Math.min(1, state.taps.length / lineCount);
}

/**
 * Materialise taps into line timings.
 *
 * A line's end is the next line's start minus the configured gap. The final
 * line, and any line followed by a long pause, gets a duration estimated from
 * its text weight so short lines do not linger and long ones do not flash.
 */
export function applyTaps(
  lines: Line[],
  session: TapSession,
  options: { durationUs?: Microseconds | null; maxLineUs?: Microseconds } = {}
): Line[] {
  if (session.taps.length === 0) return lines;
  const maxLineUs = options.maxLineUs ?? usFromMs(6000);
  const byIndex = new Map(session.taps.map((t) => [t.lineIndex, t.timeUs]));

  const starts: (Microseconds | null)[] = lines.map((_, i) => byIndex.get(i) ?? null);
  const result: Line[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const start = starts[i];
    if (start === null || start === undefined) {
      result.push(line);
      continue;
    }
    const nextStart = findNextStart(starts, i);
    let end = nextStart !== null ? nextStart - session.gapUs : start + estimateDuration(line.text);
    end = Math.min(end, start + maxLineUs);
    if (options.durationUs !== null && options.durationUs !== undefined) {
      end = Math.min(end, options.durationUs);
    }
    end = Math.max(end, start + usFromMs(400));
    const updated: Line = { ...line, start, end, source: 'tap', confidence: 1, words: [] };
    result.push({ ...updated, words: interpolateWords(updated, start, end) });
  }
  return result;
}

function findNextStart(starts: (Microseconds | null)[], fromIndex: number): Microseconds | null {
  for (let i = fromIndex + 1; i < starts.length; i += 1) {
    const value = starts[i];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** Longer lines get more time; a constant duration feels mechanical. */
function estimateDuration(text: string): Microseconds {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(usFromMs(600 + words * 260));
}

/**
 * Estimate the compensation slider's ideal value.
 *
 * If a beat grid is available, the median signed distance from each tap to its
 * nearest beat is the user's consistent reaction bias. This is a suggestion the
 * user applies explicitly — it is never applied silently.
 */
export function suggestCompensation(
  session: TapSession,
  beatGrid: Microseconds[],
  maxSearchUs: Microseconds = usFromMs(400)
): Microseconds | null {
  if (beatGrid.length === 0 || session.taps.length < 3) return null;
  const deltas: number[] = [];
  for (const tap of session.taps) {
    let best = Infinity;
    for (const beat of beatGrid) {
      const delta = tap.timeUs - beat;
      if (Math.abs(delta) < Math.abs(best)) best = delta;
      if (beat > tap.timeUs + maxSearchUs) break;
    }
    if (Math.abs(best) <= maxSearchUs) deltas.push(best);
  }
  if (deltas.length < 3) return null;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 0;
  return Math.round(median);
}
