import {
  parseClock,
  usFromMs,
  usFromSeconds,
  type Microseconds
} from '../time';
import { normalizeDisplay, normalizeForMatch } from './normalize';

/**
 * Lyric import.
 *
 * Accepts every format a real user is likely to arrive with:
 *   .lrc            standard LRC, including multi-tag lines
 *   .lrc (enhanced) per-word `<mm:ss.xx>` karaoke timing
 *   .srt / .vtt     subtitle cues, including VTT inline word tags
 *   .ass            Advanced SubStation Alpha, including {\k} karaoke tags
 *   .json           this app's own timed-lyrics export
 *   .txt            untimed lyrics, one line per cue
 *
 * Import is deliberately lossless and non-destructive: the caller receives raw
 * text plus parsed timings and decides how to merge them into a project.
 */

export type LyricFormat = 'lrc' | 'srt' | 'vtt' | 'ass' | 'json' | 'txt' | 'project';

export interface ParsedWord {
  text: string;
  start: Microseconds;
  end: Microseconds;
}

export interface ParsedLine {
  text: string;
  start: Microseconds | null;
  end: Microseconds | null;
  words: ParsedWord[];
}

export interface ParsedLyrics {
  format: LyricFormat;
  lines: ParsedLine[];
  meta: { title?: string; artist?: string; album?: string; offsetUs?: Microseconds };
  /** Non-fatal problems worth surfacing in the import dialog. */
  warnings: string[];
}

export function detectFormat(fileName: string, contents: string): LyricFormat {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  // `.txt` is deliberately NOT trusted: users routinely save .lrc and .vtt
  // content with a .txt extension, and the content is the stronger signal.
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  if (ext === 'json') return contents.includes('"kind":"vidlyrics.project"') || contents.includes('"kind": "vidlyrics.project"') ? 'project' : 'json';
  if (ext === 'lrc') return 'lrc';

  const head = contents.slice(0, 4096).trimStart();
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/^\[Script Info\]/im.test(head)) return 'ass';
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(contents);
      if (parsed && typeof parsed === 'object' && 'kind' in parsed && (parsed as { kind: string }).kind === 'vidlyrics.project') {
        return 'project';
      }
    } catch {
      /* not JSON — fall through */
    }
    if (/^\s*\[?\{?\s*"/.test(head) && /"(text|line|start|words)"/.test(head)) return 'json';
  }
  if (/^\[\d{1,2}:\d{2}([.:]\d{1,3})?\]/m.test(head)) return 'lrc';
  if (/^\d+\s*\n\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/m.test(head)) return 'srt';
  return 'txt';
}

/* ------------------------------- LRC ------------------------------- */

const LRC_META = /^\[(ti|ar|al|by|re|ve|offset|length|au|hash|sign|qq|total|language):(.*)\]$/i;
const LRC_TIME = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LRC_WORD_TIME = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function lrcTagToUs(min: string, sec: string, frac: string | undefined): Microseconds {
  const fracDigits = (frac ?? '0').padEnd(3, '0').slice(0, 3);
  return (Number(min) * 60 + Number(sec)) * 1_000_000 + Number(fracDigits) * 1_000;
}

function parseEnhancedLrcWords(rest: string, lineEnd: Microseconds | null): ParsedWord[] {
  const marks: { start: Microseconds; index: number }[] = [];
  LRC_WORD_TIME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LRC_WORD_TIME.exec(rest))) {
    marks.push({ start: lrcTagToUs(m[1] ?? '0', m[2] ?? '0', m[3]), index: m.index + m[0].length });
  }
  if (marks.length < 2) return [];

  const words: ParsedWord[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (!mark) continue;
    const next = marks[i + 1];
    const text = next ? rest.slice(mark.index, next.index) : rest.slice(mark.index);
    const clean = text.replace(LRC_WORD_TIME, '').trim();
    if (!clean) continue;
    words.push({
      text: clean,
      start: mark.start,
      // The next mark is the boundary; the final word runs to the line end.
      end: next ? next.start : (lineEnd ?? mark.start)
    });
  }
  return words;
}

