/**
 * Needleman–Wunsch global sequence alignment.
 *
 * Used to reconcile an ASR word sequence against the user's true lyric
 * sequence: the ASR supplies timings, the user's text supplies words, and this
 * alignment decides which ASR timing belongs to which lyric word (and which
 * lyric words have no evidence at all).
 *
 * Operates on normalised strings so "don't" matches "dont" and accented text
 * matches its unaccented form.
 */

export interface AlignedPair<A, B> {
  a: A | null;
  b: B | null;
  /** Normalised similarity of the two tokens, 1 === identical. */
  score: number;
}

export interface AlignOptions {
  match?: number;
  mismatch?: number;
  gap?: number;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  // Cheap Levenshtein-derived ratio; these are short tokens.
  const maxLen = Math.max(a.length, b.length);
  if (maxLen > 24) return a.startsWith(b) || b.startsWith(a) ? 0.6 : 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  const dist = prev[b.length] ?? 0;
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Global alignment with affine-free (linear) gap penalty.
 * Scoring: similarity-scaled match reward, fixed gap penalty.
 */
export function alignSequences<A, B>(
  a: A[],
  b: B[],
  keyA: (x: A) => string,
  keyB: (x: B) => string,
  options: AlignOptions = {}
): AlignedPair<A, B>[] {
  const match = options.match ?? 2;
  const gap = options.gap ?? -1;
  const n = a.length;
  const m = b.length;

  if (n === 0 || m === 0) {
    return [
      ...a.map((x) => ({ a: x, b: null, score: 0 })),
      ...b.map((y) => ({ a: null, b: y, score: 0 }))
    ];
  }

  const ka = a.map(keyA);
  const kb = b.map(keyB);

  // F[i][j] = best score aligning a[0..i-1] with b[0..j-1]
  const f: Float64Array = new Float64Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 1; i <= n; i += 1) f[idx(i, 0)] = i * gap;
  for (let j = 1; j <= m; j += 1) f[idx(0, j)] = j * gap;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sim = similarity(ka[i - 1] ?? '', kb[j - 1] ?? '');
      const diag = (f[idx(i - 1, j - 1)] ?? 0) + (sim >= 0.5 ? sim * match : sim * match - (1 - sim) * match);
      const up = (f[idx(i - 1, j)] ?? 0) + gap;
      const left = (f[idx(i, j - 1)] ?? 0) + gap;
      f[idx(i, j)] = Math.max(diag, up, left);
    }
  }

  const out: AlignedPair<A, B>[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sim = similarity(ka[i - 1] ?? '', kb[j - 1] ?? '');
      const diagScore = (f[idx(i - 1, j - 1)] ?? 0) + (sim >= 0.5 ? sim * match : sim * match - (1 - sim) * match);
      if (Math.abs((f[idx(i, j)] ?? 0) - diagScore) < 1e-9) {
        out.push({ a: a[i - 1] ?? null, b: b[j - 1] ?? null, score: sim });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && Math.abs((f[idx(i, j)] ?? 0) - ((f[idx(i - 1, j)] ?? 0) + gap)) < 1e-9) {
      out.push({ a: a[i - 1] ?? null, b: null, score: 0 });
      i -= 1;
      continue;
    }
    if (j > 0) {
      out.push({ a: null, b: b[j - 1] ?? null, score: 0 });
      j -= 1;
      continue;
    }
    break;
  }
  return out.reverse();
}

/** Mean similarity across aligned pairs — a single confidence number. */
export function alignmentScore(pairs: { score: number }[]): number {
  if (pairs.length === 0) return 0;
  const matched = pairs.filter((p) => p.score > 0);
  if (matched.length === 0) return 0;
  const total = matched.reduce((sum, p) => sum + p.score, 0);
  return total / pairs.length;
}
