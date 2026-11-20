import type { BackgroundSpec, Microseconds, SceneLayout, SceneTransition } from '../types';
import type { CompositionBox, Scene, SceneLine } from './scene';
import { layoutWords, rowOriginX, type Measurer } from './layout';
import { clamp01, easeOutBack, easeOutCubic, easeOutExpo, spring } from './easing';

/**
 * Pure computation and Canvas2D rasterisation for programmatic scene layouts:
 *   `title`   — eyebrow kicker + bold headline + expanding accent rule + subtext
 *   `stat`    — hero metric with smooth numeric count-up + headline + caption
 *   `bullets` — section title + staggered animated list items inside safe area
 *   `quote`   — vertical accent bar + wrapped pull-quote + em-dash attribution
 *   `code`    — terminal/editor window with line numbers, token tint & reveal
 *   `chart`   — horizontal bar chart with spring-animated bars & live readouts
 *
 * Determinism contract (shared with `frame.ts`): every output is a pure
 * function of `(scene, timeUs)` — never `Date.now()` or `Math.random()`.
 */

export type BlockMeasureFn = (fontSizePx: number, weight: number, letterSpacingPx: number) => Measurer;

export interface TextRowSpec {
  text: string;
  x: number;
  baselineY: number;
  widthPx: number;
}

export interface BulletItemFrame {
  index: number;
  rows: TextRowSpec[];
  markerX: number;
  markerY: number;
  opacity: number;
  translateX: number;
}

export interface CodeLineFrame {
  lineNumber: string;
  text: string;
  visibleChars: number;
  showCursor: boolean;
  baselineY: number;
  opacity: number;
}

export interface ChartBarFrame {
  label: string;
  valueText: string;
  fillRatio: number;
  color: string;
  y: number;
  barHeight: number;
  opacity: number;
}

export interface BlockFrame {
  id: string;
  layout: Exclude<SceneLayout, 'caption'>;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  clipWipe: number;
  fitScale: number;
  accentColor: string;
  textColor: string;
  dimColor: string;
  shadowBlur: number;
  shadowColor: string;
  align: 'left' | 'center' | 'right';
  kicker: { text: string; fontSizePx: number; x: number; baselineY: number; opacity: number } | null;
  headline: { rows: TextRowSpec[]; fontSizePx: number; weight: number } | null;
  subtext: { rows: TextRowSpec[]; fontSizePx: number; opacity: number } | null;
  rule: { x: number; y: number; width: number; height: number; opacity: number } | null;
  stat: { text: string; fontSizePx: number; x: number; baselineY: number; scale: number; glow: number } | null;
  bullets: { items: BulletItemFrame[]; fontSizePx: number } | null;
  quote: { barX: number; barY: number; barWidth: number; barHeight: number; markX: number; markY: number; markSizePx: number } | null;
  code: {
    cardX: number;
    cardY: number;
    cardWidth: number;
    cardHeight: number;
    headerHeight: number;
    title: string;
    fontSizePx: number;
    gutterWidth: number;
    paddingX: number;
    lines: CodeLineFrame[];
  } | null;
  chart: {
    trackX: number;
    trackWidth: number;
    labelX: number;
    valueX: number;
    fontSizePx: number;
    bars: ChartBarFrame[];
  } | null;
}

export interface SceneBackgroundResolution {
  base: BackgroundSpec;
  overlay: { spec: BackgroundSpec; transition: SceneTransition; progress: number } | null;
}

const MONO_STACK =
  '"JetBrains Mono", "SF Mono", "Cascadia Mono", ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';

const CHART_PALETTE = ['#38bdf8', '#ffb454', '#a78bfa', '#34d399', '#fb7185', '#facc15'];

/** True when a line uses a structured motion-graphic block rather than a lyric caption. */
export function isBlockLayout(line: SceneLine): line is SceneLine & { scene: { layout: Exclude<SceneLayout, 'caption'> } } {
  const layout = line.scene?.layout;
  return layout !== undefined && layout !== 'caption';
}

/** Merge a per-scene background override cleanly onto the project's default background. */
export function mergeBackgroundSpec(base: BackgroundSpec, override?: Partial<BackgroundSpec>): BackgroundSpec {
  if (!override) return base;
  return {
    kind: override.kind ?? base.kind,
    assetId: override.assetId !== undefined ? override.assetId : base.assetId,
    colors: override.colors && override.colors.length > 0 ? override.colors : base.colors,
    motion: override.motion ?? base.motion,
    scrim: override.scrim ?? base.scrim,
    visualizerBand: base.visualizerBand,
    visualizerGain: base.visualizerGain
  };
}

/**
 * Resolve the active background (and optional transition overlay) at `musicTimeUs`.
 * When no scene defines a per-scene background, returns the project default untouched.
 */
export function resolveSceneBackground(scene: Scene, musicTimeUs: Microseconds): SceneBackgroundResolution {
  const defaultBg = scene.design.background;
  const hasAnyOverride = scene.lines.some((line) => line.scene?.background !== undefined);
  if (!hasAnyOverride) return { base: defaultBg, overlay: null };

  const enterUs = Math.max(120_000, scene.design.motion.enterUs || 320_000);
  const exitUs = Math.max(0, scene.design.motion.exitUs);

  let activeIndex = -1;
  for (let i = 0; i < scene.lines.length; i += 1) {
    const line = scene.lines[i]!;
    const leadStart = line.start - Math.round(enterUs * 0.5);
    const tailEnd = line.end + exitUs;
    if (musicTimeUs >= leadStart && musicTimeUs <= tailEnd) {
      activeIndex = i;
    }
  }

  if (activeIndex < 0) return { base: defaultBg, overlay: null };

  const active = scene.lines[activeIndex]!;
  const targetSpec = mergeBackgroundSpec(defaultBg, active.scene?.background);

  // Determine the background that was visible immediately before this scene.
  let previousSpec = defaultBg;
  for (let i = activeIndex - 1; i >= 0; i -= 1) {
    const prev = scene.lines[i]!;
    if (musicTimeUs - prev.end <= 1_500_000) {
      previousSpec = mergeBackgroundSpec(defaultBg, prev.scene?.background);
      break;
    }
  }

  const transition: SceneTransition = active.scene?.transition ?? (active.scene?.background ? 'fade' : 'none');
  if (transition === 'none' || sameBackground(previousSpec, targetSpec)) {
    return { base: targetSpec, overlay: null };
  }

  const windowStart = active.start - Math.round(enterUs * 0.5);
  const windowDuration = Math.max(120_000, Math.round(enterUs * 1.4));
  const raw = (musicTimeUs - windowStart) / windowDuration;
  if (raw <= 0) return { base: previousSpec, overlay: null };
  if (raw >= 1) return { base: targetSpec, overlay: null };

  return {
    base: previousSpec,
    overlay: {
      spec: targetSpec,
      transition,
      progress: clamp01(raw)
    }
  };
}