function parseLrc(contents: string, warnings: string[]): ParsedLyrics {
  const meta: ParsedLyrics['meta'] = {};
  const lines: ParsedLine[] = [];
  const raw = contents.replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of raw) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const metaMatch = LRC_META.exec(trimmed);
    if (metaMatch && !/^\[(\d{1,2}):/.test(trimmed)) {
      const key = (metaMatch[1] ?? '').toLowerCase();
      const value = (metaMatch[2] ?? '').trim();
      if (key === 'ti') meta.title = value;
      else if (key === 'ar' || key === 'au') meta.artist = value;
      else if (key === 'al') meta.album = value;
      else if (key === 'offset') {
        const n = Number(value);
        if (Number.isFinite(n)) {
          // LRC offset is milliseconds; positive means "shift lyrics earlier".
          meta.offsetUs = -usFromMs(n);
        } else {
          warnings.push(`Ignored non-numeric LRC offset "${value}".`);
        }
      }
      continue;
    }

    LRC_TIME.lastIndex = 0;
    const stamps: Microseconds[] = [];
    let lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = LRC_TIME.exec(trimmed))) {
      stamps.push(lrcTagToUs(tm[1] ?? '0', tm[2] ?? '0', tm[3]));
      lastIndex = tm.index + tm[0].length;
    }
    if (stamps.length === 0) continue;

    const rest = trimmed.slice(lastIndex);
    const text = normalizeDisplay(rest.replace(LRC_WORD_TIME, ''));
    if (!text) continue;

    // A single physical line carrying several timestamps means the same lyric
    // repeats — a chorus. Emit one cue per stamp.
    for (const start of stamps) {
      lines.push({ text, start, end: null, words: parseEnhancedLrcWords(rest, null) });
    }
  }

  lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return { format: 'lrc', lines, meta, warnings };
}

/* --------------------------- SRT / VTT ----------------------------- */

const CUE_RANGE = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function rangeToUs(parts: string[]): [Microseconds, Microseconds] {
  const a = ((Number(parts[0]) * 60 + Number(parts[1])) * 60 + Number(parts[2])) * 1000 + Number((parts[3] ?? '0').padEnd(3, '0').slice(0, 3));
  const b = ((Number(parts[4]) * 60 + Number(parts[5])) * 60 + Number(parts[6])) * 1000 + Number((parts[7] ?? '0').padEnd(3, '0').slice(0, 3));
  return [a * 1000, b * 1000];
}

function stripVttInlineTags(text: string): string {
  return text
    .replace(/<\d{1,2}:\d{2}:\d{2}\.\d{1,3}>/g, '')
    .replace(/<c\.[^>]*>/g, '')
    .replace(/<\/c>/g, '')
    .replace(/<[^>]+>/g, '');
}

function parseVttWordTags(text: string): ParsedWord[] {
  const marks: { start: Microseconds; index: number }[] = [];
  const re = /<(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = (((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4])) * 1000;
    marks.push({ start, index: m.index + m[0].length });
  }
  if (marks.length < 2) return [];
  const words: ParsedWord[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (!mark) continue;
    const next = marks[i + 1];
    const chunk = next ? text.slice(mark.index, next.index) : text.slice(mark.index);
    const clean = normalizeDisplay(stripVttInlineTags(chunk));
    if (!clean) continue;
    words.push({ text: clean, start: mark.start, end: next ? next.start : mark.start });
  }
  return words;
}

function parseSrtOrVtt(contents: string, format: 'srt' | 'vtt', warnings: string[]): ParsedLyrics {
  const lines: ParsedLine[] = [];
  const normalized = contents.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const blocks = normalized.split(/\n{2,}/);
  let skipped = 0;

  for (const block of blocks) {
    const body = block.split('\n').filter((l) => l.trim().length > 0);
    if (body.length === 0) continue;
    if (format === 'vtt' && /^WEBVTT/.test(body[0] ?? '')) {
      body.shift();
      if (body.length === 0) continue;
    }
    if (/^NOTE/.test(body[0] ?? '')) continue;
    if (/^STYLE/.test(body[0] ?? '')) continue;

    const rangeIndex = body.findIndex((l) => CUE_RANGE.test(l));
    if (rangeIndex === -1) {
      skipped += 1;
      continue;
    }
    const match = CUE_RANGE.exec(body[rangeIndex] ?? '');
    if (!match) continue;
    const [start, end] = rangeToUs(match.slice(1, 9));

    const text = normalizeDisplay(
      body
        .slice(rangeIndex + 1)
        .map((l) => stripVttInlineTags(l))
        .join(' ')
    );
    if (!text) {
      skipped += 1;
      continue;
    }
    const rawText = body.slice(rangeIndex + 1).join(' ');
    lines.push({ text, start, end, words: format === 'vtt' ? parseVttWordTags(rawText) : [] });
  }

  if (skipped > 0) warnings.push(`Skipped ${skipped} block(s) without a usable timestamp range.`);
  return { format, lines, meta: {}, warnings };
}

