import { describe, it, expect } from 'vitest';
import { createProject, createLine, splitLine, mergeLines, linesFromText, PROJECT_FORMAT_VERSION } from '../src/core/project/factory';
import { validateProject, validateProjectFile, projectSchema } from '../src/core/project/schema';
import { loadProjectJson, ProjectFormatError } from '../src/core/project/migrate';
import {
  createHistory, applyCommand, applyBatch, undo, redo, canUndo, canRedo, undoLabel, nudgeCommand
} from '../src/core/project/history';
import { buildProjectFile, suggestedFileName, serialiseSubtitle, toLrc, toSrt, toVtt, toAss, toPlainText } from '../src/core/export/subtitles';
import { parseLyrics } from '../src/core/lyrics/parse';
import { usFromMs, usFromSeconds } from '../src/core/time';

function projectWithLines() {
  const project = createProject({ title: 'Test Song', artist: 'Tester' });
  project.audio = {
    assetId: 'a', fileName: 's.mp3', mimeType: 'audio/mpeg', bytes: 1,
    durationUs: usFromSeconds(30), sampleRate: 44100, channels: 2, peaksAssetId: 'p', contentHash: 'h'
  };
  project.lyrics.lines = [
    createLine('First line here', { start: usFromSeconds(1), end: usFromSeconds(3) }),
    createLine('Second line here', { start: usFromSeconds(4), end: usFromSeconds(6) })
  ];
  return project;
}

describe('project schema', () => {
  it('accepts a freshly created project', () => {
    const result = validateProject(createProject());
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects tampered data with a readable path', () => {
    const project = createProject() as unknown as Record<string, unknown>;
    (project.design as Record<string, unknown>).typography = null;
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.path).toContain('typography');
  });

  it('strips unknown keys so an imported file cannot smuggle fields', () => {
    const raw = JSON.parse(JSON.stringify(createProject())) as Record<string, unknown>;
    raw.injectedPayload = '<script>alert(1)</script>';
    const parsed = projectSchema.parse(raw) as Record<string, unknown>;
    expect(parsed.injectedPayload).toBeUndefined();
  });

  it('refuses a project from a newer format version', () => {
    const raw = JSON.parse(JSON.stringify(createProject())) as Record<string, unknown>;
    raw.formatVersion = PROJECT_FORMAT_VERSION + 5;
    expect(() => loadProjectJson(raw)).toThrowError(ProjectFormatError);
    try {
      loadProjectJson(raw);
    } catch (error) {
      expect((error as ProjectFormatError).code).toBe('FUTURE_VERSION');
    }
  });

  it('loads an older file and fills missing defaults without corrupting data', () => {
    const raw = JSON.parse(JSON.stringify(projectWithLines())) as Record<string, unknown>;
    raw.formatVersion = PROJECT_FORMAT_VERSION;
    delete raw.ui;
    delete raw.sections;
    const { project, report } = loadProjectJson(raw);
    expect(report.defaultsFilled).toContain('ui');
    expect(project.lyrics.lines).toHaveLength(2);
    expect(project.meta.title).toBe('Test Song');
  });

  it('rejects a file that is not a project at all', () => {
    expect(() => loadProjectJson({ hello: 'world' })).toThrowError(ProjectFormatError);
    expect(() => loadProjectJson(null)).toThrowError(ProjectFormatError);
  });

  it('validates a full project file envelope', () => {
    const file = buildProjectFile(projectWithLines(), []);
    expect(validateProjectFile(JSON.parse(JSON.stringify(file))).ok).toBe(true);
  });
});

describe('line editing', () => {
  it('splits a line at a word boundary and preserves the total span', () => {
    const line = createLine('one two three four', { start: usFromSeconds(1), end: usFromSeconds(5) });
    const parts = splitLine(line, 2);
    expect(parts).not.toBeNull();
    const [left, right] = parts!;
    expect(left.text).toBe('one two');
    expect(right.text).toBe('three four');
    expect(left.start).toBe(usFromSeconds(1));
    expect(right.end).toBe(usFromSeconds(5));
    expect(right.start).toBe(left.end);
  });

  it('refuses a split at the first or last word', () => {
    const line = createLine('one two three');
    expect(splitLine(line, 0)).toBeNull();
    expect(splitLine(line, 3)).toBeNull();
  });

  it('merges two lines and keeps the wider time range', () => {
    const a = createLine('alpha', { start: usFromSeconds(1), end: usFromSeconds(2) });
    const b = createLine('beta', { start: usFromSeconds(3), end: usFromSeconds(4) });
    const merged = mergeLines(a, b);
    expect(merged.text).toBe('alpha beta');
    expect(merged.start).toBe(usFromSeconds(1));
    expect(merged.end).toBe(usFromSeconds(4));
  });

  it('builds lines from pasted text, dropping blanks', () => {
    expect(linesFromText('one\n\n\n  two  \n')).toHaveLength(2);
  });
});

