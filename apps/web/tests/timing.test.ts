import { describe, it, expect } from 'vitest';
import { usFromMs, usFromSeconds } from '../src/core/time';
import { createLine, linesFromText } from '../src/core/project/factory';
import { estimateLineTimings, interpolateWords, lineWeight, estimateSyllables } from '../src/core/timing/distribute';
import {
  postProcess, sortLines, clampTimings, enforceMinimumDuration, applyLeadIn, fillGaps,
  resolveOverlaps, snapToBeatGrid, detectInstrumentalRegions, DEFAULT_POSTPROCESS
} from '../src/core/timing/postprocess';
import {
  createTapSession, tapReducer, applyTaps, tapProgress, suggestCompensation
} from '../src/core/timing/tap';
import { alignSequences, alignmentScore } from '../src/core/timing/needleman';

const linesFrom = (texts: string[]) => texts.map((t) => createLine(t));

describe('timing distribution', () => {
  it('gives longer lines proportionally more time', () => {
    const lines = linesFrom(['Short', 'A considerably longer lyric line with many more words in it']);
    const timed = estimateLineTimings(lines, { durationUs: usFromSeconds(20) });
    const [short, long] = timed;
    expect(long!.end - long!.start).toBeGreaterThan(short!.end - short!.start);
  });

  it('spans the requested duration without exceeding it', () => {
    const lines = linesFrom(Array.from({ length: 10 }, (_, i) => `Line number ${i} with some words`));
    const timed = estimateLineTimings(lines, { durationUs: usFromSeconds(60), gapUs: usFromMs(200) });
    const last = timed[timed.length - 1]!;
    expect(last.end).toBeLessThanOrEqual(usFromSeconds(60) + usFromMs(1));
    expect(timed[0]!.start).toBeGreaterThan(0);
  });

  it('never touches human-set timings', () => {
    const lines = linesFrom(['Keep me']);
    lines[0]!.start = usFromSeconds(10);
    lines[0]!.end = usFromSeconds(12);
    lines[0]!.source = 'human';
    const timed = estimateLineTimings(lines, { durationUs: usFromSeconds(60) });
    expect(timed[0]!.start).toBe(usFromSeconds(10));
    expect(timed[0]!.source).toBe('human');
  });

  it('synthesises word timings that stay inside the line and cover it', () => {
    const line = createLine('Hello beautiful world');
    const words = interpolateWords(line, usFromSeconds(1), usFromSeconds(3));
    expect(words).toHaveLength(3);
    expect(words[0]!.start).toBe(usFromSeconds(1));
    expect(words[words.length - 1]!.end).toBe(usFromSeconds(3));
    for (let i = 1; i < words.length; i += 1) {
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
      expect(words[i]!.end).toBeGreaterThanOrEqual(words[i]!.start);
    }
  });

  it('estimates syllables sensibly for weighting', () => {
    expect(estimateSyllables('hello')).toBeGreaterThanOrEqual(2);
    expect(estimateSyllables('the')).toBe(1);
    expect(lineWeight('a')).toBeLessThan(lineWeight('supercalifragilistic'));
  });
});

