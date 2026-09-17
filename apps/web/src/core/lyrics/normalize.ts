/**
 * Lyric normalisation.
 *
 * Two forms are maintained for every string:
 *   - `text`  the original characters, displayed and exported verbatim
 *   - `norm`  a matching-only form used by alignment and search
 *
 * The original is never overwritten. This matters because users paste lyrics
 * containing typographic quotes, RTL marks, combining accents and emoji, and a
 * normaliser that mutates in place silently corrupts their file.
 */

/** Canonical composition + whitespace cleanup. Safe for display. */
export function normalizeDisplay(input: string): string {
  return input
    .normalize('NFC')
    // Zero-width and bidi controls that arrive from copy-paste.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    // Collapse runs of spaces; keep newlines meaningful.
    .replace(/[ ]{2,}/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** Matching-only form: case-folded, punctuation-stripped, space-collapsed. */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    // Strip combining marks after decomposing so accented text matches plain.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Structural tags such as `[Chorus]`, `(Verse 2)`, `## Intro`. */
const STRUCTURAL_TAG = /^\s*[\[(#]+\s*([A-Za-z][A-Za-z0-9 _'-]{0,24})\s*[\])]*\s*$/;

export function extractStructuralTag(line: string): string | null {
  const m = STRUCTURAL_TAG.exec(line);
  if (!m) return null;
  return (m[1] ?? '').trim().toUpperCase();
}

/** True when the line is a musical annotation rather than a sung line. */
export function isInstrumentalMarker(line: string): boolean {
  const norm = normalizeForMatch(line);
  if (!norm) return false;
  return /^(instrumental|interlude|break|breakdown|solo|drop|ad lib|adlibs|ad libitum|music|repeat|hook)$/.test(norm)
    || /^\(?(music|instrumental)[^)]*\)?$/.test(norm);
}

/** Parenthesised ad-libs at the end of a line: "Hello (hello!)". */
export function splitAdLib(line: string): { main: string; adLib: string | null } {
  const m = /^(.*?)\s*(\(([^()]{1,60})\))\s*$/.exec(line);
  if (!m) return { main: line, adLib: null };
  const main = (m[1] ?? '').trim();
  if (!main) return { main: line, adLib: null };
  return { main, adLib: (m[3] ?? '').trim() };
}

/** Strip LRC/SRT/VTT residue a user may have pasted by accident. */
export function stripTimingResidue(input: string): string {
  return input
    .replace(/^\s*(WEBVTT.*)$/gm, '')
    .replace(/^\s*NOTE\s.*$/gm, '')
    .replace(/^\s*-->\s*.*$/gm, '')
    .replace(/^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*$/gm, '')
    .replace(/^\s*(\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/gm, '');
}
