import { describe, it, expect } from 'vitest';
import { buildScene, contentBox, activeLineIndex, toMusicTime } from '../src/core/render/scene';
import { computeFrameState } from '../src/core/render/frame';
import { approximateMeasurer, layoutWords, blockAnchorY } from '../src/core/render/layout';
import { createProject, createLine } from '../src/core/project/factory';
import { designFromTheme } from '../src/core/design/tokens';
import { usFromMs, usFromSeconds } from '../src/core/time';

// A measure factory, as the renderer expects: one measurer per font size.
const measure = (fontSizePx: number) => approximateMeasurer(fontSizePx);
// layoutWords takes a single measurer directly.
const measurer = approximateMeasurer(64);

function makeProject(themeId = 'nocturne', aspectId: '16:9' | '9:16' = '16:9') {
  const project = createProject({ themeId });
  project.design = designFromTheme(themeId, aspectId);
  project.audio = {
    assetId: 'a', fileName: 's.mp3', mimeType: 'audio/mpeg', bytes: 1,
    durationUs: usFromSeconds(30), sampleRate: 44100, channels: 2, peaksAssetId: 'p', contentHash: 'h'
  };
  project.lyrics.lines = [
    createLine('Hello there world', { start: usFromSeconds(2), end: usFromSeconds(4), source: 'human' }),
    createLine('Second lyric line', { start: usFromSeconds(6), end: usFromSeconds(8), source: 'human' }),
    createLine('After the long break', { start: usFromSeconds(20), end: usFromSeconds(22), source: 'human' })
  ];
  return project;
}

describe('scene construction', () => {
  it('applies platform safe-area insets per aspect', () => {
    const vertical = contentBox(1080, 1920, designFromTheme('nocturne', '9:16'));
    const landscape = contentBox(1920, 1080, designFromTheme('nocturne', '16:9'));
    // 9:16 reserves far more at the bottom, where platform UI sits.
    expect(vertical.safe.bottom).toBeGreaterThan(landscape.safe.bottom);
    expect(vertical.contentHeight).toBeLessThan(1920);
    expect(landscape.contentWidth).toBeLessThan(1920);
  });

  it('applies the global offset at render time without touching stored timings', () => {
    const project = makeProject();
    const stored = project.lyrics.lines[0]!.start;
    project.export.globalOffsetUs = usFromMs(500);
    const scene = buildScene(project);
    expect(scene.lines[0]!.start).toBe(stored + usFromMs(500));
    // The project itself is untouched, so moving the slider stays reversible.
    expect(project.lyrics.lines[0]!.start).toBe(stored);
  });

  it('shifts lyric time by the intro card duration', () => {
    const project = makeProject();
    project.design.intro = { enabled: true, title: 'T', subtitle: '', durationUs: usFromSeconds(3) };
    const scene = buildScene(project);
    expect(toMusicTime(scene, usFromSeconds(4))).toBe(usFromSeconds(1));
  });

  it('finds the active line with a binary search that handles the edges', () => {
    const scene = buildScene(makeProject());
    expect(activeLineIndex(scene, 0)).toBe(-1);
    expect(activeLineIndex(scene, usFromSeconds(2))).toBe(0);
    expect(activeLineIndex(scene, usFromSeconds(6))).toBe(1);
    expect(activeLineIndex(scene, usFromSeconds(25))).toBe(2);
  });
});

describe('frame computation', () => {
  it('is deterministic: the same time always yields the same frame', () => {
    const scene = buildScene(makeProject());
    const a = computeFrameState(scene, usFromSeconds(2.5), measure);
    const b = computeFrameState(scene, usFromSeconds(2.5), measure);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('shows nothing during a long instrumental instead of a stale lyric', () => {
    const scene = buildScene(makeProject());
    const frame = computeFrameState(scene, usFromSeconds(14), measure);
    const fullyOpaque = frame.lines.filter((l) => l.opacity > 0.01);
    expect(fullyOpaque).toHaveLength(0);
  });

  it('progresses karaoke fill monotonically across a word', () => {
    const scene = buildScene(makeProject('neon-circuit'));
    const fills: number[] = [];
    for (let ms = 2000; ms <= 4000; ms += 100) {
      const frame = computeFrameState(scene, usFromMs(ms), measure);
      const word = frame.lines[0]?.rows[0]?.tokens[0];
      fills.push(word?.fill ?? 0);
    }
    for (let i = 1; i < fills.length; i += 1) {
      expect(fills[i]!).toBeGreaterThanOrEqual(fills[i - 1]! - 1e-9);
    }
    expect(fills[0]!).toBeLessThanOrEqual(0.001);
    expect(fills[fills.length - 1]!).toBeGreaterThan(0.9);
  });

  it('snaps fill to whole words in word mode', () => {
    const scene = buildScene(makeProject('mono-brutal'));
    const frame = computeFrameState(scene, usFromMs(3000), measure);
    const first = frame.lines[0]?.rows[0]?.tokens[0];
    expect([0, 1]).toContain(first?.fill);
  });

  it('fades a line in and out at its boundaries', () => {
    const scene = buildScene(makeProject());
    const before = computeFrameState(scene, usFromMs(1900), measure);
    const during = computeFrameState(scene, usFromMs(3000), measure);
    const after = computeFrameState(scene, usFromMs(4400), measure);
    // A line absent from the frame is fully gone, which is opacity 0.
    expect(before.lines[0]?.opacity ?? 0).toBeLessThan(during.lines[0]?.opacity ?? 0);
    expect(after.lines[0]?.opacity ?? 0).toBeLessThan(during.lines[0]?.opacity ?? 0);
  });

  it('scales typography with the composition so 9:16 and 16:9 both fit', () => {
    const wide = computeFrameState(buildScene(makeProject('nocturne', '16:9')), usFromSeconds(3), measure);
    const tall = computeFrameState(buildScene(makeProject('nocturne', '9:16')), usFromSeconds(3), measure);
    expect(wide.lines[0]!.fontSizePx).toBeGreaterThan(0);
    expect(tall.lines[0]!.fontSizePx).toBeGreaterThan(wide.lines[0]!.fontSizePx);
    for (const line of tall.lines) {
      for (const row of line.rows) {
        expect(row.widthPx).toBeLessThanOrEqual(tall.guides.width * 1.05);
      }
    }
  });
});

describe('text layout', () => {
  it('wraps long lines into multiple rows inside the content box', () => {
    const words = 'a very long lyric line that cannot possibly fit on one row'.split(' ');
    const layout = layoutWords(words.map((text, index) => ({ text, index })), measurer, {
      fontSizePx: 64, lineHeightPx: 76, maxWidthPx: 600
    });
    expect(layout.rows.length).toBeGreaterThan(1);
    for (const row of layout.rows) expect(row.widthPx).toBeLessThanOrEqual(600);
  });

  it('breaks a single over-wide token by grapheme rather than overflowing', () => {
    const layout = layoutWords([{ text: 'supercalifragilisticexpialidocious', index: 0 }], measurer, {
      fontSizePx: 64, lineHeightPx: 76, maxWidthPx: 200
    });
    expect(layout.rows.length).toBeGreaterThan(1);
    expect(layout.maxWidthPx).toBeLessThanOrEqual(200);
  });

  it('places the block inside the content area for every anchor', () => {
    for (const anchor of ['top', 'center', 'bottom'] as const) {
      const y = blockAnchorY(200, 100, 800, anchor);
      expect(y).toBeGreaterThanOrEqual(100);
      expect(y + 200).toBeLessThanOrEqual(900);
    }
  });
});