describe('undo / redo', () => {
  it('undoes and redoes a structural edit', () => {
    let project = projectWithLines();
    let history = createHistory<typeof project>();
    const before = project.lyrics.lines;
    const after = before.slice(0, 1);
    ({ state: project, history } = applyCommand(project, history, {
      label: 'Delete line',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    }));
    expect(project.lyrics.lines).toHaveLength(1);
    expect(canUndo(history)).toBe(true);
    expect(undoLabel(history)).toBe('Delete line');

    ({ state: project, history } = undo(project, history)!);
    expect(project.lyrics.lines).toHaveLength(2);
    expect(canRedo(history)).toBe(true);
    ({ state: project, history } = redo(project, history)!);
    expect(project.lyrics.lines).toHaveLength(1);
  });

  it('coalesces repeated nudges into one undo step', () => {
    let project = projectWithLines();
    let history = createHistory<typeof project>();
    const targetId = project.lyrics.lines[0]!.id;
    for (let i = 0; i < 5; i += 1) {
      ({ state: project, history } = applyCommand(
        project,
        history,
        nudgeCommand('Nudge start', targetId, 'start', usFromMs(10), project.lyrics.lines)
      ));
    }
    expect(project.lyrics.lines[0]!.start).toBe(usFromSeconds(1) + usFromMs(50));
    expect(history.past).toHaveLength(1);
    ({ state: project, history } = undo(project, history)!);
    expect(project.lyrics.lines[0]!.start).toBe(usFromSeconds(1));
  });

  it('treats a batch as a single undo step', () => {
    let project = projectWithLines();
    let history = createHistory<typeof project>();
    const lines = project.lyrics.lines;
    ({ state: project, history } = applyBatch(project, history, 'Split', [
      { label: 'a', apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: lines.slice(0, 1) } }), revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines } }) },
      { label: 'b', apply: (p) => ({ ...p, meta: { ...p.meta, title: 'x' } }), revert: (p) => ({ ...p, meta: { ...p.meta, title: 'Test Song' } }) }
    ]));
    expect(project.meta.title).toBe('x');
    ({ state: project, history } = undo(project, history)!);
    expect(project.meta.title).toBe('Test Song');
    expect(project.lyrics.lines).toHaveLength(2);
  });

  it('returns null rather than throwing when there is nothing to undo', () => {
    const history = createHistory<object>();
    expect(undo({}, history)).toBeNull();
    expect(redo({}, history)).toBeNull();
  });
});

describe('subtitle exports', () => {
  it('exports LRC that parses back to the same timings', () => {
    const project = projectWithLines();
    const lrc = toLrc(project);
    expect(lrc).toContain('[ti:Test Song]');
    const parsed = parseLyrics(lrc, 'out.lrc');
    expect(parsed.lines).toHaveLength(2);
    // LRC stores hundredths, so a round trip is exact to 10 ms.
    expect(Math.abs((parsed.lines[0]?.start ?? 0) - usFromSeconds(1))).toBeLessThan(usFromMs(10));
  });

  it('exports SRT, VTT, ASS and plain text with the right structure', () => {
    const project = projectWithLines();
    expect(toSrt(project)).toMatch(/^1\n00:00:01,000 --> 00:00:03,000\nFirst line here/m);
    expect(toVtt(project)).toMatch(/^WEBVTT/);
    expect(toAss(project)).toContain('[Script Info]');
    expect(toAss(project)).toContain('{\\kf');
    expect(toPlainText(project)).toBe('First line here\nSecond line here');
  });

  it('applies the offset to exports without mutating stored timings', () => {
    const project = projectWithLines();
    const shifted = toSrt(project, { offsetUs: usFromMs(500) });
    expect(shifted).toContain('00:00:01,500');
    expect(project.lyrics.lines[0]!.start).toBe(usFromSeconds(1));
  });

  it('produces safe download filenames from arbitrary metadata', () => {
    const project = projectWithLines();
    project.meta.title = 'Bad/Path:Name?*<>';
    project.meta.artist = '';
    expect(suggestedFileName(project, '.mp4')).not.toMatch(/[\\/:*?"<>|]/);
    const empty = createProject();
    expect(suggestedFileName(empty, '.srt')).toBe('lyric-video.srt');
  });

  it('serialises every supported format without throwing', () => {
    const project = projectWithLines();
    for (const format of ['lrc', 'enhanced-lrc', 'srt', 'vtt', 'ass', 'txt', 'json'] as const) {
      expect(() => serialiseSubtitle(project, format)).not.toThrow();
      expect(serialiseSubtitle(project, format).length).toBeGreaterThan(0);
    }
  });
});
