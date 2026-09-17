/**
 * Word segmentation.
 *
 * Karaoke fill and per-word timing operate on GRAPHEME CLUSTERS grouped into
 * words — never on UTF-16 code units. Iterating by code unit breaks emoji,
 * combining marks and CJK. `Intl.Segmenter` handles this correctly where it
 * exists; a conservative fallback covers the rest.
 */

export interface Token {
  text: string;
  norm: string;
  /** Character offset in the source line, for highlight mapping. */
  offset: number;
  /** True for whitespace-only separators, which are never highlighted. */
  isSpace: boolean;
}

const HAS_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

let wordSegmenter: Intl.Segmenter | null = null;
let graphemeSegmenter: Intl.Segmenter | null = null;

function getWordSegmenter(): Intl.Segmenter | null {
  if (!HAS_SEGMENTER) return null;
  if (!wordSegmenter) {
    try {
      wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch {
      return null;
    }
  }
  return wordSegmenter;
}

export function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (!HAS_SEGMENTER) return null;
  if (!graphemeSegmenter) {
    try {
      graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    } catch {
      return null;
    }
  }
  return graphemeSegmenter;
}

/** Grapheme clusters, the correct unit for per-character karaoke fill. */
export function graphemes(text: string): string[] {
  const seg = getGraphemeSegmenter();
  if (seg) return [...seg.segment(text)].map((s) => s.segment);
  // Fallback: keep surrogate pairs and combining sequences together.
  return text.match(/\P{M}\p{M}*|\p{M}+/gu) ?? [...text];
}

/**
 * CJK, Thai, Lao, Khmer and Myanmar scripts carry no inter-word spaces, so a
 * space-splitting tokeniser would produce one giant "word" and a karaoke fill
 * that jumps in a single step. Fall back to per-grapheme tokens there.
 */
const NO_SPACE_SCRIPT = /[\u0E00-\u0E7F\u1780-\u17FF\u1000-\u109F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

export function needsGraphemeTokenisation(text: string): boolean {
  return NO_SPACE_SCRIPT.test(text);
}

/**
 * Split a lyric line into highlightable tokens.
 * Whitespace separators are emitted too, so timing interpolation stays linear
 * across the whole line rather than stretching the last word.
 */
export function tokenize(line: string): Token[] {
  const seg = getWordSegmenter();
  const tokens: Token[] = [];
  if (!line) return tokens;

  if (needsGraphemeTokenisation(line)) {
    let offset = 0;
    for (const g of graphemes(line)) {
      tokens.push({ text: g, norm: g, offset, isSpace: /^\s+$/.test(g) });
      offset += g.length;
    }
    return tokens;
  }

  if (seg) {
    for (const { segment, index, isWordLike } of seg.segment(line)) {
      const isSpace = !isWordLike && /^\s+$/.test(segment);
      tokens.push({ text: segment, norm: isSpace ? segment : segment, offset: index, isSpace });
    }
    return tokens;
  }

  let offset = 0;
  for (const part of line.match(/\s+|\S+/g) ?? []) {
    tokens.push({ text: part, norm: part, offset, isSpace: /^\s+$/.test(part) });
    offset += part.length;
  }
  return tokens;
}

/** Only the tokens a karaoke fill should actually colour. */
export function highlightTokens(line: string): Token[] {
  return tokenize(line).filter((t) => !t.isSpace && t.text.trim().length > 0);
}