/* ------------------------------- ASS ------------------------------- */

const ASS_KARAOKE = /\{\\[kK](?:f|o)?(\d+)\}/g;

/**
 * Split a Dialogue payload into its 10 fields.
 *
 * `String.split(',', 10)` is WRONG here: it truncates and silently discards
 * everything after the tenth comma, so any lyric containing a comma loses its
 * ending. The tenth field is the text and must keep its commas intact.
 */
function splitAssFields(payload: string): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < 9; i += 1) {
    const comma = payload.indexOf(',', start);
    if (comma === -1) return fields;
    fields.push(payload.slice(start, comma));
    start = comma + 1;
  }
  fields.push(payload.slice(start));
  return fields;
}

function stripAssOverrides(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ');
}

function parseAssKaraoke(text: string, start: Microseconds): ParsedWord[] {
  const words: ParsedWord[] = [];
  let cursor = start;
  const re = /\{\\[kK](?:f|o)?(\d+)\}([^{}]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const centiseconds = Number(m[1] ?? '0');
    const duration = centiseconds * 10_000;
    const clean = normalizeDisplay(stripAssOverrides(m[2] ?? ''));
    if (clean) words.push({ text: clean, start: cursor, end: cursor + duration });
    cursor += duration;
  }
  return words;
}

function parseAss(contents: string, warnings: string[]): ParsedLyrics {
  const lines: ParsedLine[] = [];
  const meta: ParsedLyrics['meta'] = {};
  const normalized = contents.replace(/\r\n?/g, '\n');
  let section = '';

  for (const raw of normalized.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[.*\]$/.test(line)) {
      section = line.slice(1, -1).toLowerCase();
      continue;
    }
    if (section === 'script info') {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === 'title') meta.title = value;
      continue;
    }
    if (section !== 'events') continue;
    if (!/^Dialogue:/i.test(line)) continue;

    const payload = line.slice(line.indexOf(':') + 1);
    const fields = splitAssFields(payload);
    if (fields.length < 10) {
      warnings.push('Skipped a malformed ASS Dialogue line.');
      continue;
    }
    const start = parseClock((fields[1] ?? '').trim());
    const end = parseClock((fields[2] ?? '').trim());
    const text = fields[9] ?? '';
    const words = parseAssKaraoke(text, start ?? 0);
    const clean = normalizeDisplay(stripAssOverrides(text));
    if (!clean) continue;
    lines.push({ text: clean, start, end, words });
  }

  lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return { format: 'ass', lines, meta, warnings };
}

/* ------------------------------ JSON ------------------------------- */

interface JsonLine {
  text?: unknown;
  line?: unknown;
  start?: unknown;
  end?: unknown;
  words?: unknown;
}

type TimeUnit = 'microseconds' | 'milliseconds' | 'seconds';

/**
 * Infer the time unit of a foreign JSON file.
 *
 * Ambiguity here is not academic: a 3-minute song is 180 in seconds,
 * 180 000 in milliseconds and 180 000 000 in microseconds, and guessing wrong
 * puts every cue hours into the timeline. The maximum value in the document
 * disambiguates reliably, and an explicit `timeUnit` field always wins.
 */
function inferTimeUnit(entries: unknown[], declared?: unknown): TimeUnit {
  if (declared === 'microseconds' || declared === 'milliseconds' || declared === 'seconds') return declared;
  let max = 0;
  const scan = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > max) max = value;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'start' || key === 'end' || key === 'time' || key === 'timestamp') scan(child);
        else if (typeof child === 'object') scan(child);
      }
    }
  };
  entries.forEach(scan);
  if (max === 0) return 'microseconds';
  if (max < 10_000) return 'seconds';
  if (max < 10_000_000) return 'milliseconds';
  return 'microseconds';
}

