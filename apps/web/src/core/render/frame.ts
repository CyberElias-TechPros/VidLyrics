import type { Microseconds } from '../types';
import type { CompositionBox, Scene } from './scene';
import { activeLineIndex, toMusicTime, totalDuration } from './scene';
import { layoutWords, rowOriginX, blockAnchorY, type Measurer } from './layout';
import {
  clamp01,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
  smoothNoise,
  linear
} from './easing';
import { energyAt, bandsAt } from '../audio/spectrum';
import { beatStrength } from '../audio/beats';
import { highlightTokens } from '../lyrics/segment';

/**
 * Frame computation and rasterisation.
 *
 * The two halves are deliberately separated:
 *
 *   computeFrameState(scene, timeUs, measurer) -> FrameState   PURE
 *   renderFrame(ctx, scene, timeUs)                            IMPURE (draws)
 *
 * `renderFrame` does nothing but paint a FrameState. Every number that decides
 * what appears on screen is produced by the pure half, so the entire visual
 * result is unit-testable and, more importantly, IDENTICAL between the live
 * preview and the offline encoder.
 *
 * Determinism contract: no Date.now(), no Math.random(), no wall-clock reads.
 * A frame is a pure function of (scene, timeUs).
 */

export type WordFillState = 'upcoming' | 'active' | 'done';

export interface WordFrame {
  text: string;
  /** 0..1 horizontal fill inside this word. */
  fill: number;
  state: WordFillState;
  widthPx: number;
  /** Extra glow at this instant (beat-reactive). */
  glow: number;
  scale: number;
}

export interface RowFrame {
  tokens: WordFrame[];
  widthPx: number;
  originX: number;
  baselineY: number;
}

export interface LineFrame {
  id: string;
  rows: RowFrame[];
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  blurPx: number;
  /** 0..1 clip reveal progress for the 'clip' entrance. */
  clipWipe: number;
  isCurrent: boolean;
  fontSizePx: number;
  lineHeightPx: number;
  letterSpacingPx: number;
  weight: number;
  color: string;
  activeColor: string;
  uppercase: boolean;
  align: 'left' | 'center' | 'right';
  outlineWidth: number;
  outlineColor: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetY: number;
  glow: number;
  translation: { text: string; opacity: number; fontSizePx: number } | null;
  /** Lowest confidence on this line, so preview can flag uncertain timing. */
  minConfidence: number;
}

export interface BackgroundFrame {
  kind: string;
  /** Gradient stops, already positioned for this instant. */
  stops: { offset: number; color: string }[];
  /** Angle of a linear gradient, radians. */
  angle: number;
  /** Radial mesh blob centres/colours. */
  blobs: { x: number; y: number; radius: number; color: string }[];
  scrim: number;
  /** Ken Burns / drift transform for image backgrounds. */
  image: { assetId: string | null; scale: number; translateX: number; translateY: number };
  /** Visualizer band values 0..1, empty when disabled. */
  bands: number[];
  /** Beat pulse 0..1 for beat-reactive backgrounds. */
  pulse: number;
}

export interface CardFrame {
  title: string;
  subtitle: string;
  opacity: number;
  scale: number;
  kind: 'intro' | 'outro';
}

export interface FrameState {
  timeUs: Microseconds;
  musicTimeUs: Microseconds;
  width: number;
  height: number;
  progress: number;
  background: BackgroundFrame;
  lines: LineFrame[];
  card: CardFrame | null;
  /** Safe-area rectangle, drawn only when guides are enabled. */
  guides: { x: number; y: number; width: number; height: number };
}

/**
 * A measurer factory rather than a single measurer.
 *
 * Every line can have its own font size and weight, and canvas `measureText`
 * only answers for the font currently set on the context. Passing one shared
 * measurer would measure every line at one size — a subtle bug that shows up as
 * text overflowing the safe area on the lines that use a per-line style override.
 */
export type MeasureFn = (fontSizePx: number, weight: number, letterSpacingPx: number) => Measurer;

export interface ComputeOptions {
  /** Draw the platform safe-area rectangle (editor only). */
  showGuides?: boolean;
  /** Show confidence heat in the preview. */
  showHeat?: boolean;
}

const MIN_WORD_DURATION_US = 120_000;

