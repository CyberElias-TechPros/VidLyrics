import { z } from 'zod';

/**
 * Declarative "Video-as-Code" specification (`vidlyrics.spec` v1).
 *
 * Designed to be comfortable to hand-edit, version-control in Git, and generate
 * with an AI coding assistant — while upholding the exact same security rule as
 * `project/schema.ts`: data is strictly validated and stripped of unknown keys;
 * arbitrary code is NEVER executed (`eval`/`Function` do not exist anywhere).
 */

export const VIDEO_SPEC_VERSION = 1;

const colorSchema = z.string().min(1).max(64);
const secondsSchema = z.number().finite().nonnegative().max(60 * 20);
const positiveSecondsSchema = z.number().finite().positive().max(60 * 10);

export const specLayoutSchema = z.enum(['caption', 'title', 'stat', 'bullets', 'quote', 'code', 'chart']);
export const specEnterSchema = z.enum(['fade', 'rise', 'clip', 'blur', 'wordCascade', 'zoom', 'spring', 'none']);
export const specExitSchema = z.enum(['fade', 'sink', 'blur', 'none']);
export const specTransitionSchema = z.enum(['fade', 'wipe', 'slide', 'zoom', 'none']);
export const specAspectSchema = z.enum(['16:9', '9:16', '1:1', '4:5', '4:3', 'custom']);
export const specBackgroundKindSchema = z.enum(['gradient', 'image', 'solid', 'mesh', 'visualizer', 'horizon']);

export const specBackgroundSchema = z
  .object({
    kind: specBackgroundKindSchema.optional(),
    assetId: z.string().max(128).nullable().optional(),
    colors: z.array(colorSchema).min(1).max(8).optional(),
    motion: z.number().finite().min(0).max(2).optional(),
    scrim: z.number().finite().min(0).max(1).optional()
  })
  .strict();

export const specChartDatumSchema = z
  .object({
    label: z.string().min(1).max(120),
    value: z.number().finite().min(0).max(1_000_000_000),
    color: colorSchema.optional()
  })
  .strict();

export const specLineStyleSchema = z
  .object({
    sizeRatio: z.number().finite().min(0.015).max(0.4).optional(),
    weight: z.number().finite().min(100).max(900).optional(),
    color: z.string().min(1).max(32).optional(),
    uppercase: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional()
  })
  .strict();

export const specSceneSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    layout: specLayoutSchema.optional(),
    kicker: z.string().max(160).optional(),
    text: z.string().max(4000).refine(text => text.trim().length > 0, 'Scene text cannot be empty'),
    subtext: z.string().max(600).optional(),
    value: z.string().max(80).optional(),
    narration: z.string().max(4000).optional(),
    language: z.string().max(48).optional(),
    items: z.array(z.string().max(400)).max(24).optional(),
    chart: z.array(specChartDatumSchema).max(12).optional(),
    /** Explicit start in seconds. Omit to auto-sequence after the previous scene. */
    start: secondsSchema.optional(),
    /** Explicit end in seconds. Omit to derive from `duration` or reading speed. */
    end: secondsSchema.optional(),
    /** Scene length in seconds, or `"auto"` to derive from speech/reading speed. */
    duration: z.union([positiveSecondsSchema, z.literal('auto')]).optional(),
    /** Pause after this scene in seconds when auto-sequencing. */
    pauseAfter: z.number().finite().min(0).max(30).optional(),
    speaker: z.enum(['A', 'B']).nullable().optional(),
    section: z.string().max(64).optional(),
    locked: z.boolean().optional(),
    background: specBackgroundSchema.optional(),
    enter: specEnterSchema.optional(),
    exit: specExitSchema.optional(),
    transition: specTransitionSchema.optional(),
    accent: colorSchema.optional(),
    style: specLineStyleSchema.optional()
  })
  .superRefine((scene, ctx) => {
    if (scene.start !== undefined && scene.end !== undefined && scene.end <= scene.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: '`end` must be greater than `start`.'
      });
    }
    if (scene.layout === 'chart' && (!scene.chart || scene.chart.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chart'],
        message: 'Chart scenes require at least one `{ label, value }` bar in `chart`.'
      });
    }
  });

export const specCardSchema = z.object({
  title: z.string().max(200),
  subtitle: z.string().max(400).optional(),
  duration: positiveSecondsSchema.optional()
});

export const specVoiceSchema = z.object({
  voiceId: z.string().min(1).max(128).optional(),
  voiceIdB: z.string().min(1).max(128).nullable().optional(),
  pauseMs: z.number().int().min(0).max(5000).optional(),
  wpm: z.number().int().min(60).max(360).optional()
});