function sameBackground(a: BackgroundSpec, b: BackgroundSpec): boolean {
  if (a.kind !== b.kind || a.assetId !== b.assetId || a.scrim !== b.scrim) return false;
  if (a.colors.length !== b.colors.length) return false;
  return a.colors.every((c, i) => c === b.colors[i]);
}

/**
 * Deterministic numeric count-up for `stat` scenes.
 * Preserves currency/unit affixes, thousands separators, signs and decimal precision.
 * Non-numeric values (e.g. "FREE", "∞") pass through verbatim.
 */
export function interpolateStatValue(raw: string, progress: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const t = clamp01(progress);
  if (t >= 0.999) return trimmed;

  const match = /^([^0-9+-]*)([+-]?)(\d[\d,]*)(?:\.(\d+))?(.*)$/.exec(trimmed);
  if (!match || /\d/.test(match[5] ?? '')) return trimmed; // e.g. Romans 8:1 is a reference, not a metric.

  const prefix = match[1] ?? '';
  const sign = match[2] ?? '';
  const intPart = match[3] ?? '0';
  const decPart = match[4];
  const suffix = match[5] ?? '';

  const numeric = Number(`${sign}${intPart.replace(/,/g, '')}${decPart !== undefined ? `.${decPart}` : ''}`);
  if (!Number.isFinite(numeric) || numeric === 0) return trimmed;

  const eased = easeOutExpo(t);
  const current = numeric * eased;
  const decimals = decPart !== undefined ? decPart.length : 0;
  const useCommas = intPart.includes(',');

  const absFixed = Math.abs(current).toFixed(decimals);
  const [curInt = '0', curDec] = absFixed.split('.');
  const formattedInt = useCommas ? curInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : curInt;
  const renderedSign = sign === '+' ? '+' : current < 0 || sign === '-' ? '-' : '';
  const renderedDec = curDec !== undefined ? `.${curDec}` : '';
  return `${prefix}${renderedSign}${formattedInt}${renderedDec}${suffix}`;
}

export function wrapTextRows(
  text: string,
  measure: BlockMeasureFn,
  options: {
    fontSizePx: number;
    weight: number;
    lineHeightPx: number;
    maxWidthPx: number;
    leftPx: number;
    topPx: number;
    align: 'left' | 'center' | 'right';
    uppercase?: boolean;
    letterSpacingPx?: number;
  }
): { rows: TextRowSpec[]; heightPx: number } {
  const clean = text.trim();
  if (!clean) return { rows: [], heightPx: 0 };
  // Static display text wraps at whitespace; don't split references, contractions
  // or hyphenated words just because speech timing would tokenize punctuation.
  const tokens = (clean.match(/\S+|\s+/gu) ?? []).map((text, index) => ({ text, index }));
  if (tokens.length === 0) return { rows: [], heightPx: 0 };
  const measurer = measure(options.fontSizePx, options.weight, options.letterSpacingPx ?? 0);
  const layout = layoutWords(tokens, measurer, {
    fontSizePx: options.fontSizePx,
    lineHeightPx: options.lineHeightPx,
    maxWidthPx: Math.max(1, options.maxWidthPx),
    letterSpacingPx: options.letterSpacingPx ?? 0,
    uppercase: options.uppercase ?? false
  });
  const rows: TextRowSpec[] = layout.rows.map((row, idx) => ({
    text: row.tokens.map((t) => t.text).join(''),
    x: rowOriginX(row, options.leftPx, options.maxWidthPx, options.align),
    baselineY: options.topPx + idx * options.lineHeightPx + options.fontSizePx * 0.82,
    widthPx: row.widthPx
  }));
  return { rows, heightPx: layout.heightPx };
}

function alignedX(left: number, width: number, align: 'left' | 'center' | 'right'): number {
  if (align === 'center') return left + width / 2;
  if (align === 'right') return left + width;
  return left;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return value.toFixed(1);
}