describe('timing post-processing', () => {
  const build = () => {
    const lines = linesFrom(['One', 'Two', 'Three', 'Four']);
    lines[0]!.start = 0; lines[0]!.end = usFromMs(200);
    lines[1]!.start = usFromMs(1000); lines[1]!.end = usFromMs(1200);
    lines[2]!.start = usFromMs(2000); lines[2]!.end = usFromMs(2300);
    lines[3]!.start = usFromMs(9000); lines[3]!.end = usFromMs(9400);
    return lines;
  };

  it('enforces a readable minimum display duration', () => {
    const result = enforceMinimumDuration(build(), DEFAULT_POSTPROCESS.minLineUs);
    for (const line of result) {
      expect(line.end - line.start).toBeGreaterThanOrEqual(DEFAULT_POSTPROCESS.minLineUs);
    }
  });

  it('fills short gaps but preserves long instrumental silences', () => {
    const lines = build();
    const filled = fillGaps(lines, usFromMs(900));
    expect(filled[0]!.end).toBe(usFromMs(1000)); // 800ms gap closed
    expect(filled[2]!.end).toBe(usFromMs(2300)); // 6.7s gap preserved
  });

  it('adds lead-in without letting lines overlap the previous one', () => {
    const result = applyLeadIn(build(), usFromMs(300));
    expect(result[1]!.start).toBe(usFromMs(700));
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]!.start).toBeGreaterThanOrEqual(result[i - 1]!.end - 1);
    }
  });

  it('resolves overlaps so two lines never fight for the same slot', () => {
    const lines = linesFrom(['A', 'B']);
    lines[0]!.start = 0; lines[0]!.end = usFromMs(2000);
    lines[1]!.start = usFromMs(1000); lines[1]!.end = usFromMs(3000);
    const resolved = resolveOverlaps(lines, null);
    expect(resolved[1]!.start).toBeGreaterThanOrEqual(resolved[0]!.end);
  });

  it('clamps into the audio duration and keeps start <= end', () => {
    const lines = linesFrom(['A']);
    lines[0]!.start = usFromSeconds(5);
    lines[0]!.end = usFromSeconds(20);
    const clamped = clampTimings(lines, usFromSeconds(10));
    expect(clamped[0]!.end).toBe(usFromSeconds(10));
    expect(clamped[0]!.start).toBeLessThanOrEqual(clamped[0]!.end);
  });

  it('detects instrumental regions between distant lines', () => {
    const regions = detectInstrumentalRegions(build(), usFromSeconds(12), usFromSeconds(2));
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.some((r) => r.start >= usFromMs(2300) && r.end <= usFromSeconds(9))).toBe(true);
  });

  it('produces a fully ordered, non-overlapping timeline', () => {
    const result = postProcess(build(), { durationUs: usFromSeconds(12) });
    const sorted = sortLines(result);
    for (const line of sorted) {
      expect(line.end).toBeGreaterThan(line.start);
      expect(line.start).toBeGreaterThanOrEqual(0);
      expect(line.end).toBeLessThanOrEqual(usFromSeconds(12));
    }
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end - 1);
    }
  });

  it('is idempotent: running it twice changes nothing further', () => {
    const once = postProcess(build(), { durationUs: usFromSeconds(12) });
    const twice = postProcess(once, { durationUs: usFromSeconds(12) });
    expect(twice.map((l) => [l.start, l.end])).toEqual(once.map((l) => [l.start, l.end]));
  });

  it('applies lead-in only when asked, because the pass is not idempotent', () => {
    const plain = postProcess(build(), { durationUs: usFromSeconds(12) });
    const withLeadIn = postProcess(build(), { durationUs: usFromSeconds(12), applyLeadIn: true });
    // Lead-in pulls display starts earlier than the sung starts.
    expect(withLeadIn[1]!.start).toBeLessThanOrEqual(plain[1]!.start);
    // The default pass never applies it, so repeated passes cannot accumulate.
    const again = postProcess(plain, { durationUs: usFromSeconds(12) });
    expect(again.map((l) => l.start)).toEqual(plain.map((l) => l.start));
  });

  it('snaps to a beat grid only when a beat is genuinely close', () => {
    const lines = linesFrom(['A']);
    lines[0]!.start = 0;
    lines[0]!.end = usFromMs(1000);
    lines[0]!.words = interpolateWords(lines[0]!, 0, usFromMs(1000)).map((w) => ({ ...w, start: usFromMs(90) }));
    const grid = [0, 500_000, 1_000_000, 1_500_000];
    const snapped = snapToBeatGrid(lines, grid, usFromMs(100));
    expect(snapped[0]!.words[0]!.start).toBe(0);
    const far = lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, start: usFromMs(300) })) }));
    const untouched = snapToBeatGrid(far, grid, usFromMs(50));
    expect(untouched[0]!.words[0]!.start).toBe(usFromMs(300));
  });
});