function wordFill(
  mode: string,
  timeUs: Microseconds,
  wordStart: Microseconds,
  wordEnd: Microseconds,
  lineStart: Microseconds,
  lineEnd: Microseconds,
  lineProgress: number
): { fill: number; state: WordFillState } {
  switch (mode) {
    case 'none':
      return { fill: 1, state: 'active' };
    case 'line':
      return {
        fill: lineProgress,
        state: timeUs >= lineEnd ? 'done' : timeUs >= lineStart ? 'active' : 'upcoming'
      };
    case 'word':
      if (timeUs >= wordEnd) return { fill: 1, state: 'done' };
      if (timeUs >= wordStart) return { fill: 1, state: 'active' };
      return { fill: 0, state: 'upcoming' };
    case 'progressive':
    default: {
      const duration = Math.max(MIN_WORD_DURATION_US, wordEnd - wordStart);
      const fill = clamp01((timeUs - wordStart) / duration);
      const state: WordFillState = fill >= 1 ? 'done' : fill > 0 ? 'active' : 'upcoming';
      return { fill, state };
    }
  }
}

export function computeFrameState(scene: Scene, timeUs: Microseconds, measure: MeasureFn, options: ComputeOptions = {}): FrameState {
  const musicTimeUs = toMusicTime(scene, timeUs);
  const design = scene.design;
  const typography = design.typography;
  const karaoke = design.karaoke;
  const motion = design.motion;
  const box = scene.box;
  const total = Math.max(1, totalDuration(scene));

  const background = computeBackground(scene, musicTimeUs);
  const card = computeCard(scene, timeUs);

  const visible = collectVisible(scene, musicTimeUs);
  const currentIndex = activeLineIndex(scene, musicTimeUs);

  const lines: LineFrame[] = visible.map((entry) =>
    buildLineFrame(scene, entry.index, musicTimeUs, measure, box, currentIndex === entry.index)
  );

  // Resolve vertical collisions: if two lines overlap during a cross-fade, the
  // outgoing one sits above the incoming one rather than on top of it.
  separateOverlapping(lines);

  return {
    timeUs,
    musicTimeUs,
    width: scene.width,
    height: scene.height,
    progress: clamp01(timeUs / total),
    background,
    lines,
    card,
    guides: {
      x: box.contentLeft,
      y: box.contentTop,
      width: box.contentWidth,
      height: box.contentHeight
    }
  };

  function collectVisible(s: Scene, t: Microseconds): { index: number }[] {
    const overlap = motion.overlapUs;
    const out: { index: number }[] = [];
    for (let i = 0; i < s.lines.length; i += 1) {
      const line = s.lines[i];
      if (!line) continue;
      if (line.end + Math.max(overlap, motion.exitUs) < t) continue;
      if (line.start - motion.enterUs > t) break;
      out.push({ index: i });
    }
    return out;
  }
}

