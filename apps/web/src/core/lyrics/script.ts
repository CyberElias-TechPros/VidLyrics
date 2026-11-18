import type { Line, Microseconds, SceneVisual } from '../types';
import { createLine, createWord } from '../project/factory';
import { isInstrumentalMarker, normalizeDisplay } from './normalize';
import { highlightTokens } from './segment';
import { usFromMs } from '../time';

/**
 * Script-to-video scene splitting and speech-driven timing.
 *
 * Pure module — runs in the editor, inside tests, and from the spec compiler.
 * Supports plain prose (split by sentence, line or paragraph), two-speaker
 * dialogue (`A:` / `B:` / `Host:` / `Guest:`), markdown bullet groups,
 * blockquotes, fenced code blocks and `[Title]` scene tags.
 */

export type ScriptSplitMode = 'sentences' | 'lines' | 'paragraphs';

export interface ScriptSplitOptions {
  mode?: ScriptSplitMode;
  wordsPerMinute?: number;
  pauseMs?: number;
  leadInMs?: number;
  minSceneMs?: number;
}

export interface MeasuredVoiceCue {
  lineId: string;
  startUs: Microseconds;
  endUs: Microseconds;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie', 'fig', 'no', 'vol', 'inc', 'ltd', 'co'
]);

const SPEAKER_PREFIX = /^(?:(A|B)|(host|narrator|speaker\s*1)|(guest|co-?host|speaker\s*2))\s*:\s+(.+)$/i;
const BULLET_LINE = /^(?:[-*•]|\d+[.)])\s+(.+)$/;
const TITLE_TAG = /^\[(title|hook|intro|outro)(?:\s*:\s*([^\]]+))?\]\s*(.*)$/i;
const STAT_TAG = /^\[stat\s*:\s*([^\]]+)\]\s*(.+)$/i;