describe('tap-sync', () => {
  it('assigns consecutive taps to consecutive lines and derives ends', () => {
    const lines = linesFrom(['First line here', 'Second line here', 'Third']);
    let session = createTapSession({ lineCount: lines.length });
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(1) }, lines.length);
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(3) }, lines.length);
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(6) }, lines.length);

    expect(session.taps).toHaveLength(3);
    expect(tapProgress(session, lines.length)).toBe(1);

    const timed = applyTaps(lines, session);
    expect(timed[0]!.start).toBe(usFromSeconds(1));
    expect(timed[0]!.end).toBeLessThan(usFromSeconds(3));
    expect(timed[1]!.start).toBe(usFromSeconds(3));
    expect(timed[2]!.start).toBe(usFromSeconds(6));
    expect(timed[2]!.end).toBeGreaterThan(usFromSeconds(6));
    expect(timed.every((l) => l.source === 'tap')).toBe(true);
    expect(timed.every((l) => l.confidence === 1)).toBe(true);
  });

  it('undoes a mistap and lets the user redo it', () => {
    let session = createTapSession({ lineCount: 3 });
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(1) }, 3);
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(2) }, 3);
    expect(session.nextLineIndex).toBe(2);
    session = tapReducer(session, { type: 'UNDO' }, 3);
    expect(session.taps).toHaveLength(1);
    expect(session.nextLineIndex).toBe(1);
    // REDO_LAST_TAP re-times the most recent tap in place rather than adding one.
    session = tapReducer(session, { type: 'REDO_LAST_TAP', timeUs: usFromSeconds(4) }, 3);
    expect(session.taps).toHaveLength(1);
    expect(session.taps[0]?.timeUs).toBe(usFromSeconds(4));
  });

  it('ignores a double-fire from a held key', () => {
    let session = createTapSession({ lineCount: 3 });
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(1) }, 3);
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(1) + usFromMs(10) }, 3);
    expect(session.taps).toHaveLength(1);
  });

  it('applies reaction-time compensation', () => {
    let session = createTapSession({ lineCount: 2, compensationUs: usFromMs(100) });
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(2) }, 2);
    expect(session.taps[0]?.timeUs).toBe(usFromSeconds(2) - usFromMs(100));
  });

  it('refuses to tap past the last line', () => {
    let session = createTapSession({ lineCount: 1 });
    session = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(1) }, 1);
    const after = tapReducer(session, { type: 'TAP', timeUs: usFromSeconds(2) }, 1);
    expect(after.taps).toHaveLength(1);
  });

  it('suggests a compensation value from a beat grid', () => {
    const grid = Array.from({ length: 40 }, (_, i) => i * 500_000);
    let session = createTapSession({ lineCount: 6 });
    [0, 1, 2, 3, 4, 5].forEach((i) => {
      session = tapReducer(session, { type: 'TAP', timeUs: i * 1_000_000 + 80_000 }, 6);
    });
    const suggestion = suggestCompensation(session, grid);
    expect(suggestion).not.toBeNull();
    expect(Math.abs((suggestion ?? 0) - 80_000)).toBeLessThan(50_000);
  });
});

describe('sequence alignment', () => {
  it('matches identical sequences perfectly', () => {
    const pairs = alignSequences(['hello', 'world'], ['hello', 'world'], (x) => x, (y) => y);
    expect(pairs).toHaveLength(2);
    expect(alignmentScore(pairs)).toBe(1);
  });

  it('aligns a noisy ASR sequence onto true lyrics', () => {
    const asr = ['helo', 'wrold', 'again'];
    const truth = ['hello', 'world', 'again'];
    const pairs = alignSequences(truth, asr, (x) => x, (y) => y);
    const matched = pairs.filter((p) => p.a && p.b);
    expect(matched.length).toBe(3);
    expect(alignmentScore(pairs)).toBeGreaterThan(0.7);
  });

  it('handles insertions and deletions without crashing', () => {
    const pairs = alignSequences(['a', 'b', 'c'], ['b'], (x) => x, (y) => y);
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    expect(alignmentScore([])).toBe(0);
  });

  it('is symmetric enough to be usable in either direction', () => {
    const a = alignSequences(['one', 'two', 'three'], ['one', 'three'], (x) => x, (y) => y);
    expect(a.filter((p) => p.a && p.b).length).toBe(2);
  });
});
