import type { Id, Line, Project, Section, Word } from '../types';
import { designFromTheme, exportSettingsFromPreset } from '../design/tokens';
import { usFromSeconds } from '../time';
import { normalizeDisplay, normalizeForMatch } from '../lyrics/normalize';
import { highlightTokens } from '../lyrics/segment';

/** Current on-disk project format version. Bump only alongside a migration. */
export const PROJECT_FORMAT_VERSION = 2;

export const APP_NAME = 'Lyrics Video Studio';
export const APP_VERSION = '1.0.0';

let idCounter = 0;

/**
 * Ids are time-ordered and unique within a session. They are not cryptographic
 * and never used for authorisation — every id is local to the user's device.
 */
export function newId(prefix: string): Id {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${rand}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export function createWord(lineId: Id, text: string, index: number, start = 0, end = 0): Word {
  return {
    id: `${lineId}_w${index}`,
    text,
    norm: normalizeForMatch(text),
    start,
    end,
    confidence: 0,
    source: 'estimate',
    locked: false
  };
}

export function createLine(text: string, overrides: Partial<Line> = {}): Line {
  const id = newId('ln');
  const clean = normalizeDisplay(text);
  const words = highlightTokens(clean).map((t, i) => createWord(id, t.text.trim(), i));
  return {
    id,
    text: clean,
    words,
    start: 0,
    end: 0,
    sectionId: null,
    locked: false,
    style: {},
    speaker: null,
    translation: null,
    source: 'estimate',
    ...overrides
  };
}

export function createSection(kind: Section['kind'], occurrence = 1): Section {
  return { id: newId('sec'), kind, label: kind, occurrence };
}

export function createProject(options: { title?: string; artist?: string; themeId?: string } = {}): Project {
  const now = Date.now();
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: newId('prj'),
    createdAt: now,
    updatedAt: now,
    meta: {
      title: options.title ?? '',
      artist: options.artist ?? '',
      album: '',
      language: 'en',
      notes: ''
    },
    audio: null,
    voiceover: null,
    lyrics: { source: 'empty', originalText: '', originalFileName: null, lines: [] },
    sections: [],
    design: designFromTheme(options.themeId ?? 'nocturne', '16:9'),
    export: exportSettingsFromPreset('youtube', usFromSeconds(180)),
    ui: { mode: 'simple', zoomPxPerSecond: 60, selection: null, lastPlayheadUs: 0 }
  };
}

/** Split raw pasted text into lines, dropping blanks and structural tags. */
export function linesFromText(text: string): Line[] {
  return normalizeDisplay(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => createLine(l));
}

/** Duplicate a line for a repeated chorus, preserving text but not timings. */
export function duplicateLine(line: Line, index: number): Line {
  const id = newId('ln');
  const words = highlightTokens(line.text).map((t, i) => createWord(id, t.text.trim(), i));
  return {
    ...line,
    id,
    words,
    locked: false,
    source: 'estimate',
    start: line.start,
    end: line.end
  };
}

/** Split a line into two at a word boundary, dividing the duration by weight. */
export function splitLine(line: Line, wordIndex: number): [Line, Line] | null {
  const tokens = highlightTokens(line.text);
  if (wordIndex <= 0 || wordIndex >= tokens.length) return null;
  const leftText = tokens.slice(0, wordIndex).map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
  const rightText = tokens.slice(wordIndex).map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!leftText || !rightText) return null;

  const span = line.end - line.start;
  const leftWeight = leftText.length;
  const rightWeight = rightText.length;
  const splitAt = Math.round(line.start + (span * leftWeight) / Math.max(1, leftWeight + rightWeight));

  const left = createLine(leftText, {
    start: line.start,
    end: splitAt,
    sectionId: line.sectionId,
    locked: line.locked,
    style: line.style,
    speaker: line.speaker,
    source: line.source
  });
  const right = createLine(rightText, {
    start: splitAt,
    end: line.end,
    sectionId: line.sectionId,
    locked: line.locked,
    style: line.style,
    speaker: line.speaker,
    source: line.source
  });
  return [left, right];
}

/** Merge a line with its successor. */
export function mergeLines(a: Line, b: Line): Line {
  const text = `${a.text.trim()} ${b.text.trim()}`.replace(/\s+/g, ' ').trim();
  const merged = createLine(text, {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    sectionId: a.sectionId,
    locked: a.locked && b.locked,
    style: a.style,
    speaker: a.speaker,
    source: a.source === 'human' || b.source === 'human' ? 'human' : a.source
  });
  return merged;
}
