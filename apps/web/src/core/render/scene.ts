import type { Design, Line, Microseconds, Project, Word } from '../types';
import { getAspect } from '../design/tokens';
import type { SpectrumEnvelope } from '../audio/spectrum';
import type { BeatGrid } from '../audio/beats';
import { clampUs } from '../time';
import { highlightTokens } from '../lyrics/segment';

/**
 * The scene graph.
 *
 * `buildScene` turns a Project into a fully resolved, immutable description of
 * what should be on screen. It is called once per composition — not per frame —
 * and both the live preview and the offline exporter consume the SAME scene.
 *
 * This is the single most important architectural rule in the renderer: preview
 * and export must not be able to diverge, because a user who sees one thing and
 * downloads another has lost their evening.
 */

export interface SceneLine {
  id: string;
  text: string;
  words: { text: string; start: Microseconds; end: Microseconds }[];
  start: Microseconds;
  end: Microseconds;
  speaker: 'A' | 'B' | null;
  translation: string | null;
  locked: boolean;
  /** Lowest per-word confidence on the line — drives the editor's heat display. */
  minConfidence: number;
  style: Line['style'];
}

export interface SceneAssets {
  /** Resolved bitmap/image per asset id. Missing assets render as a gradient. */
  images: Map<string, CanvasImageSource>;
}

export interface CompositionBox {
  width: number;
  height: number;
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  contentHeight: number;
  safe: { top: number; right: number; bottom: number; left: number };
}

export interface Scene {
  width: number;
  height: number;
  fps: number;
  durationUs: Microseconds;
  box: CompositionBox;
  design: Design;
  lines: SceneLine[];
  offsetUs: Microseconds;
  spectrum: SpectrumEnvelope | null;
  beatGrid: BeatGrid | null;
  assets: SceneAssets;
  /** 1 for export; devicePixelRatio for preview. */
  pixelRatio: number;
  /** Font stacks that must be loaded before frame 0 is drawn. */
  requiredFonts: string[];
  introUs: Microseconds;
  outroUs: Microseconds;
}

export interface BuildSceneOptions {
  spectrum?: SpectrumEnvelope | null;
  beatGrid?: BeatGrid | null;
  assets?: SceneAssets;
  pixelRatio?: number;
  fps?: number;
  durationUs?: Microseconds | null;
  offsetUs?: Microseconds;
}

/** Resolve the composition size from the design, honouring `custom`. */
export function compositionSize(design: Design): { width: number; height: number } {
  if (design.aspectId === 'custom' && design.customSize) {
    return { width: design.customSize.width, height: design.customSize.height };
  }
  const aspect = getAspect(design.aspectId);
  return { width: aspect.width, height: aspect.height };
}

/** Content box = the frame minus the platform's safe-area insets, in pixels. */
export function contentBox(width: number, height: number, design: Design): CompositionBox {
  const aspect = getAspect(design.aspectId);
  const safe = design.aspectId === 'custom' ? { top: 0.04, right: 0.05, bottom: 0.04, left: 0.05 } : aspect.safeArea;
  const top = Math.round(height * safe.top);
  const right = Math.round(width * safe.right);
  const bottom = Math.round(height * safe.bottom);
  const left = Math.round(width * safe.left);
  return {
    width,
    height,
    contentLeft: left,
    contentTop: top,
    contentWidth: Math.max(1, width - left - right),
    contentHeight: Math.max(1, height - top - bottom),
    safe
  };
}

/**
 * Word timings the renderer can actually use.
 *
 * A line's word array can be partially filled (alignment covered some words, or
 * the user split a line and the halves kept placeholder timings at zero). Feeding
 * those to the karaoke fill makes every word appear already sung, which is the
 * single most visible way a lyric video can look broken.
 *
 * Rule: if the stored word timings do not sit inside the line and in order,
 * re-derive them from the line's own span. The re-derivation happens here, in the
 * one place both preview and export read from, so the two can never disagree.
 */