export const videoSpecSchema = z.object({
  kind: z.literal('vidlyrics.spec').optional(),
  version: z.number().int().min(1).max(VIDEO_SPEC_VERSION).optional(),
  title: z.string().max(300).optional(),
  author: z.string().max(300).optional(),
  language: z.string().max(16).optional(),
  theme: z.string().max(64).optional(),
  aspect: specAspectSchema.optional(),
  customSize: z
    .object({
      width: z.number().int().min(128).max(7680),
      height: z.number().int().min(128).max(4320)
    })
    .optional(),
  fps: z.number().int().min(12).max(60).optional(),
  codec: z.enum(['h264', 'vp9', 'av1']).optional(),
  accent: colorSchema.nullable().optional(),
  background: specBackgroundSchema.optional(),
  typography: z
    .object({
      fontStack: z.string().max(512).optional(),
      weight: z.number().min(100).max(900).optional(),
      sizeRatio: z.number().min(0.015).max(0.3).optional(),
      lineHeight: z.number().min(0.8).max(3).optional(),
      letterSpacing: z.number().min(-0.2).max(0.5).optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      anchor: z.enum(['top', 'center', 'bottom']).optional(),
      uppercase: z.boolean().optional(),
      color: colorSchema.optional(),
      activeColor: colorSchema.optional(),
      outlineWidth: z.number().min(0).max(40).optional()
    })
    .optional(),
  karaoke: z.enum(['line', 'word', 'progressive', 'none']).optional(),
  motion: z
    .object({
      enter: specEnterSchema.optional(),
      exit: specExitSchema.optional(),
      enterMs: z.number().finite().min(0).max(5000).optional(),
      exitMs: z.number().finite().min(0).max(5000).optional(),
      overlapMs: z.number().finite().min(0).max(5000).optional(),
      intensity: z.number().finite().min(0).max(2).optional()
    })
    .optional(),
  voice: specVoiceSchema.optional(),
  intro: specCardSchema.nullable().optional(),
  outro: specCardSchema.nullable().optional(),
  watermark: z
    .object({
      text: z.string().max(200),
      position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
      opacity: z.number().finite().min(0).max(1).optional()
    })
    .nullable()
    .optional(),
  scenes: z.array(specSceneSchema).max(2000)
});

export type VideoSpec = z.infer<typeof videoSpecSchema>;
export type SpecScene = z.infer<typeof specSceneSchema>;

export interface SpecIssue {
  path: string;
  message: string;
  line?: number;
}

export interface SpecParseResult {
  ok: boolean;
  spec?: VideoSpec;
  issues: SpecIssue[];
}

function lineFromJsonError(source: string, errorMessage: string): number | undefined {
  const lineMatch = /\bline\s+(\d+)/i.exec(errorMessage);
  if (lineMatch) return Number(lineMatch[1]);
  const posMatch = /\bposition\s+(\d+)/i.exec(errorMessage);
  if (posMatch) {
    const pos = Math.max(0, Math.min(source.length, Number(posMatch[1])));
    return source.slice(0, pos).split('\n').length;
  }
  if (/unexpected end of json/i.test(errorMessage)) {
    return source.split('\n').length;
  }
  const tokenMatch = /unexpected token\s+'([^']+)'/i.exec(errorMessage);
  if (tokenMatch?.[1]) {
    const idx = source.lastIndexOf(tokenMatch[1]);
    if (idx >= 0) return source.slice(0, idx).split('\n').length;
  }
  return 1;
}

function formatIssuePath(path: (string | number)[]): string {
  if (path.length === 0) return '(root)';
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out;
}

// Accept a single complete Markdown code fence, never arbitrary chat prose or JS.
function specSource(text: string): string {
  const trimmed = text.trim();
  return (/^```(?:json)?[^\S\n]*\n([\s\S]*?)\n```$/i.exec(trimmed)?.[1] ?? trimmed).trim();
}

function decodeSpec(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    // Some chat clients escape Markdown punctuation even inside copied JSON.
    // Consume backslashes in pairs so valid JSON escapes (including a literal
    // backslash followed by an underscore) survive recovery unchanged.
    const recovered = source.replace(/\\([\s\S])/g, (pair, char: string) =>
      ['[', ']', '_'].includes(char) ? char : pair
    );
    if (recovered === source) throw error;
    return JSON.parse(recovered);
  }
}

/** Parse and validate raw JSON text as a `VideoSpec`, surfacing exact issues. */
export function parseVideoSpecJson(rawText: string): SpecParseResult {
  const trimmed = specSource(rawText);
  if (!trimmed) {
    return { ok: false, issues: [{ path: '(root)', message: 'Spec is empty — paste JSON or choose a template.' }] };
  }

  let parsed: unknown;
  try {
    parsed = decodeSpec(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON syntax.';
    return {
      ok: false,
      issues: [{ path: 'JSON', message, line: lineFromJsonError(trimmed, message) }]
    };
  }

  if (parsed && typeof parsed === 'object' && 'version' in parsed) {
    const version = (parsed as { version?: unknown }).version;
    if (typeof version === 'number' && version > VIDEO_SPEC_VERSION) {
      return {
        ok: false,
        issues: [
          {
            path: 'version',
            message: `Spec version ${version} is newer than supported v${VIDEO_SPEC_VERSION}.`
          }
        ]
      };
    }
  }

  const result = videoSpecSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.slice(0, 20).map((issue) => ({
        path: formatIssuePath(issue.path),
        message: issue.message
      }))
    };
  }

  return { ok: true, spec: result.data, issues: [] };
}

/** Detect whether a JSON text or parsed object represents a `vidlyrics.spec` file. */
export function isVideoSpecJson(text: string): boolean {
  const source = specSource(text);
  if (!source.startsWith('{')) return false;
  try {
    const parsed = decodeSpec(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const obj = parsed as Record<string, unknown>;
    if (obj.kind === 'vidlyrics.spec') return true;
    if (obj.kind === 'vidlyrics.project') return false;
    return Array.isArray(obj.scenes);
  } catch {
    // Route a damaged spec to validation, not the plain-text scene splitter.
    return /"kind"\s*:\s*"vidlyrics\.spec"|"scenes"\s*:\s*\\?\[/.test(source);
  }
}
