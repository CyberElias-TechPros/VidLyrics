import type { Line, Microseconds, Project } from '../types';
import {
  formatAssTimestamp,
  formatLrcTimestamp,
  formatSrtTimestamp,
  formatVttTimestamp,
  usFromMs
} from '../time';
import { highlightTokens } from '../lyrics/segment';
import { APP_NAME, APP_VERSION, PROJECT_FORMAT_VERSION } from '../project/factory';
import type { AssetRecord, ProjectFile } from '../types';

/**
 * Subtitle and lyric exports.
 *
 * Every writer here is a pure function of the project, so an export can be
 * diffed byte-for-byte between runs — which is how you catch a renderer or
 * serialiser that quietly started depending on wall-clock time.
 */

export type SubtitleFormat = 'lrc' | 'enhanced-lrc' | 'srt' | 'vtt' | 'ass' | 'txt' | 'json';

export const SUBTITLE_FORMATS: { id: SubtitleFormat; label: string; extension: string; description: string }[] = [
  { id: 'lrc', label: 'LRC', extension: '.lrc', description: 'Standard synced lyrics. Plays in most music players.' },
  { id: 'enhanced-lrc', label: 'Enhanced LRC', extension: '.lrc', description: 'Per-word karaoke timing. Needs a player that supports it.' },
  { id: 'srt', label: 'SubRip (.srt)', extension: '.srt', description: 'Universal subtitle format for YouTube, Vimeo and editors.' },
  { id: 'vtt', label: 'WebVTT (.vtt)', extension: '.vtt', description: 'Web-native captions for HTML5 video players.' },
  { id: 'ass', label: 'SubStation Alpha (.ass)', extension: '.ass', description: 'Styled subtitles with karaoke fill tags.' },
  { id: 'txt', label: 'Plain text', extension: '.txt', description: 'Lyrics only, no timing.' },
  { id: 'json', label: 'Timed JSON', extension: '.json', description: 'Full timings, sections and confidence for other tools.' }
];

export interface SubtitleOptions {
  /** Applied to every timestamp without mutating stored timings. */
  offsetUs?: Microseconds;
  /** Drop lines with no timing instead of estimating them. */
  skipUntimed?: boolean;
  artist?: string;
  title?: string;
  album?: string;
}

function timedLines(project: Project, options: SubtitleOptions): Line[] {
  const offset = options.offsetUs ?? 0;
  return project.lyrics.lines
    .filter((l) => l.text.trim().length > 0)
    .filter((l) => !options.skipUntimed || (l.start > 0 || l.end > 0))
    .map((l) => ({ ...l, start: Math.max(0, l.start + offset), end: Math.max(l.start, l.end + offset) }))
    .sort((a, b) => a.start - b.start);
}

export function toLrc(project: Project, options: SubtitleOptions = {}): string {
  const lines = timedLines(project, options);
  const header: string[] = [];
  const title = options.title ?? project.meta.title;
  const artist = options.artist ?? project.meta.artist;
  const album = options.album ?? project.meta.album;
  if (title) header.push(`[ti:${title}]`);
  if (artist) header.push(`[ar:${artist}]`);
  if (album) header.push(`[al:${album}]`);
  header.push(`[by:${APP_NAME}]`);
  if ((options.offsetUs ?? 0) !== 0) header.push(`[offset:${Math.round(-(options.offsetUs ?? 0) / 1000)}]`);

  const body = lines.map((line) => `${formatLrcTimestamp(line.start)}${line.text}`);
  return [...header, '', ...body, ''].join('\n');
}

export function toEnhancedLrc(project: Project, options: SubtitleOptions = {}): string {
  const lines = timedLines(project, options);
  const header = [`[ti:${options.title ?? project.meta.title}]`, `[ar:${options.artist ?? project.meta.artist}]`, `[by:${APP_NAME}]`, ''];
  const body = lines.map((line) => {
    const tags = line.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => `${formatLrcTimestamp(w.start).replace(/[[\]]/g, '').replace(/^/, '<').replace(/$/, '>')}${w.text}`)
      .join('');
    return `${formatLrcTimestamp(line.start)}${tags || line.text}`;
  });
  return [...header, ...body, ''].join('\n');
}

export function toSrt(project: Project, options: SubtitleOptions = {}): string {
  const lines = timedLines(project, options);
  return lines
    .map((line, i) => `${i + 1}\n${formatSrtTimestamp(line.start)} --> ${formatSrtTimestamp(line.end)}\n${line.text}\n`)
    .join('\n');
}

export function toVtt(project: Project, options: SubtitleOptions = {}): string {
  const lines = timedLines(project, options);
  const cues = lines.map((line, i) => {
    const cueId = `cue-${i + 1}`;
    const words = line.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => `<${formatVttTimestamp(w.start)}>${w.text}`)
      .join(' ');
    return `${cueId}\n${formatVttTimestamp(line.start)} --> ${formatVttTimestamp(line.end)}\n${words || line.text}\n`;
  });
  return ['WEBVTT', '', ...cues].join('\n');
}

export interface AssOptions extends SubtitleOptions {
  /** Style definition written into the header. */
  fontName?: string;
  fontSize?: number;
  primaryColour?: string;
  outlineColour?: string;
  playResX?: number;
  playResY?: number;
}

function assColor(hex: string, alpha = 0): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length < 6) return '&H00FFFFFF';
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