function buildLineFrame(
  scene: Scene,
  index: number,
  musicTimeUs: Microseconds,
  measure: MeasureFn,
  box: CompositionBox,
  isCurrent: boolean
): LineFrame {
  const line = scene.lines[index]!;
  const design = scene.design;
  const typography = design.typography;
  const karaoke = design.karaoke;
  const motion = design.motion;

  const style = line.style;
  const fontSizePx = Math.round((style.sizeRatio ?? typography.sizeRatio) * scene.height);
  const lineHeightPx = fontSizePx * typography.lineHeight;
  const letterSpacingPx = typography.letterSpacing * fontSizePx;
  const weight = style.weight ?? typography.weight;
  const uppercase = style.uppercase ?? typography.uppercase;
  const align = style.align ?? typography.align;

  // Entrance / exit progress, both derived from the same clock.
  const enterProgress = motion.enterUs > 0 ? clamp01((musicTimeUs - (line.start - motion.enterUs)) / motion.enterUs) : 1;
  const exitProgress = motion.exitUs > 0 ? clamp01((musicTimeUs - line.end) / motion.exitUs) : 0;

  const { opacity, translateX, translateY, blurPx, scaleBase, clipWipe } = transitionTransform(
    motion.enter,
    motion.exit,
    enterProgress,
    exitProgress,
    fontSizePx,
    motion.intensity
  );

  // Word timings. When a line has none, synthesise equal-weight positions so
  // karaoke still animates instead of snapping — degradation, not failure.
  const rawWords =
    line.words.length > 0
      ? line.words
      : highlightTokens(line.text).map((token, i, all) => {
          const span = Math.max(1, line.end - line.start);
          const start = line.start + Math.round((span * i) / all.length);
          const end = line.start + Math.round((span * (i + 1)) / all.length);
          return { text: token.text, start, end };
        });

  const measurer = measure(fontSizePx, weight, letterSpacingPx);
  const layout = layoutWords(
    rawWords.map((w, i) => ({ text: w.text, index: i })),
    measurer,
    { fontSizePx, lineHeightPx, maxWidthPx: box.contentWidth, letterSpacingPx, uppercase }
  );

  const lineProgress = clamp01((musicTimeUs - line.start) / Math.max(1, line.end - line.start));
  const beatTolerance = Math.round((scene.beatGrid?.intervalUs ?? 500_000) * 0.18);

  const rows: RowFrame[] = layout.rows.map((row, rowIndex) => {
    const tokens: WordFrame[] = [];
    for (const token of row.tokens) {
      const source = rawWords[token.wordIndex];
      const wStart = source?.start ?? line.start;
      const wEnd = source?.end ?? line.end;
      const { fill, state } = wordFill(karaoke.mode, musicTimeUs, wStart, wEnd, line.start, line.end, lineProgress);

      let glow = 0;
      let scale = 1;
      if (karaoke.glow > 0 && state !== 'upcoming') {
        const base = karaoke.glow * (state === 'active' ? 1 : 0.45);
        const beat = karaoke.beatAware && scene.beatGrid
          ? beatStrength(scene.beatGrid, musicTimeUs, beatTolerance)
          : 0;
        glow = Math.min(2, base * (1 + beat * 0.6));
      }
      if (karaoke.scale !== 1 && state === 'active') {
        const activate = clamp01((musicTimeUs - wStart) / Math.max(1, Math.min(160_000, wEnd - wStart)));
        scale = 1 + (karaoke.scale - 1) * easeOutBack(activate) * (1 - activate * 0.6);
      }
      tokens.push({ text: token.text, fill, state, widthPx: token.widthPx, glow, scale });
    }

    const originX = rowOriginX(row, box.contentLeft, box.contentWidth, align);
    return {
      tokens,
      widthPx: row.widthPx,
      originX,
      baselineY: 0 // filled in below once the block origin is known
    };
  });

  const blockHeight = layout.heightPx;
  const blockTop = blockAnchorY(blockHeight, box.contentTop, box.contentHeight, typography.anchor);
  rows.forEach((row, i) => {
    row.baselineY = blockTop + i * lineHeightPx + fontSizePx * 0.82;
  });

  const translationText = line.translation?.trim();

  return {
    id: line.id,
    rows,
    opacity,
    translateX: translateX + (line.speaker === 'B' ? fontSizePx * 0.6 : 0),
    translateY: translateY + scaleBase,
    scale: karaoke.scale !== 1 ? 1 : 1,
    blurPx,
    clipWipe,
    isCurrent,
    fontSizePx,
    lineHeightPx,
    letterSpacingPx,
    weight,
    color: style.color ?? typography.color,
    activeColor: typography.activeColor,
    uppercase,
    align,
    outlineWidth: typography.outlineWidth * (scene.height / 1080),
    outlineColor: typography.outlineColor,
    shadowBlur: typography.shadowBlur * (scene.height / 1080),
    shadowColor: typography.shadowColor,
    shadowOffsetY: typography.shadowOffsetY * (scene.height / 1080),
    glow: karaoke.glow,
    translation: translationText
      ? { text: translationText, opacity: opacity * 0.85, fontSizePx: Math.round(fontSizePx * 0.42) }
      : null,
    minConfidence: line.minConfidence
  };
}

function transitionTransform(
  enter: string,
  exit: string,
  enterProgress: number,
  exitProgress: number,
  fontSizePx: number,
  intensity: number
): { opacity: number; translateX: number; translateY: number; blurPx: number; scaleBase: number; clipWipe: number } {
  const e = easeOutCubic(enterProgress);
  const x = easeInOutCubic(exitProgress);
  let opacity = e * (1 - x);
  let translateX = 0;
  let translateY = 0;
  let blurPx = 0;
  let clipWipe = 1;

  switch (enter) {
    case 'fade':
      break;
    case 'rise':
      translateY += (1 - e) * fontSizePx * 0.55 * intensity;
      break;
    case 'clip':
      clipWipe = e;
      opacity = Math.min(1, e * 2);
      break;
    case 'blur':
      blurPx += (1 - e) * fontSizePx * 0.28 * intensity;
      break;
    case 'wordCascade':
      translateY += (1 - e) * fontSizePx * 0.3 * intensity;
      break;
    case 'none':
      opacity = enterProgress >= 1 ? 1 : 0;
      break;
  }

  switch (exit) {
    case 'fade':
      break;
    case 'sink':
      translateY += x * fontSizePx * 0.45 * intensity;
      break;
    case 'blur':
      blurPx += x * fontSizePx * 0.3 * intensity;
      break;
    case 'none':
      opacity = exitProgress > 0 ? 0 : opacity;
      break;
  }

  return { opacity: clamp01(opacity), translateX, translateY, blurPx, scaleBase: 0, clipWipe };
}