/** Split prose into clean sentences without breaking common abbreviations or decimals. */
export function splitIntoSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Consume repeated terminal punctuation ("?!" or "...") plus closing quotes/parens.
    let end = i + 1;
    while (end < cleaned.length && /[.!?'"”’)\]]/.test(cleaned[end] ?? '')) end += 1;

    const atEnd = end >= cleaned.length;
    const nextChar = cleaned[end] ?? '';
    if (!atEnd && !/\s/.test(nextChar)) continue;

    // Protect decimals like 3.14 and versions like v2.0.
    if (ch === '.' && /\d/.test(cleaned[i - 1] ?? '') && /\d/.test(cleaned[i + 1] ?? '')) continue;

    // Protect common abbreviations ("Dr. Smith", "vs. cloud") and e.g. / i.e.
    if (ch === '.') {
      const before = cleaned.slice(start, i);
      const wordMatch = /([A-Za-z.]+)$/.exec(before);
      const word = (wordMatch?.[1] ?? '').replace(/\./g, '').toLowerCase();
      if (ABBREVIATIONS.has(word) || (word.length === 1 && /[A-Z]/.test(wordMatch?.[1] ?? ''))) {
        i = end - 1;
        continue;
      }
    }

    const piece = cleaned.slice(start, end).trim();
    if (piece) sentences.push(piece);
    start = end;
    while (start < cleaned.length && /\s/.test(cleaned[start] ?? '')) start += 1;
    i = start - 1;
  }

  const tail = cleaned.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function extractSpeaker(raw: string): { speaker: 'A' | 'B' | null; text: string } {
  const match = SPEAKER_PREFIX.exec(raw.trim());
  if (!match) return { speaker: null, text: raw.trim() };
  const direct = match[1]?.toUpperCase();
  const speaker: 'A' | 'B' = direct === 'B' || Boolean(match[3]) ? 'B' : 'A';
  return { speaker, text: (match[4] ?? '').trim() };
}

/**
 * Estimate a natural spoken/readable duration for a single scene in microseconds.
 * Accounts for word count, punctuation pauses, and extra items in lists/charts/code.
 */
export function estimateSceneDurationUs(
  text: string,
  options: { wordsPerMinute?: number; minSceneMs?: number; scene?: SceneVisual } = {}
): Microseconds {
  const wpm = Math.max(60, Math.min(360, options.wordsPerMinute ?? 155));
  const minUs = usFromMs(Math.max(500, options.minSceneMs ?? 1600));
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const commas = (text.match(/[,;:—–]/g) ?? []).length;
  const stops = (text.match(/[.!?]/g) ?? []).length;

  let seconds = (words / wpm) * 60 + commas * 0.14 + Math.max(0, stops - 1) * 0.24 + 0.35;

  const scene = options.scene;
  if (scene?.layout === 'bullets' && scene.items?.length) {
    const itemWords = scene.items.join(' ').split(/\s+/).filter(Boolean).length;
    seconds = Math.max(seconds, ((words + itemWords * 0.65) / wpm) * 60 + scene.items.length * 0.35);
  } else if (scene?.layout === 'code' && scene.items?.length) {
    seconds = Math.max(seconds, 1.8 + scene.items.length * 0.55);
  } else if (scene?.layout === 'chart' && scene.chart?.length) {
    seconds = Math.max(seconds, 2.0 + scene.chart.length * 0.55);
  } else if (scene?.layout === 'stat') {
    seconds = Math.max(seconds, 2.4);
  } else if (scene?.layout === 'title') {
    const subWords = (scene.subtext ?? '').split(/\s+/).filter(Boolean).length;
    seconds = Math.max(seconds, 2.2 + (subWords / wpm) * 45);
  }

  return Math.max(minUs, Math.round(seconds * 1_000_000));
}

/** Populate monotonic word timings across `[startUs, endUs]` weighted by token length. */
export function buildTimedWords(
  lineId: string,
  text: string,
  startUs: Microseconds,
  endUs: Microseconds,
  source: Line['source'],
  confidence: number
): Line['words'] {
  const tokens = highlightTokens(text);
  if (tokens.length === 0) return [];
  const weights = tokens.map((t) => Math.max(1, t.text.trim().length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, endUs - startUs);
  let cursor = startUs;
  return tokens.map((token, index) => {
    const share = Math.round((span * (weights[index] ?? 1)) / totalWeight);
    const wStart = Math.round(cursor);
    const wEnd = index === tokens.length - 1 ? Math.round(endUs) : Math.round(cursor + share);
    cursor = wEnd;
    const word = createWord(lineId, token.text.trim(), index, wStart, Math.max(wStart, wEnd));
    word.source = source;
    word.confidence = confidence;
    return word;
  });
}

/** Assign back-to-back spoken durations to an array of scene lines. */
export function timeScenesSequentially(
  lines: Line[],
  options: { wordsPerMinute?: number; pauseMs?: number; leadInMs?: number; minSceneMs?: number } = {}
): { lines: Line[]; totalDurationUs: Microseconds } {
  const pauseUs = usFromMs(Math.max(0, Math.min(5000, options.pauseMs ?? 300)));
  const leadInUs = usFromMs(Math.max(0, Math.min(5000, options.leadInMs ?? 150)));
  let cursorUs = leadInUs;

  const timed = lines.map((line, index) => {
    if (line.locked && line.end > line.start) {
      cursorUs = Math.max(cursorUs, line.end + pauseUs);
      return line;
    }
    const durationUs = estimateSceneDurationUs(line.text, {
      wordsPerMinute: options.wordsPerMinute,
      minSceneMs: options.minSceneMs,
      scene: line.scene
    });
    const start = cursorUs;
    const end = start + durationUs;
    cursorUs = end + (index < lines.length - 1 ? pauseUs : usFromMs(250));
    return {
      ...line,
      start,
      end,
      source: 'estimate' as const,
      confidence: 0.75,
      words: buildTimedWords(line.id, line.text, start, end, 'estimate', 0.75)
    };
  });

  return { lines: timed, totalDurationUs: Math.max(cursorUs, timed[timed.length - 1]?.end ?? 0) };
}

/** Parse a paragraph block, promoting markdown lists, quotes, code fences and tags into rich scenes. */
function parseStructuredBlock(block: string, mode: ScriptSplitMode): Line[] {
  const rawLines = block.split('\n').map((l) => l.trimEnd());
  const nonEmpty = rawLines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return [];

  // Fenced code block: optional headline above ```lang ... ```
  const fenceStart = rawLines.findIndex((l) => l.trim().startsWith('```'));
  if (fenceStart !== -1) {
    const fenceLine = rawLines[fenceStart]!.trim();
    const lang = fenceLine.slice(3).trim() || 'code';
    const fenceEnd = rawLines.findIndex((l, idx) => idx > fenceStart && l.trim().startsWith('```'));
    const codeSlice = rawLines.slice(fenceStart + 1, fenceEnd === -1 ? rawLines.length : fenceEnd);
    const heading = rawLines.slice(0, fenceStart).map((l) => l.trim()).filter(Boolean).join(' ');
    const caption = fenceEnd !== -1 ? rawLines.slice(fenceEnd + 1).map((l) => l.trim()).filter(Boolean).join(' ') : '';
    const spoken = heading || caption || codeSlice[0]?.trim() || 'Code example';
    return [
      createLine(spoken, {
        scene: {
          layout: 'code',
          kicker: lang,
          items: codeSlice.length > 0 ? codeSlice : [spoken],
          ...(caption && heading ? { subtext: caption } : {})
        }
      })
    ];
  }

  // Markdown bullet list (with optional heading on line 0)
  const bulletMatches = nonEmpty.map((l) => BULLET_LINE.exec(l));
  const bulletCount = bulletMatches.filter(Boolean).length;
  if (bulletCount >= 2 && (bulletMatches[0] !== null || (bulletMatches[1] !== null && bulletCount === nonEmpty.length - 1))) {
    const hasHeading = bulletMatches[0] === null;
    const headingRaw = hasHeading ? nonEmpty[0]!.replace(/^#+\s*/, '').replace(/:$/, '').trim() : 'Key Points';
    const items = nonEmpty
      .slice(hasHeading ? 1 : 0)
      .map((l) => BULLET_LINE.exec(l)?.[1]?.trim() ?? l)
      .filter(Boolean);
    const { speaker, text } = extractSpeaker(headingRaw);
    return [createLine(text, { speaker, scene: { layout: 'bullets', items } })];
  }

  // Blockquote (`> Quote text` + optional `— Author` on last line, with or without `>`)
  const quoteLinesOk =
    nonEmpty[0]!.startsWith('>') &&
    nonEmpty.every((l, idx) => l.startsWith('>') || (idx === nonEmpty.length - 1 && /^(?:—|--|-)\s*\S/.test(l)));
  if (quoteLinesOk) {
    const stripped = nonEmpty.map((l) => l.replace(/^>\s?/, '').trim()).filter(Boolean);
    const last = stripped[stripped.length - 1] ?? '';
    const hasAuthor = stripped.length > 1 && /^(?:—|--|-)\s*\S/.test(last);
    const quoteBody = (hasAuthor ? stripped.slice(0, -1) : stripped).join(' ').replace(/^[“"]+|[”"]+$/g, '').trim();
    const author = hasAuthor ? last.replace(/^(?:—|--|-)\s*/, '').trim() : undefined;
    if (quoteBody) {
      return [createLine(quoteBody, { scene: { layout: 'quote', ...(author ? { subtext: author } : {}) } })];
    }
  }

  // Explicit `[Title]` or `[Stat: 100%]` tags and markdown `# Headings`
  if (nonEmpty.length <= 2) {
    const titleMatch = TITLE_TAG.exec(nonEmpty[0]!);
    if (titleMatch) {
      const kicker = titleMatch[2]?.trim();
      const headline = (titleMatch[3]?.trim() || nonEmpty[1] || '').trim();
      const subtext = titleMatch[3]?.trim() && nonEmpty[1] ? nonEmpty[1].trim() : undefined;
      if (headline) {
        return [
          createLine(headline, {
            scene: { layout: 'title', ...(kicker ? { kicker } : {}), ...(subtext ? { subtext } : {}) }
          })
        ];
      }
    }
    const statMatch = STAT_TAG.exec(nonEmpty[0]!);
    if (statMatch) {
      const value = statMatch[1]!.trim();
      const headline = statMatch[2]!.trim();
      const subtext = nonEmpty[1]?.trim();
      return [
        createLine(headline, {
          scene: { layout: 'stat', value, ...(subtext ? { subtext } : {}) }
        })
      ];
    }
    if (/^#{1,2}\s+\S/.test(nonEmpty[0]!)) {
      const headline = nonEmpty[0]!.replace(/^#{1,2}\s+/, '').trim();
      const subtext = nonEmpty[1]?.trim();
      return [createLine(headline, { scene: { layout: 'title', ...(subtext ? { subtext } : {}) } })];
    }
  }

  // Plain prose splitting according to mode
  if (mode === 'paragraphs') {
    const joined = nonEmpty.join(' ');
    const { speaker, text } = extractSpeaker(joined);
    return text ? [createLine(text, { speaker })] : [];
  }

  if (mode === 'lines') {
    return nonEmpty
      .map((raw) => {
        const statMatch = STAT_TAG.exec(raw);
        if (statMatch) {
          return createLine(statMatch[2]!.trim(), { scene: { layout: 'stat', value: statMatch[1]!.trim() } });
        }
        if (/^#{1,2}\s+\S/.test(raw)) {
          return createLine(raw.replace(/^#{1,2}\s+/, '').trim(), { scene: { layout: 'title' } });
        }
        const { speaker, text } = extractSpeaker(raw);
        return text ? createLine(text, { speaker }) : null;
      })
      .filter((line): line is Line => line !== null);
  }

  // mode === 'sentences': preserve speaker per dialogue turn while splitting multi-sentence paragraphs.
  const out: Line[] = [];
  const hasDialogue = nonEmpty.some((l) => SPEAKER_PREFIX.test(l));
  const chunks = hasDialogue ? nonEmpty : [nonEmpty.join(' ')];

  for (const chunk of chunks) {
    const { speaker, text } = extractSpeaker(chunk);
    for (const sentence of splitIntoSentences(text)) {
      if (sentence.trim()) out.push(createLine(sentence.trim(), { speaker }));
    }
  }
  return out;
}

/** Split a written script into timed `Line` scenes ready for preview, TTS and MP4 export. */
export function splitScriptToTimedScenes(
  rawScript: string,
  options: ScriptSplitOptions = {}
): { lines: Line[]; totalDurationUs: Microseconds } {
  const mode = options.mode ?? 'sentences';
  const normalized = normalizeDisplay(rawScript);
  if (!normalized.trim()) return { lines: [], totalDurationUs: 0 };

  // Keep fenced code blocks together even if they contain blank lines.
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of normalized.split('\n')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      current.push(line);
      if (!inFence) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    if (line.trim().length === 0) {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));

  const scenes: Line[] = [];
  for (const block of blocks) {
    scenes.push(...parseStructuredBlock(block, mode));
  }

  return timeScenesSequentially(scenes, options);
}

/**
 * Apply exact sample-measured Piper TTS durations back onto the project's scenes.
 * Every spoken line receives `source: 'tts'`, `confidence: 1`, and interpolated
 * word timings so word/progressive highlights stay locked to the voiceover.
 */
export function applyMeasuredVoiceoverCues(
  lines: Line[],
  cues: MeasuredVoiceCue[],
  options: { pauseMs?: number } = {}
): { lines: Line[]; totalDurationUs: Microseconds } {
  const cueById = new Map(cues.map((cue) => [cue.lineId, cue]));
  const pauseUs = usFromMs(Math.max(0, options.pauseMs ?? 300));
  let cursorUs = 0;

  const updated = lines.map((line) => {
    const cue = cueById.get(line.id);
    if (cue) {
      const start = Math.max(0, Math.round(cue.startUs));
      const end = Math.max(start + 100_000, Math.round(cue.endUs));
      cursorUs = end + pauseUs;
      return {
        ...line,
        start,
        end,
        source: 'tts' as const,
        confidence: 1,
        words: buildTimedWords(line.id, line.text, start, end, 'tts', 1)
      };
    }
    // Preserve silent/instrumental cards in sequential order without overlap.
    const span = Math.max(usFromMs(1200), line.end - line.start);
    const start = cursorUs;
    const end = start + span;
    cursorUs = end + pauseUs;
    return { ...line, start, end };
  });

  const lastEnd = updated.reduce((max, l) => Math.max(max, l.end), 0);
  return { lines: updated, totalDurationUs: lastEnd + usFromMs(250) };
}

/** Build the spoken narration string for a scene line (includes bullets when helpful, skips raw code). */
export function spokenTextForScene(line: Line): string {
  const scene = line.scene;
  if (scene?.narration !== undefined) {
    return scene.narration.trim();
  }
  const headline = line.text.trim();
  if (isInstrumentalMarker(headline)) return '';
  if (!scene) return headline;
  if (scene.layout === 'code') {
    const lead = headline ? (/[.!?]$/.test(headline) ? headline : `${headline}.`) : '';
    const sub = scene.subtext?.trim() ?? '';
    return `${lead} ${sub}`.trim();
  }
  if (scene.layout === 'stat' && scene.value?.trim()) {
    const val = scene.value.trim();
    if (!headline.toLowerCase().includes(val.toLowerCase())) {
      return `${val}. ${headline}`;
    }
  }
  if (scene.layout === 'bullets' && scene.items && scene.items.length > 0) {
    const spokenItems = scene.items
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (/[.!?]$/.test(item) ? item : `${item}.`))
      .join(' ');
    const lead = headline ? (/[.!?]$/.test(headline) ? headline : `${headline}.`) : '';
    return `${lead} ${spokenItems}`.trim();
  }
  return headline;
}
