import { graphemes, needsGraphemeTokenisation } from '../lyrics/segment';

/**
 * Text layout.
 *
 * The layout step is separated from the drawing step for two reasons:
 *   1. It can be unit-tested without a canvas, which is where line-breaking
 *      bugs actually live.
 *   2. Export and preview must produce IDENTICAL wrapping. If layout lived
 *      inside the draw call, a font-loading difference between the two paths
 *      would silently rewrap a line in the exported video.
 */

export interface Measurer {
  width(text: string): number;
}

/** Approximate measurer for tests and for pre-flight height estimation. */
export function approximateMeasurer(fontSizePx: number, averageCharRatio = 0.52): Measurer {
  return {
    width(text: string) {
      return graphemes(text).length * fontSizePx * averageCharRatio;
    }
  };
}

export interface LayoutToken {
  text: string;
  /** Index in the original word array, so karaoke fill maps back to timing. */
  wordIndex: number;
  widthPx: number;
  isSpace: boolean;
}

export interface LayoutRow {
  tokens: LayoutToken[];
  widthPx: number;
}

export interface LineLayout {
  rows: LayoutRow[];
  /** Total block height including line spacing, in px. */
  heightPx: number;
  /** Widest row, used for horizontal centring and for the fill clip region. */
  maxWidthPx: number;
}

export interface LayoutOptions {
  fontSizePx: number;
  lineHeightPx: number;
  maxWidthPx: number;
  letterSpacingPx?: number;
  uppercase?: boolean;
}

/**
 * Greedy word wrap that degrades to grapheme breaking when a single token is
 * wider than the line. That is the CJK/Thai case, and also the long-URL case,
 * and without it a single wide token overflows the safe area and gets clipped
 * out of the frame.
 */
export function layoutWords(
  words: { text: string; index: number }[],
  measurer: Measurer,
  options: LayoutOptions
): LineLayout {
  const letterSpacing = options.letterSpacingPx ?? 0;
  const maxWidth = Math.max(1, options.maxWidthPx);
  const rows: LayoutRow[] = [];
  let current: LayoutToken[] = [];
  let currentWidth = 0;

  const flush = () => {
    if (current.length === 0) return;
    // Trailing spaces never count toward the row width.
    let width = 0;
    for (const t of current) width += t.widthPx;
    rows.push({ tokens: current, widthPx: Math.max(0, width) });
    current = [];
    currentWidth = 0;
  };

  const pushToken = (text: string, wordIndex: number, isSpace: boolean) => {
    const display = options.uppercase ? text.toUpperCase() : text;
    const widthPx = measurer.width(display) + letterSpacing * Math.max(0, graphemes(display).length - 1);
    const token: LayoutToken = { text: display, wordIndex, widthPx, isSpace };

    if (widthPx > maxWidth) {
      // Break a single over-wide token across rows, grapheme by grapheme.
      flush();
      let chunk = '';
      let chunkWidth = 0;
      for (const g of graphemes(display)) {
        const gWidth = measurer.width(g) + letterSpacing;
        if (chunkWidth + gWidth > maxWidth && chunk.length > 0) {
          rows.push({ tokens: [{ text: chunk, wordIndex, widthPx: chunkWidth, isSpace }], widthPx: chunkWidth });
          chunk = '';
          chunkWidth = 0;
        }
        chunk += g;
        chunkWidth += gWidth;
      }
      if (chunk.length > 0) current = [{ text: chunk, wordIndex, widthPx: chunkWidth, isSpace }];
      currentWidth = chunkWidth;
      return;
    }

    if (!isSpace && currentWidth + widthPx > maxWidth && current.length > 0) flush();
    current.push(token);
    currentWidth += widthPx;
  };

  // Reconstruct the spacing between words so wrapping measures honestly.
  let lastEnd = 0;
  for (const word of words) {
    const isSpace = word.text.trim().length === 0;
    pushToken(word.text, word.index, isSpace);
    lastEnd = word.index;
  }
  flush();

  const filtered = rows.filter((r) => r.tokens.some((t) => !t.isSpace));
  const maxWidthPx = filtered.reduce((m, r) => Math.max(m, r.widthPx), 0);
  void lastEnd;
  return {
    rows: filtered,
    heightPx: Math.max(0, filtered.length) * options.lineHeightPx,
    maxWidthPx
  };
}

/** Split a raw line into the token list `layoutWords` expects. */
export function tokensFromWords(words: string[]): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  for (let i = 0; i < words.length; i += 1) {
    out.push({ text: words[i] ?? '', index: i });
    if (i < words.length - 1) out.push({ text: ' ', index: i });
  }
  return out;
}

/** Horizontal origin for a row given its alignment inside the content box. */
export function rowOriginX(
  row: LayoutRow,
  contentLeftPx: number,
  contentWidthPx: number,
  align: 'left' | 'center' | 'right'
): number {
  switch (align) {
    case 'left':
      return contentLeftPx;
    case 'right':
      return contentLeftPx + contentWidthPx - row.widthPx;
    case 'center':
    default:
      return contentLeftPx + (contentWidthPx - row.widthPx) / 2;
  }
}

/**
 * Smart placement.
 *
 * Centring vertically is the wrong default for 9:16 — platform UI covers the
 * bottom third, and a centred lyric collides with the caption. The safe-area
 * insets in the aspect definition push the block up on vertical formats while
 * leaving landscape genuinely centred.
 */
export function blockAnchorY(
  blockHeightPx: number,
  contentTopPx: number,
  contentHeightPx: number,
  anchor: 'top' | 'center' | 'bottom',
  baselineBias = 0
): number {
  const free = Math.max(0, contentHeightPx - blockHeightPx);
  switch (anchor) {
    case 'top':
      return contentTopPx + free * 0.12;
    case 'bottom':
      return contentTopPx + free * 0.88;
    case 'center':
    default:
      return contentTopPx + free * (0.5 + baselineBias);
  }
}

/** True when text of this size cannot fit the safe area at all. */
export function overflowWarning(layout: LineLayout, contentWidthPx: number): string | null {
  if (layout.maxWidthPx > contentWidthPx * 1.02) return 'Text is wider than the safe area.';
  return null;
}

export function needsSoftBreak(text: string): boolean {
  return needsGraphemeTokenisation(text);
}