function separateOverlapping(lines: LineFrame[]): void {
  for (let i = 1; i < lines.length; i += 1) {
    const previous = lines[i - 1];
    const current = lines[i];
    if (!previous || !current) continue;
    if (!previous.isCurrent && !current.isCurrent) continue;
    const prevBottom = previous.rows[previous.rows.length - 1]?.baselineY ?? 0;
    const curTop = (current.rows[0]?.baselineY ?? 0) - current.fontSizePx;
    if (curTop < prevBottom && previous.isCurrent !== current.isCurrent) {
      const shift = current.isCurrent ? prevBottom - curTop + current.fontSizePx * 0.3 : 0;
      current.translateY -= shift;
    }
  }
}

function computeBackground(scene: Scene, musicTimeUs: Microseconds): BackgroundFrame {
  const bg = scene.design.background;
  const seconds = musicTimeUs / 1_000_000;
  const bands: number[] = [];
  let pulse = 0;

  if (scene.spectrum && (bg.kind === 'visualizer' || bg.visualizerGain > 0)) {
    const raw = bandsAt(scene.spectrum, musicTimeUs);
    for (let i = 0; i < raw.length; i += 1) bands.push(Math.min(1, (raw[i] ?? 0) / 255));
    pulse = Math.min(1, energyAt(scene.spectrum, musicTimeUs, bg.visualizerBand));
  }

  const drift = bg.motion * seconds;
  const stops = bg.colors.map((color, i) => ({
    offset: clamp01(i / Math.max(1, bg.colors.length - 1)),
    color
  }));

  const blobs =
    bg.kind === 'mesh'
      ? bg.colors.map((color, i) => ({
          x: 0.25 + 0.5 * smoothNoise(drift * 0.35 + i * 3.1, i),
          y: 0.3 + 0.4 * smoothNoise(drift * 0.28 + i * 7.7, i + 10),
          radius: 0.35 + 0.2 * (0.5 + 0.5 * smoothNoise(drift * 0.2 + i * 5.3, i + 20)) + pulse * 0.08,
          color
        }))
      : [];

  return {
    kind: bg.kind,
    stops,
    angle: Math.PI * 0.5 + 0.25 * Math.sin(drift * 0.12),
    blobs,
    scrim: bg.scrim,
    image: {
      assetId: bg.assetId,
      scale: 1 + bg.motion * 0.12 + pulse * 0.03,
      translateX: bg.motion * 0.04 * smoothNoise(drift * 0.2, 1),
      translateY: bg.motion * 0.04 * smoothNoise(drift * 0.17, 2)
    },
    bands,
    pulse
  };
}