export function toAss(project: Project, options: AssOptions = {}): string {
  const lines = timedLines(project, options);
  const playResX = options.playResX ?? project.export.width;
  const playResY = options.playResY ?? project.export.height;
  const fontSize = options.fontSize ?? Math.round(playResY * 0.05);
  const fontName = options.fontName ?? (project.design.typography.fontStack.split(',')[0] ?? 'Arial').replace(/["']/g, '');
  const primary = assColor(options.primaryColour ?? project.design.typography.activeColor);
  const secondary = assColor(options.primaryColour ?? project.design.typography.color);
  const outline = assColor(options.outlineColour ?? '#000000');

  const header = [
    '[Script Info]',
    `Title: ${options.title ?? project.meta.title}`,
    `Original Script: ${APP_NAME} ${APP_VERSION}`,
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primary},${secondary},${outline},&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,${Math.round(playResY * 0.09)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ''
  ];

  const events = lines.map((line) => {
    // {\kf} gives a smooth fill; the value is centiseconds per word.
    const karaoke = line.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => {
        const centiseconds = Math.max(1, Math.round((w.end - w.start) / 10_000));
        return `{\\kf${centiseconds}}${w.text}`;
      })
      .join(' ');
    const text = (karaoke || line.text).replace(/\n/g, '\\N');
    const speakerTag = line.speaker === 'B' ? '{\\fad(120,120)}' : '';
    return `Dialogue: 0,${formatAssTimestamp(line.start)},${formatAssTimestamp(line.end)},Default,,0,0,0,,${speakerTag}${text}`;
  });

  return [...header, ...events, ''].join('\n');
}

export function toPlainText(project: Project): string {
  return project.lyrics.lines
    .map((l) => l.text)
    .filter((t) => t.trim().length > 0)
    .join('\n');
}

export interface TimedJson {
  app: { name: string; version: string };
  /** Explicit so a reader never has to guess whether these are ms or us. */
  timeUnit: 'microseconds';
  exportedAt: number;
  meta: Project['meta'];
  durationUs: Microseconds;
  sections: Project['sections'];
  instrumentalRegions: { start: Microseconds; end: Microseconds }[];
  lines: {
    text: string;
    start: Microseconds;
    end: Microseconds;
    sectionId: string | null;
    speaker: 'A' | 'B' | null;
    translation: string | null;
    timingSource: string;
    confidence: number;
    words: { text: string; start: Microseconds; end: Microseconds; confidence: number }[];
  }[];
}

export function toTimedJson(project: Project, options: SubtitleOptions = {}, instrumentalRegions: { start: Microseconds; end: Microseconds }[] = []): TimedJson {
  const offset = options.offsetUs ?? 0;
  const lines = timedLines(project, options);
  return {
    app: { name: APP_NAME, version: APP_VERSION },
    timeUnit: 'microseconds',
    exportedAt: Date.now(),
    meta: project.meta,
    durationUs: project.audio?.durationUs ?? 0,
    sections: project.sections,
    instrumentalRegions,
    lines: lines.map((line) => ({
      text: line.text,
      start: line.start,
      end: line.end,
      sectionId: line.sectionId,
      speaker: line.speaker,
      translation: line.translation,
      timingSource: line.source,
      confidence: line.words.length > 0 ? Math.min(...line.words.map((w) => w.confidence)) : 1,
      words: line.words.map((w) => ({ text: w.text, start: Math.max(0, w.start + offset), end: Math.max(0, w.end + offset), confidence: w.confidence }))
    }))
  };
}

export function serialiseSubtitle(project: Project, format: SubtitleFormat, options: SubtitleOptions = {}): string {
  switch (format) {
    case 'lrc':
      return toLrc(project, options);
    case 'enhanced-lrc':
      return toEnhancedLrc(project, options);
    case 'srt':
      return toSrt(project, options);
    case 'vtt':
      return toVtt(project, options);
    case 'ass':
      return toAss(project, options);
    case 'txt':
      return toPlainText(project);
    case 'json':
      return JSON.stringify(toTimedJson(project, options), null, 2);
  }
}

export function subtitleExtension(format: SubtitleFormat): string {
  return SUBTITLE_FORMATS.find((f) => f.id === format)?.extension ?? '.txt';
}

/* ---------------------------- project files ---------------------------- */

/**
 * Build a .vidlyricsproject payload.
 *
 * Binary assets are deliberately NOT embedded. Audio can be hundreds of
 * megabytes, and a JSON file that large cannot be parsed on a phone. Instead
 * the file carries an asset manifest with content hashes, and on import the app
 * asks the user to re-link the audio file, verifying the hash matches.
 */
export function buildProjectFile(project: Project, assets: AssetRecord[]): ProjectFile {
  return {
    kind: 'vidlyrics.project',
    formatVersion: PROJECT_FORMAT_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    exportedAt: Date.now(),
    project,
    assets
  };
}

export function serialiseProjectFile(file: ProjectFile): string {
  return JSON.stringify(file, null, 2);
}

/** Suggest a safe download filename from project metadata. */
export function suggestedFileName(project: Project, extension: string): string {
  const base = [project.meta.artist, project.meta.title].filter(Boolean).join(' - ') || 'lyric-video';
  const safe = base
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'lyric-video';
  return `${safe}${extension}`;
}

/** True when a line has no word timing, so exports that need words degrade. */
export function lineNeedsWordTiming(line: Line): boolean {
  return line.words.filter((w) => w.text.trim().length > 0).length === 0 && highlightTokens(line.text).length > 0;
}

export const MIN_SUBTITLE_DURATION_US = usFromMs(400);