function coerceTimeUs(value: unknown, unit: TimeUnit): Microseconds | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (unit === 'seconds') return usFromSeconds(value);
    if (unit === 'milliseconds') return usFromMs(value);
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const clock = parseClock(value);
    if (clock !== null) return clock;
    const n = Number(value);
    if (Number.isFinite(n)) return coerceTimeUs(n, unit);
  }
  return null;
}

function parseJsonLyrics(contents: string, warnings: string[]): ParsedLyrics {
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch (err) {
    warnings.push(`JSON could not be parsed: ${(err as Error).message}`);
    return { format: 'json', lines: [], meta: {}, warnings };
  }

  const candidates: unknown[] = [];
  let declaredUnit: unknown;
  if (Array.isArray(data)) candidates.push(...data);
  else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    declaredUnit = obj.timeUnit;
    for (const key of ['lines', 'lyrics', 'cues', 'segments']) {
      const v = obj[key];
      if (Array.isArray(v)) candidates.push(...v);
    }
  }

  const unit = inferTimeUnit(candidates, declaredUnit);
  if (!declaredUnit && candidates.length > 0) {
    warnings.push(`No time unit was declared in that JSON, so timings were read as ${unit}.`);
  }

  const lines: ParsedLine[] = [];
  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') continue;
    const l = entry as JsonLine;
    const textRaw = typeof l.text === 'string' ? l.text : typeof l.line === 'string' ? l.line : '';
    const text = normalizeDisplay(textRaw);
    if (!text) continue;
    const words: ParsedWord[] = [];
    if (Array.isArray(l.words)) {
      let cursor = coerceTimeUs(l.start, unit) ?? 0;
      for (const w of l.words) {
        if (!w || typeof w !== 'object') continue;
        const wo = w as Record<string, unknown>;
        const wText = normalizeDisplay(String(wo.text ?? ''));
        if (!wText) continue;
        const wStart = coerceTimeUs(wo.start, unit) ?? cursor;
        const wEnd = coerceTimeUs(wo.end, unit) ?? wStart;
        words.push({ text: wText, start: wStart, end: Math.max(wEnd, wStart) });
        cursor = Math.max(cursor, wEnd);
      }
    }
    lines.push({ text, start: coerceTimeUs(l.start, unit), end: coerceTimeUs(l.end, unit), words });
  }

  if (lines.length === 0) warnings.push('No recognisable lyric entries were found in that JSON.');
  return { format: 'json', lines, meta: {}, warnings };
}

/* ------------------------------- TXT ------------------------------- */

function parseTxt(contents: string): ParsedLyrics {
  const text = normalizeDisplay(contents);
  const lines: ParsedLine[] = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => ({ text: l, start: null, end: null, words: [] }));
  return { format: 'txt', lines, meta: {}, warnings: [] };
}

/* ----------------------------- entrypoint -------------------------- */

export function parseLyrics(contents: string, fileName = 'lyrics.txt'): ParsedLyrics {
  const format = detectFormat(fileName, contents);
  switch (format) {
    case 'lrc':
      return parseLrc(contents, []);
    case 'srt':
      return parseSrtOrVtt(contents, 'srt', []);
    case 'vtt':
      return parseSrtOrVtt(contents, 'vtt', []);
    case 'ass':
      return parseAss(contents, []);
    case 'json':
      return parseJsonLyrics(contents, []);
    case 'txt':
      return parseTxt(contents);
    case 'project':
      // Handled by the project importer, which needs asset context.
      return { format: 'project', lines: [], meta: {}, warnings: ['Use "Open project" for project files.'] };
  }
}

/** True when the parse produced usable timings rather than bare text. */
export function hasTimings(parsed: ParsedLyrics): boolean {
  return parsed.lines.some((l) => l.start !== null);
}

/** Fraction of lines carrying a start timestamp — shown in the import dialog. */
export function timingCoverage(parsed: ParsedLyrics): number {
  if (parsed.lines.length === 0) return 0;
  const timed = parsed.lines.filter((l) => l.start !== null).length;
  return timed / parsed.lines.length;
}

export function lineSignature(text: string): string {
  return normalizeForMatch(text);
}