/** Pick an accessible secondary text colour based on the primary foreground colour. */
function deriveDimColor(textColor: string): string {
  const hex = textColor.startsWith('#') ? textColor.slice(1) : '';
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0.74)`;
  }
  return 'rgba(235,239,248,0.74)';
}

/** Pick a crisp accent colour for badges, rules, bullets and charts. */
function resolveAccent(scene: Scene, line: SceneLine): string {
  const explicit = line.scene?.accent?.trim() || scene.design.accent?.trim();
  if (explicit) return explicit;
  const active = scene.design.typography.activeColor.trim().toLowerCase();
  const base = scene.design.typography.color.trim().toLowerCase();
  if (active && active !== '#ffffff' && active !== '#fff' && active !== base) {
    return scene.design.typography.activeColor;
  }
  return '#ffb454';
}

export function buildBlockFrame(
  scene: Scene,
  line: SceneLine,
  musicTimeUs: Microseconds,
  measure: BlockMeasureFn,
  box: CompositionBox,
  envelope: { opacity: number; translateX: number; translateY: number; scale: number; clipWipe: number }
): BlockFrame {
  const spec = line.scene ?? {};
  const layout = (spec.layout && spec.layout !== 'caption' ? spec.layout : 'title') as Exclude<SceneLayout, 'caption'>;
  const typography = scene.design.typography;
  const minDim = Math.min(scene.width, scene.height);
  const textColor = line.style.color ?? typography.color;
  const accentColor = resolveAccent(scene, line);
  const dimColor = deriveDimColor(textColor);
  const spanUs = Math.max(250_000, line.end - line.start);
  const elapsedUs = Math.max(0, musicTimeUs - line.start);
  const sceneProgress = clamp01(elapsedUs / spanUs);

  const defaultAlign: 'left' | 'center' | 'right' =
    layout === 'bullets' || layout === 'quote' || layout === 'chart' || layout === 'code'
      ? 'left'
      : (line.style.align ?? typography.align);

  const base: BlockFrame = {
    id: line.id,
    layout,
    opacity: envelope.opacity,
    translateX: envelope.translateX,
    translateY: envelope.translateY,
    scale: envelope.scale,
    clipWipe: envelope.clipWipe,
    fitScale: 1,
    accentColor,
    textColor,
    dimColor,
    shadowBlur: typography.shadowBlur * (scene.height / 1080),
    shadowColor: typography.shadowColor,
    align: defaultAlign,
    kicker: null,
    headline: null,
    subtext: null,
    rule: null,
    stat: null,
    bullets: null,
    quote: null,
    code: null,
    chart: null
  };

  const kickerText = spec.kicker?.trim().toUpperCase() ?? '';
  const subtextRaw = (spec.subtext ?? line.translation ?? '').trim();
  const kickerSize = Math.max(12, Math.round(minDim * 0.024));

  // Keep every row of a dense scene. Fit the completed, unanimated layout
  // rather than dropping list entries or resizing as they are revealed.
  const groupTopFor = (height: number) => {
    base.fitScale = Math.min(1, box.contentHeight / Math.max(1, height));
    return box.contentTop + Math.max(0, (box.contentHeight - height) / 2);
  };

  /* ---------------------------- TITLE ---------------------------- */
  if (layout === 'title') {
    const titleSize = Math.max(24, Math.round(minDim * Math.min(0.11, (line.style.sizeRatio ?? typography.sizeRatio) * 1.32)));
    const titleWeight = line.style.weight ?? Math.max(700, typography.weight);
    const titleLH = titleSize * 1.12;
    const subSize = Math.max(14, Math.round(titleSize * 0.42));
    const subLH = subSize * 1.38;
    const gap = Math.round(titleSize * 0.36);

    const headMeasure = wrapTextRows(line.text, measure, {
      fontSizePx: titleSize,
      weight: titleWeight,
      lineHeightPx: titleLH,
      maxWidthPx: box.contentWidth * 0.94,
      leftPx: box.contentLeft + box.contentWidth * 0.03,
      topPx: 0,
      align: defaultAlign,
      uppercase: line.style.uppercase ?? typography.uppercase
    });
    const subMeasure = subtextRaw
      ? wrapTextRows(subtextRaw, measure, {
          fontSizePx: subSize,
          weight: 400,
          lineHeightPx: subLH,
          maxWidthPx: box.contentWidth * 0.84,
          leftPx: box.contentLeft + box.contentWidth * 0.08,
          topPx: 0,
          align: defaultAlign
        })
      : { rows: [], heightPx: 0 };

    const kickerBlock = kickerText ? kickerSize + gap : 0;
    const ruleHeight = Math.max(3, Math.round(minDim * 0.0045));
    const ruleBlock = gap * 0.9 + ruleHeight + (subMeasure.rows.length > 0 ? gap * 0.9 : 0);
    const totalH = kickerBlock + headMeasure.heightPx + ruleBlock + subMeasure.heightPx;
    let cursorY = groupTopFor(totalH);

    if (kickerText) {
      base.kicker = {
        text: kickerText,
        fontSizePx: kickerSize,
        x: alignedX(box.contentLeft + box.contentWidth * 0.03, box.contentWidth * 0.94, defaultAlign),
        baselineY: cursorY + kickerSize * 0.85,
        opacity: easeOutCubic(clamp01((elapsedUs + 160_000) / 360_000))
      };
      cursorY += kickerBlock;
    }

    base.headline = {
      fontSizePx: titleSize,
      weight: titleWeight,
      rows: headMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
    };
    cursorY += headMeasure.heightPx + gap * 0.9;

    const ruleProgress = easeOutExpo(clamp01(elapsedUs / Math.min(700_000, spanUs * 0.5)));
    const maxRuleWidth = Math.round(Math.min(box.contentWidth * 0.22, minDim * 0.18));
    const ruleWidth = Math.max(2, Math.round(maxRuleWidth * ruleProgress));
    const ruleX =
      defaultAlign === 'center'
        ? box.contentLeft + (box.contentWidth - ruleWidth) / 2
        : defaultAlign === 'right'
          ? box.contentLeft + box.contentWidth * 0.97 - ruleWidth
          : box.contentLeft + box.contentWidth * 0.03;
    base.rule = { x: ruleX, y: cursorY, width: ruleWidth, height: ruleHeight, opacity: clamp01(ruleProgress * 1.3) };
    cursorY += ruleHeight + gap * 0.9;

    if (subMeasure.rows.length > 0) {
      base.subtext = {
        fontSizePx: subSize,
        opacity: easeOutCubic(clamp01((elapsedUs - 80_000) / 420_000)),
        rows: subMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
      };
    }
    return base;
  }

  /* ----------------------------- STAT ---------------------------- */
  if (layout === 'stat') {
    const rawValue = (spec.value?.trim() || line.text.split(/\s+/)[0] || '100%').trim();
    const countDurationUs = Math.min(950_000, Math.max(300_000, spanUs * 0.45));
    const countProgress = clamp01(elapsedUs / countDurationUs);
    const renderedValue = interpolateStatValue(rawValue, countProgress);

    // Auto-fit stat font so long values like "$1,250,000" stay inside the safe box.
    const idealStatSize = Math.round(minDim * 0.165);
    const charBudget = Math.max(3, rawValue.length * 0.62);
    const statSize = Math.max(36, Math.min(idealStatSize, Math.round((box.contentWidth * 0.88) / charBudget)));
    const headSize = Math.max(18, Math.round(minDim * 0.046));
    const headLH = headSize * 1.24;
    const subSize = Math.max(13, Math.round(minDim * 0.028));
    const subLH = subSize * 1.35;
    const gap = Math.round(minDim * 0.024);

    const headMeasure = wrapTextRows(line.text, measure, {
      fontSizePx: headSize,
      weight: 600,
      lineHeightPx: headLH,
      maxWidthPx: box.contentWidth * 0.88,
      leftPx: box.contentLeft + box.contentWidth * 0.06,
      topPx: 0,
      align: defaultAlign
    });
    const subMeasure = subtextRaw
      ? wrapTextRows(subtextRaw, measure, {
          fontSizePx: subSize,
          weight: 400,
          lineHeightPx: subLH,
          maxWidthPx: box.contentWidth * 0.82,
          leftPx: box.contentLeft + box.contentWidth * 0.09,
          topPx: 0,
          align: defaultAlign
        })
      : { rows: [], heightPx: 0 };

    const kickerBlock = kickerText ? kickerSize + gap : 0;
    const totalH =
      kickerBlock + statSize * 1.05 + gap + headMeasure.heightPx + (subMeasure.rows.length > 0 ? gap * 0.7 + subMeasure.heightPx : 0);
    let cursorY = groupTopFor(totalH);

    if (kickerText) {
      base.kicker = {
        text: kickerText,
        fontSizePx: kickerSize,
        x: alignedX(box.contentLeft, box.contentWidth, defaultAlign),
        baselineY: cursorY + kickerSize * 0.85,
        opacity: 1
      };
      cursorY += kickerBlock;
    }

    const popT = clamp01(elapsedUs / 420_000);
    base.stat = {
      text: renderedValue,
      fontSizePx: statSize,
      x: alignedX(box.contentLeft, box.contentWidth, defaultAlign),
      baselineY: cursorY + statSize * 0.88,
      scale: 0.9 + 0.1 * easeOutBack(popT, 1.15),
      glow: Math.max(0.35, scene.design.karaoke.glow)
    };
    cursorY += statSize * 1.05 + gap;

    base.headline = {
      fontSizePx: headSize,
      weight: 600,
      rows: headMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
    };
    cursorY += headMeasure.heightPx + gap * 0.7;

    if (subMeasure.rows.length > 0) {
      base.subtext = {
        fontSizePx: subSize,
        opacity: easeOutCubic(clamp01((elapsedUs - 120_000) / 400_000)),
        rows: subMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
      };
    }
    return base;
  }

  /* --------------------------- BULLETS --------------------------- */
  if (layout === 'bullets') {
    const rawItems = (spec.items ?? []).map((item) => item.trim()).filter(Boolean);
    const items = rawItems.length > 0 ? rawItems : [line.text];
    const count = items.length;
    const densityScale = count > 5 ? 0.78 : count > 4 ? 0.88 : 1;

    const headSize = Math.max(20, Math.round(minDim * 0.052 * densityScale));
    const headLH = headSize * 1.18;
    const itemSize = Math.max(15, Math.round(minDim * 0.035 * densityScale));
    const itemLH = itemSize * 1.3;
    const itemGap = Math.round(itemSize * 0.52);
    const sectionGap = Math.round(headSize * 0.55);

    const innerWidth = Math.min(box.contentWidth * 0.92, scene.width * 0.78);
    const innerLeft = box.contentLeft + (box.contentWidth - innerWidth) / 2;
    const markerOffset = Math.round(itemSize * 1.55);
    const itemTextWidth = Math.max(80, innerWidth - markerOffset);

    const headMeasure = wrapTextRows(line.text, measure, {
      fontSizePx: headSize,
      weight: 700,
      lineHeightPx: headLH,
      maxWidthPx: innerWidth,
      leftPx: innerLeft,
      topPx: 0,
      align: 'left'
    });

    const measuredItems = items.map((text) =>
      wrapTextRows(text, measure, {
        fontSizePx: itemSize,
        weight: 500,
        lineHeightPx: itemLH,
        maxWidthPx: itemTextWidth,
        leftPx: innerLeft + markerOffset,
        topPx: 0,
        align: 'left'
      })
    );

    const kickerBlock = kickerText ? kickerSize + Math.round(kickerSize * 0.65) : 0;
    const itemsTotalH =
      measuredItems.reduce((sum, m) => sum + m.heightPx, 0) + Math.max(0, count - 1) * itemGap;
    const footer = wrapTextRows(subtextRaw, measure, {
      fontSizePx: kickerSize, weight: 400, lineHeightPx: kickerSize * 1.3,
      maxWidthPx: innerWidth, leftPx: innerLeft, topPx: 0, align: 'left'
    });
    const totalH = kickerBlock + headMeasure.heightPx + sectionGap + itemsTotalH + (footer.rows.length ? itemGap + footer.heightPx : 0);
    let cursorY = groupTopFor(totalH);

    if (kickerText) {
      base.kicker = {
        text: kickerText,
        fontSizePx: kickerSize,
        x: innerLeft,
        baselineY: cursorY + kickerSize * 0.85,
        opacity: 1
      };
      cursorY += kickerBlock;
    }

    base.headline = {
      fontSizePx: headSize,
      weight: 700,
      rows: headMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
    };
    cursorY += headMeasure.heightPx + sectionGap;

    const staggerSpanUs = Math.min(spanUs * 0.58, Math.max(240_000, count * 240_000));
    const itemRevealUs = Math.max(220_000, Math.min(420_000, spanUs * 0.25));

    const bulletFrames: BulletItemFrame[] = measuredItems.map((m, idx) => {
      const delayUs = count > 1 ? (staggerSpanUs * idx) / count : 0;
      const t = easeOutCubic(clamp01((elapsedUs - delayUs) / itemRevealUs));
      const rows = m.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }));
      const markerY = cursorY + itemSize * 0.54;
      cursorY += m.heightPx + itemGap;
      return {
        index: idx + 1,
        rows,
        markerX: innerLeft + itemSize * 0.45,
        markerY,
        opacity: t,
        translateX: (1 - t) * itemSize * 0.65
      };
    });

    if (footer.rows.length) {
      base.subtext = { fontSizePx: kickerSize, opacity: 1, rows: footer.rows.map(r => ({ ...r, baselineY: r.baselineY + cursorY })) };
    }
    base.bullets = { items: bulletFrames, fontSizePx: itemSize };
    return base;
  }

  /* ---------------------------- QUOTE ---------------------------- */
  if (layout === 'quote') {
    const quoteSize = Math.max(20, Math.round(minDim * 0.054));
    const quoteLH = quoteSize * 1.32;
    const attrSize = Math.max(14, Math.round(quoteSize * 0.48));
    const attrLH = attrSize * 1.3;
    const innerWidth = Math.min(box.contentWidth * 0.9, scene.width * 0.76);
    const innerLeft = box.contentLeft + (box.contentWidth - innerWidth) / 2;
    const barWidth = Math.max(4, Math.round(minDim * 0.0055));
    const padLeft = Math.round(quoteSize * 0.85);
    const textLeft = innerLeft + barWidth + padLeft;
    const textWidth = Math.max(80, innerWidth - barWidth - padLeft);

    const headMeasure = wrapTextRows(line.text, measure, {
      fontSizePx: quoteSize,
      weight: 500,
      lineHeightPx: quoteLH,
      maxWidthPx: textWidth,
      leftPx: textLeft,
      topPx: 0,
      align: 'left'
    });
    const attrText = subtextRaw ? (subtextRaw.startsWith('—') || subtextRaw.startsWith('-') ? subtextRaw : `— ${subtextRaw}`) : '';
    const subMeasure = attrText
      ? wrapTextRows(attrText, measure, {
          fontSizePx: attrSize,
          weight: 500,
          lineHeightPx: attrLH,
          maxWidthPx: textWidth,
          leftPx: textLeft,
          topPx: 0,
          align: 'left'
        })
      : { rows: [], heightPx: 0 };

    const gap = Math.round(quoteSize * 0.5);
    const totalH = headMeasure.heightPx + (subMeasure.rows.length > 0 ? gap + subMeasure.heightPx : 0);
    const kickerHeight = kickerText ? kickerSize + gap : 0;
    const groupTop = groupTopFor(totalH + kickerHeight);
    const topY = groupTop + kickerHeight;
    if (kickerText) {
      base.kicker = { text: kickerText, x: textLeft, baselineY: groupTop + kickerSize * 0.85, fontSizePx: kickerSize, opacity: 1 };
    }

    base.headline = {
      fontSizePx: quoteSize,
      weight: 500,
      rows: headMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + topY }))
    };

    if (subMeasure.rows.length > 0) {
      base.subtext = {
        fontSizePx: attrSize,
        opacity: easeOutCubic(clamp01((elapsedUs - 140_000) / 420_000)),
        rows: subMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + topY + headMeasure.heightPx + gap }))
      };
    }

    const barProgress = easeOutExpo(clamp01(elapsedUs / Math.min(650_000, spanUs * 0.5)));
    base.quote = {
      barX: innerLeft,
      barY: topY,
      barWidth,
      barHeight: Math.max(4, Math.round(totalH * barProgress)),
      markX: textLeft - padLeft * 0.15,
      markY: topY - quoteSize * 0.28,
      markSizePx: Math.round(quoteSize * 1.9)
    };
    return base;
  }

  /* ----------------------------- CODE ---------------------------- */
  if (layout === 'code') {
    const codeLines = spec.items && spec.items.length > 0 ? spec.items : line.text.split('\n');
    const longestChars = Math.max(16, ...codeLines.map((c) => c.length));

    const cardWidth = Math.round(Math.min(box.contentWidth * 0.95, scene.width * 0.82));
    const cardX = Math.round(box.contentLeft + (box.contentWidth - cardWidth) / 2);
    const paddingX = Math.round(minDim * 0.026);
    const paddingY = Math.round(minDim * 0.022);
    const headerHeight = Math.round(Math.max(28, minDim * 0.044));

    const idealCodeSize = Math.round(minDim * 0.028);
    const widthFitSize = Math.floor((cardWidth - paddingX * 2) / ((longestChars + 4.5) * 0.61));
    const heightFitSize = Math.floor((box.contentHeight * 0.62 - headerHeight - paddingY * 2) / Math.max(1, codeLines.length * 1.52));
    const codeSize = Math.max(11, Math.min(idealCodeSize, widthFitSize, heightFitSize));
    const codeLH = Math.round(codeSize * 1.52);
    const gutterWidth = Math.round(codeSize * 2.3);
    const cardHeight = headerHeight + paddingY * 2 + codeLines.length * codeLH;

    const showHeadline = spec.items && spec.items.length > 0 && line.text.trim().length > 0;
    const headSize = Math.max(18, Math.round(minDim * 0.038));
    const headLH = headSize * 1.2;
    const subSize = Math.max(13, Math.round(minDim * 0.025));
    const subLH = subSize * 1.3;
    const gap = Math.round(minDim * 0.022);

    const headMeasure = showHeadline
      ? wrapTextRows(line.text, measure, {
          fontSizePx: headSize,
          weight: 600,
          lineHeightPx: headLH,
          maxWidthPx: cardWidth,
          leftPx: cardX,
          topPx: 0,
          align: 'left'
        })
      : { rows: [], heightPx: 0 };

    const subMeasure = subtextRaw
      ? wrapTextRows(subtextRaw, measure, {
          fontSizePx: subSize,
          weight: 400,
          lineHeightPx: subLH,
          maxWidthPx: cardWidth,
          leftPx: cardX,
          topPx: 0,
          align: 'left'
        })
      : { rows: [], heightPx: 0 };

    const totalH =
      (headMeasure.rows.length > 0 ? headMeasure.heightPx + gap : 0) +
      cardHeight +
      (subMeasure.rows.length > 0 ? gap * 0.8 + subMeasure.heightPx : 0);
    let cursorY = Math.round(groupTopFor(totalH));

    if (headMeasure.rows.length > 0) {
      base.headline = {
        fontSizePx: headSize,
        weight: 600,
        rows: headMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
      };
      cursorY += headMeasure.heightPx + gap;
    }

    const cardY = cursorY;
    const revealWindow = clamp01(sceneProgress / 0.62);
    const totalChars = Math.max(1, codeLines.reduce((sum, c) => sum + Math.max(1, c.length), 0));
    const revealedBudget = Math.round(totalChars * easeOutCubic(revealWindow));
    let remaining = revealedBudget;

    const renderedLines: CodeLineFrame[] = codeLines.map((text, idx) => {
      const len = Math.max(1, text.length);
      const visibleChars = Math.max(0, Math.min(text.length, remaining));
      const isTyping = remaining > 0 && remaining < len;
      remaining -= len;
      return {
        lineNumber: String(idx + 1).padStart(2, '0'),
        text,
        visibleChars,
        showCursor: isTyping,
        baselineY: cardY + headerHeight + paddingY + idx * codeLH + Math.round(codeSize * 0.84),
        opacity: visibleChars > 0 || text.length === 0 && remaining >= 0 ? 1 : 0.16
      };
    });

    base.code = {
      cardX,
      cardY,
      cardWidth,
      cardHeight,
      headerHeight,
      title: spec.kicker?.trim() || 'scene.json',
      fontSizePx: codeSize,
      gutterWidth,
      paddingX,
      lines: renderedLines
    };

    cursorY += cardHeight + gap * 0.8;
    if (subMeasure.rows.length > 0) {
      base.subtext = {
        fontSizePx: subSize,
        opacity: 0.9,
        rows: subMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
      };
    }
    return base;
  }

  /* ---------------------------- CHART ---------------------------- */
  const bars = spec.chart && spec.chart.length > 0 ? spec.chart : [{ label: 'Progress', value: 100 }];
  const maxVal = Math.max(1e-6, ...bars.map((b) => Math.max(0, b.value)));

  const chartWidth = Math.round(Math.min(box.contentWidth * 0.92, scene.width * 0.78));
  const chartLeft = Math.round(box.contentLeft + (box.contentWidth - chartWidth) / 2);
  const headSize = Math.max(20, Math.round(minDim * 0.048));
  const headLH = headSize * 1.18;
  const labelSize = Math.max(13, Math.round(minDim * 0.026));
  const subSize = Math.max(12, Math.round(minDim * 0.024));
  const subLH = subSize * 1.3;
  const gap = Math.round(minDim * 0.024);

  const density = bars.length > 5 ? 0.72 : bars.length > 4 ? 0.85 : 1;
  const barHeight = Math.max(14, Math.round(minDim * 0.032 * density));
  const rowStride = Math.round(labelSize * 1.45 + barHeight + minDim * 0.018 * density);

  const headMeasure = wrapTextRows(line.text, measure, {
    fontSizePx: headSize,
    weight: 700,
    lineHeightPx: headLH,
    maxWidthPx: chartWidth,
    leftPx: chartLeft,
    topPx: 0,
    align: 'left'
  });
  const subMeasure = subtextRaw
    ? wrapTextRows(subtextRaw, measure, {
        fontSizePx: subSize,
        weight: 400,
        lineHeightPx: subLH,
        maxWidthPx: chartWidth,
        leftPx: chartLeft,
        topPx: 0,
        align: 'left'
      })
    : { rows: [], heightPx: 0 };

  const kickerBlock = kickerText ? kickerSize + Math.round(kickerSize * 0.6) : 0;
  const barsTotalH = bars.length * rowStride;
  const totalH =
    kickerBlock + headMeasure.heightPx + gap + barsTotalH + (subMeasure.rows.length > 0 ? gap * 0.6 + subMeasure.heightPx : 0);
  let cursorY = Math.round(groupTopFor(totalH));

  if (kickerText) {
    base.kicker = {
      text: kickerText,
      fontSizePx: kickerSize,
      x: chartLeft,
      baselineY: cursorY + kickerSize * 0.85,
      opacity: 1
    };
    cursorY += kickerBlock;
  }

  base.headline = {
    fontSizePx: headSize,
    weight: 700,
    rows: headMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
  };
  cursorY += headMeasure.heightPx + gap;

  const barFrames: ChartBarFrame[] = bars.map((datum, idx) => {
    const delayUs = bars.length > 1 ? (idx * Math.min(spanUs * 0.42, 600_000)) / bars.length : 0;
    const growT = clamp01((elapsedUs - delayUs) / Math.min(820_000, Math.max(320_000, spanUs * 0.45)));
    const eased = clamp01(spring(growT, 7.5, 0.9));
    const norm = clamp01(Math.max(0, datum.value) / maxVal);
    const color = datum.color?.trim() || (idx === 0 && spec.accent ? accentColor : CHART_PALETTE[idx % CHART_PALETTE.length]!);
    const y = cursorY + idx * rowStride;
    return {
      label: datum.label,
      valueText: formatNumber(datum.value * easeOutExpo(growT)),
      fillRatio: clamp01(norm * eased),
      color,
      y,
      barHeight,
      opacity: easeOutCubic(clamp01(growT * 1.8))
    };
  });

  base.chart = {
    trackX: chartLeft,
    trackWidth: chartWidth,
    labelX: chartLeft,
    valueX: chartLeft + chartWidth,
    fontSizePx: labelSize,
    bars: barFrames
  };

  cursorY += barsTotalH + gap * 0.6;
  if (subMeasure.rows.length > 0) {
    base.subtext = {
      fontSizePx: subSize,
      opacity: 0.82,
      rows: subMeasure.rows.map((r) => ({ ...r, baselineY: r.baselineY + cursorY }))
    };
  }
  return base;
}

/* ------------------------------------------------------------------ *
 * CANVAS RASTERISATION
 * ------------------------------------------------------------------ */

function drawRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Paint lightweight deterministic syntax tinting on a monospace code line. */
function paintCodeTokens(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  baselineY: number,
  accentColor: string
): void {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    ctx.fillStyle = 'rgba(148,163,184,0.75)';
    ctx.fillText(text, x, baselineY);
    return;
  }

  // Split strings, numbers, keywords and punctuation deterministically.
  const tokenRe = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|async|await|function|return|import|from|for|in|true|false|null|def)\b|-?\b\d+(?:\.\d+)?\b|[{}[\]:,])/g;
  let cursorX = x;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const drawSegment = (segment: string, color: string) => {
    if (!segment) return;
    ctx.fillStyle = color;
    ctx.fillText(segment, cursorX, baselineY);
    cursorX += ctx.measureText(segment).width;
  };

  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      drawSegment(text.slice(lastIndex, m.index), '#e2e8f0');
    }
    const tok = m[0];
    const after = text.slice(m.index + tok.length).trimStart();
    if ((tok.startsWith('"') || tok.startsWith("'")) && after.startsWith(':')) {
      drawSegment(tok, '#7dd3fc'); // JSON key
    } else if (tok.startsWith('"') || tok.startsWith("'")) {
      drawSegment(tok, '#86efac'); // string literal
    } else if (/^-?\d/.test(tok)) {
      drawSegment(tok, accentColor); // number
    } else if (/^[{}[\]:,]$/.test(tok)) {
      drawSegment(tok, 'rgba(148,163,184,0.85)');
    } else {
      drawSegment(tok, '#c4b5fd'); // keyword
    }
    lastIndex = m.index + tok.length;
  }
  if (lastIndex < text.length) {
    drawSegment(text.slice(lastIndex), '#e2e8f0');
  }
}

export function paintBlock(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scene: Scene,
  block: BlockFrame
): void {
  if (block.opacity <= 0.001) return;
  const fontStack = scene.design.typography.fontStack;
  const cx = scene.width / 2;
  const cy = scene.height / 2;

  ctx.save();
  ctx.globalAlpha = clamp01(block.opacity);
  ctx.translate(block.translateX, block.translateY);
  if (block.scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(block.scale, block.scale);
    ctx.translate(-cx, -cy);
  }
  if (block.clipWipe < 0.999) {
    ctx.beginPath();
    ctx.rect(0, 0, scene.width * clamp01(block.clipWipe), scene.height);
    ctx.clip();
  }
  if (block.fitScale < 1) {
    const x = scene.box.contentLeft + scene.box.contentWidth / 2;
    const y = scene.box.contentTop;
    ctx.translate(x, y);
    ctx.scale(block.fitScale, block.fitScale);
    ctx.translate(-x, -y);
  }
  ctx.textBaseline = 'alphabetic';

  // Kicker label
  if (block.kicker && block.kicker.opacity > 0.001) {
    ctx.save();
    ctx.globalAlpha *= block.kicker.opacity;
    ctx.font = `700 ${block.kicker.fontSizePx}px ${fontStack}`;
    if ('letterSpacing' in ctx) {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(block.kicker.fontSizePx * 0.14)}px`;
    }
    ctx.fillStyle = block.accentColor;
    ctx.textAlign = block.align;
    ctx.fillText(block.kicker.text, block.kicker.x, block.kicker.baselineY, scene.box.contentWidth * 0.85);
    ctx.restore();
  }

  // Quote chrome
  if (block.quote) {
    ctx.save();
    ctx.fillStyle = block.accentColor;
    drawRoundedRect(ctx, block.quote.barX, block.quote.barY, block.quote.barWidth, block.quote.barHeight, block.quote.barWidth / 2);
    ctx.fill();
    ctx.globalAlpha *= 0.18;
    ctx.font = `700 ${block.quote.markSizePx}px Georgia, serif`;
    ctx.fillStyle = block.accentColor;
    ctx.textAlign = 'left';
    ctx.fillText('“', block.quote.markX, block.quote.markY + block.quote.markSizePx * 0.72);
    ctx.restore();
  }

  // Stat hero metric
  if (block.stat) {
    ctx.save();
    if (block.stat.scale !== 1) {
      ctx.translate(block.stat.x, block.stat.baselineY - block.stat.fontSizePx * 0.35);
      ctx.scale(block.stat.scale, block.stat.scale);
      ctx.translate(-block.stat.x, -(block.stat.baselineY - block.stat.fontSizePx * 0.35));
    }
    ctx.font = `800 ${block.stat.fontSizePx}px ${fontStack}`;
    ctx.textAlign = block.align;
    ctx.fillStyle = block.accentColor;
    ctx.shadowColor = block.accentColor;
    ctx.shadowBlur = block.stat.fontSizePx * 0.24 * block.stat.glow;
    ctx.fillText(block.stat.text, block.stat.x, block.stat.baselineY);
    ctx.restore();
  }

  // Headline rows
  if (block.headline && block.headline.rows.length > 0) {
    ctx.save();
    ctx.font = `${block.headline.weight} ${block.headline.fontSizePx}px ${fontStack}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = block.textColor;
    ctx.shadowColor = block.shadowColor;
    ctx.shadowBlur = block.shadowBlur;
    for (const row of block.headline.rows) {
      ctx.fillText(row.text, row.x, row.baselineY);
    }
    ctx.restore();
  }

  // Title accent rule
  if (block.rule && block.rule.opacity > 0.001) {
    ctx.save();
    ctx.globalAlpha *= block.rule.opacity;
    ctx.fillStyle = block.accentColor;
    drawRoundedRect(ctx, block.rule.x, block.rule.y, block.rule.width, block.rule.height, block.rule.height / 2);
    ctx.fill();
    ctx.restore();
  }

  // Bullet items
  if (block.bullets) {
    const bulletRadius = Math.max(3, block.bullets.fontSizePx * 0.2);
    for (const item of block.bullets.items) {
      if (item.opacity <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha *= item.opacity;
      ctx.translate(item.translateX, 0);

      // Accent dot marker
      ctx.fillStyle = block.accentColor;
      ctx.beginPath();
      ctx.arc(item.markerX, item.markerY, bulletRadius, 0, Math.PI * 2);
      ctx.fill();

      // Item copy
      ctx.font = `500 ${block.bullets.fontSizePx}px ${fontStack}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = block.textColor;
      ctx.shadowColor = block.shadowColor;
      ctx.shadowBlur = block.shadowBlur * 0.6;
      for (const row of item.rows) {
        ctx.fillText(row.text, row.x, row.baselineY);
      }
      ctx.restore();
    }
  }

  // Code card
  if (block.code) {
    const c = block.code;
    const radius = Math.max(8, Math.round(c.fontSizePx * 0.6));
    ctx.save();

    // Window background + subtle depth
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = Math.round(c.fontSizePx * 1.4);
    ctx.shadowOffsetY = Math.round(c.fontSizePx * 0.35);
    ctx.fillStyle = 'rgba(10, 13, 22, 0.9)';
    drawRoundedRect(ctx, c.cardX, c.cardY, c.cardWidth, c.cardHeight, radius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Window border
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = Math.max(1, scene.height / 720);
    ctx.stroke();

    // Header bar separator
    ctx.beginPath();
    ctx.moveTo(c.cardX, c.cardY + c.headerHeight);
    ctx.lineTo(c.cardX + c.cardWidth, c.cardY + c.headerHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    // Window controls
    const dotR = Math.max(3, Math.round(c.headerHeight * 0.14));
    const dotY = c.cardY + c.headerHeight / 2;
    const dotColors = ['#ff5f56', '#ffbd2e', '#27c93f'];
    dotColors.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(c.cardX + c.paddingX + i * dotR * 3.1, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
    });

    // Filename / language badge
    ctx.font = `500 ${Math.max(10, Math.round(c.fontSizePx * 0.78))}px ${MONO_STACK}`;
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.title, c.cardX + c.cardWidth - c.paddingX, dotY);

    // Clip code lines strictly inside the window
    ctx.beginPath();
    ctx.rect(c.cardX + 2, c.cardY + c.headerHeight, c.cardWidth - 4, c.cardHeight - c.headerHeight - 2);
    ctx.clip();

    ctx.textBaseline = 'alphabetic';
    ctx.font = `500 ${c.fontSizePx}px ${MONO_STACK}`;
    const numX = c.cardX + c.paddingX;
    const codeX = numX + c.gutterWidth;

    for (const ln of c.lines) {
      ctx.save();
      ctx.globalAlpha *= ln.opacity;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(100,116,139,0.72)';
      ctx.fillText(ln.lineNumber, numX, ln.baselineY);
      const slice = ln.text.slice(0, ln.visibleChars);
      if (slice.length > 0) {
        paintCodeTokens(ctx, slice, codeX, ln.baselineY, block.accentColor);
      }
      if (ln.showCursor) {
        const w = ctx.measureText(slice).width;
        ctx.fillStyle = block.accentColor;
        ctx.fillRect(codeX + w + 2, ln.baselineY - c.fontSizePx * 0.8, Math.max(2, c.fontSizePx * 0.45), c.fontSizePx * 0.98);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Horizontal bar chart
  if (block.chart) {
    const ch = block.chart;
    const barRadius = Math.max(4, Math.round(ch.fontSizePx * 0.35));
    for (const bar of ch.bars) {
      if (bar.opacity <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha *= bar.opacity;

      const labelBaseline = bar.y + ch.fontSizePx * 0.88;
      ctx.font = `600 ${ch.fontSizePx}px ${fontStack}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = block.textColor;
      ctx.fillText(bar.label, ch.labelX, labelBaseline, Math.max(1, ch.trackWidth - ch.fontSizePx * (bar.valueText.length + 1)));

      ctx.font = `700 ${ch.fontSizePx}px ${MONO_STACK}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = bar.color;
      ctx.fillText(bar.valueText, ch.valueX, labelBaseline);

      const trackY = bar.y + Math.round(ch.fontSizePx * 1.22);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      drawRoundedRect(ctx, ch.trackX, trackY, ch.trackWidth, bar.barHeight, barRadius);
      ctx.fill();

      const fillW = Math.round(ch.trackWidth * clamp01(bar.fillRatio));
      if (fillW > 1) {
        ctx.fillStyle = bar.color;
        drawRoundedRect(ctx, ch.trackX, trackY, Math.max(barRadius * 2, fillW), bar.barHeight, barRadius);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Subtext / caption / attribution
  if (block.subtext && block.subtext.rows.length > 0 && block.subtext.opacity > 0.001) {
    ctx.save();
    ctx.globalAlpha *= block.subtext.opacity;
    ctx.font = `400 ${block.subtext.fontSizePx}px ${fontStack}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = block.dimColor;
    for (const row of block.subtext.rows) {
      ctx.fillText(row.text, row.x, row.baselineY);
    }
    ctx.restore();
  }

  ctx.restore();
}