function computeCard(scene: Scene, timeUs: Microseconds): CardFrame | null {
  const { intro, outro } = scene.design;
  if (intro.enabled && timeUs < scene.introUs) {
    const t = clamp01(timeUs / Math.max(1, scene.introUs));
    const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
    return { title: intro.title, subtitle: intro.subtitle, opacity: clamp01(fade), scale: 1 + (1 - easeOutCubic(Math.min(1, t * 4))) * 0.04, kind: 'intro' };
  }
  const outroStart = scene.introUs + scene.durationUs;
  if (outro.enabled && timeUs >= outroStart) {
    const t = clamp01((timeUs - outroStart) / Math.max(1, scene.outroUs));
    const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
    return { title: outro.title, subtitle: outro.subtitle, opacity: clamp01(fade), scale: 1, kind: 'outro' };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * RASTERISATION
 * ------------------------------------------------------------------ */

export interface RenderOptions extends ComputeOptions {
  measure: MeasureFn;
}

/**
 * Draw one frame. This is the ONLY function both the preview and the exporter
 * call. If a visual change is needed, it goes in here — never in a second
 * renderer, because a second renderer will diverge.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scene: Scene,
  timeUs: Microseconds,
  options: RenderOptions
): FrameState {
  const state = computeFrameState(scene, timeUs, options.measure, options);
  const { width, height } = scene;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);

  paintBackground(ctx, scene, state);
  for (const line of state.lines) paintLine(ctx, scene, line, state);
  if (state.card) paintCard(ctx, scene, state.card);
  paintBrand(ctx, scene, state);
  if (options.showGuides) paintGuides(ctx, state);
  ctx.restore();

  return state;
}

function paintBackground(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: Scene, state: FrameState): void {
  const { width, height } = scene;
  const bg = state.background;

  if (bg.kind === 'solid' || bg.stops.length === 0) {
    ctx.fillStyle = bg.stops[0]?.color ?? '#000000';
    ctx.fillRect(0, 0, width, height);
  } else if (bg.kind === 'mesh') {
    ctx.fillStyle = bg.stops[0]?.color ?? '#000000';
    ctx.fillRect(0, 0, width, height);
    for (const blob of bg.blobs) {
      const radius = Math.max(1, blob.radius * Math.max(width, height));
      const gradient = ctx.createRadialGradient(blob.x * width, blob.y * height, 0, blob.x * width, blob.y * height, radius);
      gradient.addColorStop(0, withAlpha(blob.color, 0.75));
      gradient.addColorStop(1, withAlpha(blob.color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    const cx = width / 2;
    const cy = height / 2;
    const len = Math.max(width, height);
    const gradient = ctx.createLinearGradient(
      cx - (Math.cos(bg.angle) * len) / 2,
      cy - (Math.sin(bg.angle) * len) / 2,
      cx + (Math.cos(bg.angle) * len) / 2,
      cy + (Math.sin(bg.angle) * len) / 2
    );
    for (const stop of bg.stops) gradient.addColorStop(clamp01(stop.offset), stop.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  if (bg.bands.length > 0 && scene.design.background.visualizerGain > 0) {
    paintVisualizer(ctx, scene, bg.bands, scene.design.background.visualizerGain);
  }

  if (bg.scrim > 0) {
    const scrim = ctx.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, `rgba(0,0,0,${bg.scrim * 0.5})`);
    scrim.addColorStop(0.5, `rgba(0,0,0,${bg.scrim})`);
    scrim.addColorStop(1, `rgba(0,0,0,${bg.scrim * 0.75})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  }
}

function paintVisualizer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: Scene, bands: number[], gain: number): void {
  const { width, height } = scene;
  const barCount = bands.length;
  const gap = width * 0.004;
  const barWidth = (width - gap * (barCount - 1)) / barCount;
  const maxHeight = height * 0.16;
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = scene.design.typography.activeColor;
  for (let i = 0; i < barCount; i += 1) {
    const value = clamp01((bands[i] ?? 0) * gain);
    const barHeight = Math.max(2, value * maxHeight);
    const x = i * (barWidth + gap);
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
  }
  ctx.restore();
}

function paintLine(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: Scene, line: LineFrame, state: FrameState): void {
  if (line.opacity <= 0.001) return;
  const fontStack = scene.design.typography.fontStack;

  ctx.save();
  ctx.globalAlpha = clamp01(line.opacity);
  ctx.translate(line.translateX, line.translateY);
  ctx.textBaseline = 'alphabetic';

  const font = `${line.weight} ${line.fontSizePx}px ${fontStack}`;
  ctx.font = font;
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${line.letterSpacingPx}px`;
  }
  ctx.textAlign = 'left';

  for (const row of line.rows) {
    let cursorX = row.originX;

    for (const token of row.tokens) {
      const width = token.widthPx;
      const scale = token.scale;

      ctx.save();
      if (scale !== 1) {
        ctx.translate(cursorX + width / 2, row.baselineY);
        ctx.scale(scale, scale);
        ctx.translate(-(cursorX + width / 2), -row.baselineY);
      }

      // Pass 1: the un-sung portion.
      ctx.shadowColor = line.shadowColor;
      ctx.shadowBlur = line.shadowBlur;
      ctx.shadowOffsetY = line.shadowOffsetY;
      if (line.outlineWidth > 0) {
        ctx.lineWidth = line.outlineWidth;
        ctx.strokeStyle = line.outlineColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(token.text, cursorX, row.baselineY);
      }
      ctx.fillStyle = line.color;
      ctx.fillText(token.text, cursorX, row.baselineY);

      // Pass 2: the sung portion, clipped to the fill width.
      if (token.fill > 0.001) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cursorX - 2, row.baselineY - line.fontSizePx * 1.2, width * token.fill + 2, line.fontSizePx * 1.8);
        ctx.clip();
        ctx.shadowBlur = line.shadowBlur + token.glow * line.fontSizePx * 0.5;
        ctx.shadowColor = withAlpha(line.activeColor, Math.min(1, 0.5 + token.glow * 0.4));
        if (line.outlineWidth > 0) {
          ctx.lineWidth = line.outlineWidth;
          ctx.strokeStyle = line.outlineColor;
          ctx.strokeText(token.text, cursorX, row.baselineY);
        }
        ctx.fillStyle = line.activeColor;
        ctx.fillText(token.text, cursorX, row.baselineY);
        ctx.restore();
      }

      ctx.restore();
      cursorX += width;
    }
  }

  if (line.translation) {
    const lastBaseline = line.rows[line.rows.length - 1]?.baselineY ?? 0;
    ctx.save();
    ctx.globalAlpha = line.translation.opacity;
    ctx.font = `${Math.max(300, line.weight - 200)} ${line.translation.fontSizePx}px ${fontStack}`;
    ctx.fillStyle = withAlpha(line.activeColor, 0.9);
    ctx.textAlign = line.align;
    const x =
      line.align === 'center'
        ? scene.box.contentLeft + scene.box.contentWidth / 2
        : line.align === 'right'
          ? scene.box.contentLeft + scene.box.contentWidth
          : scene.box.contentLeft;
    ctx.fillText(line.translation.text, x, lastBaseline + line.translation.fontSizePx * 1.6);
    ctx.restore();
  }

  ctx.restore();
  void state;
}

function paintCard(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: Scene, card: CardFrame): void {
  const { width, height } = scene;
  ctx.save();
  ctx.globalAlpha = card.opacity;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const titleSize = Math.round(height * 0.075 * card.scale);
  ctx.font = `${scene.design.typography.weight} ${titleSize}px ${scene.design.typography.fontStack}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = titleSize * 0.4;
  if (card.title) ctx.fillText(card.title, width / 2, height / 2 - titleSize * 0.4);

  if (card.subtitle) {
    const subSize = Math.round(titleSize * 0.45);
    ctx.font = `400 ${subSize}px ${scene.design.typography.fontStack}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(card.subtitle, width / 2, height / 2 + titleSize * 0.75);
  }
  ctx.restore();
}

function paintBrand(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: Scene, state: FrameState): void {
  const brand = scene.design.brand;
  if (!brand.enabled || !brand.text.trim() || state.card) return;
  const { width, height } = scene;
  const size = Math.round(height * 0.026);
  const pad = Math.round(height * 0.03);
  ctx.save();
  ctx.globalAlpha = brand.opacity;
  ctx.font = `500 ${size}px ${scene.design.typography.fontStack}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(brand.text).width;
  const positions: Record<string, [number, number, CanvasTextAlign]> = {
    'top-left': [pad, pad, 'left'],
    'top-right': [width - pad, pad, 'right'],
    'bottom-left': [pad, height - pad, 'left'],
    'bottom-right': [width - pad, height - pad, 'right']
  };
  const [x, y, align] = positions[brand.position] ?? positions['bottom-right']!;
  ctx.textAlign = align;
  ctx.fillText(brand.text, x, y);
  void metrics;
  ctx.restore();
}

function paintGuides(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, state: FrameState): void {
  const g = state.guides;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,214,102,0.55)';
  ctx.lineWidth = Math.max(1, state.width / 1920);
  ctx.setLineDash([state.width / 120, state.width / 160]);
  ctx.strokeRect(g.x, g.y, g.width, g.height);
  ctx.restore();
}

function withAlpha(color: string, alpha: number): string {
  const a = clamp01(alpha);
  if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color.slice(1).split('').map((c) => c + c).join('')
      : color.slice(1);
    if (hex.length < 6) return `rgba(255,255,255,${a})`;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  if (color.startsWith('rgba(')) return color.replace(/,[^,]*\)$/, `,${a})`);
  return color;
}

/** Linear easing re-exported for the export loop's progress reporting. */
export const progressEase = linear;