function usableWords(line: Line): { text: string; start: Microseconds; end: Microseconds }[] {
  const tokens = highlightTokens(line.text);
  const stored = line.words.filter((w) => w.text.trim().length > 0);

  const usable =
    stored.length === tokens.length &&
    stored.every((w, i) => {
      const previous: Word | null = i === 0 ? null : stored[i - 1] ?? null;
      const inRange = w.start >= line.start - 1 && w.end <= line.end + 1 && w.end >= w.start;
      const ordered = previous === null || w.start >= previous.start - 1;
      return inRange && ordered;
    }) &&
    (stored.length === 0 || (stored[0]!.end - stored[0]!.start > 0));

  if (usable) return stored.map((w) => ({ text: w.text, start: w.start, end: Math.max(w.end, w.start) }));

  // Interpolate across the line by character weight.
  const weights = tokens.map((t) => Math.max(1, t.text.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, line.end - line.start);
  let cursor = line.start;
  return tokens.map((token, i) => {
    const share = Math.round((span * (weights[i] ?? 1)) / totalWeight);
    const start = Math.round(cursor);
    const end = i === tokens.length - 1 ? line.end : Math.round(cursor + share);
    cursor = end;
    return { text: token.text, start, end: Math.max(end, start) };
  });
}

export function buildScene(project: Project, options: BuildSceneOptions = {}): Scene {
  const { width, height } = compositionSize(project.design);
  const box = contentBox(width, height, project.design);
  const audioDuration = project.audio?.durationUs ?? 0;
  const lastLineEnd = project.lyrics.lines.reduce((max, l) => Math.max(max, l.end), 0);
  const tail = Math.max(0, audioDuration, lastLineEnd);

  const introUs = project.design.intro.enabled ? project.design.intro.durationUs : 0;
  const outroUs = project.design.outro.enabled ? project.design.outro.durationUs : 0;

  const requestedDuration = options.durationUs ?? null;
  const durationUs = clampUs(
    requestedDuration ?? Math.max(tail, introUs + outroUs),
    0,
    Number.MAX_SAFE_INTEGER
  );

  const offsetUs = options.offsetUs ?? project.export.globalOffsetUs;

  const lines: SceneLine[] = project.lyrics.lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => ({
      id: l.id,
      text: l.text,
      words: usableWords(l),
      // The global offset is applied here, at render time, and is NEVER written
      // back into stored timings. Moving the slider must stay reversible.
      start: Math.max(0, l.start + introUs + offsetUs),
      end: Math.max(0, l.end + introUs + offsetUs),
      speaker: l.speaker,
      translation: l.translation,
      locked: l.locked,
      minConfidence: l.words.length > 0 ? Math.min(...l.words.map((w) => w.confidence)) : l.source === 'human' || l.source === 'tap' ? 1 : 0.3,
      style: l.style
    }))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const fonts = new Set<string>();
  fonts.add(project.design.typography.fontStack.split(',')[0]?.replace(/["']/g, '').trim() ?? '');

  return {
    width,
    height,
    fps: options.fps ?? project.export.fps,
    durationUs,
    box,
    design: project.design,
    lines,
    offsetUs,
    spectrum: options.spectrum ?? null,
    beatGrid: options.beatGrid ?? null,
    assets: options.assets ?? { images: new Map() },
    pixelRatio: options.pixelRatio ?? 1,
    requiredFonts: [...fonts].filter(Boolean),
    introUs,
    outroUs
  };
}

/** Time within the musical timeline, accounting for the intro card. */
export function toMusicTime(scene: Scene, timeUs: Microseconds): Microseconds {
  return Math.max(0, timeUs - scene.introUs);
}

/** Total composition length including intro/outro cards. */
export function totalDuration(scene: Scene): Microseconds {
  return scene.durationUs + scene.introUs + scene.outroUs;
}

/**
 * Which line should be on screen at `timeUs`, and what fraction of the
 * enter/exit transition has completed.
 *
 * Returns null during instrumentals and after the last line — deliberately.
 * Showing a stale lyric during a guitar solo is the single most common failure
 * mode of auto-generated lyric videos.
 */
export function activeLineIndex(scene: Scene, musicTimeUs: Microseconds): number {
  const lines = scene.lines;
  if (lines.length === 0) return -1;
  // Binary search: timelines can hold thousands of lines.
  let low = 0;
  let high = lines.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const line = lines[mid];
    if (!line) break;
    if (line.start <= musicTimeUs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate;
}

/** Lines that should be drawn at this instant, including cross-fade overlap. */
export function visibleLines(scene: Scene, musicTimeUs: Microseconds): number[] {
  const out: number[] = [];
  const overlap = scene.design.motion.overlapUs;
  for (let i = 0; i < scene.lines.length; i += 1) {
    const line = scene.lines[i];
    if (!line) continue;
    if (line.end + overlap < musicTimeUs) continue;
    if (line.start - overlap > musicTimeUs) break;
    out.push(i);
  }
  return out;
}
