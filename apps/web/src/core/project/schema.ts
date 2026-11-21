import { z } from 'zod';

/**
 * Runtime validation for everything that crosses a trust boundary:
 *   - project files imported from disk
 *   - projects restored from IndexedDB (possibly written by an older build)
 *   - subtitle files pasted by the user
 *
 * Imported project data is never trusted and never executed. It is parsed into
 * a fixed shape; unknown keys are stripped rather than preserved, which is what
 * stops an imported file from smuggling fields the renderer would act on.
 */

const microseconds = z.number().finite().nonnegative();
const timingSourceSchema = z.enum(['human', 'align', 'asr', 'estimate', 'tap', 'tts']);
const enterMotionSchema = z.enum(['fade', 'rise', 'clip', 'blur', 'wordCascade', 'zoom', 'spring', 'none']);
const exitMotionSchema = z.enum(['fade', 'sink', 'blur', 'none']);
const colorOrEmpty = z.string().max(64);

const chartDatumSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.number().finite().min(0).max(1_000_000_000),
  color: colorOrEmpty.optional()
});

const sceneBackgroundOverrideSchema = z
  .object({
    kind: z.enum(['gradient', 'image', 'solid', 'mesh', 'visualizer', 'horizon']).optional(),
    assetId: z.string().max(128).nullable().optional(),
    colors: z.array(colorOrEmpty).min(1).max(8).optional(),
    motion: z.number().min(0).max(2).optional(),
    scrim: z.number().min(0).max(1).optional()
  })
  .partial();

export const sceneVisualSchema = z
  .object({
    layout: z.enum(['caption', 'title', 'stat', 'bullets', 'quote', 'code', 'chart']).optional(),
    kicker: z.string().max(160).optional(),
    subtext: z.string().max(600).optional(),
    value: z.string().max(80).optional(),
    items: z.array(z.string().max(400)).max(24).optional(),
    chart: z.array(chartDatumSchema).max(12).optional(),
    background: sceneBackgroundOverrideSchema.optional(),
    enter: enterMotionSchema.optional(),
    exit: exitMotionSchema.optional(),
    transition: z.enum(['fade', 'wipe', 'slide', 'zoom', 'none']).optional(),
    narration: z.string().max(4000).optional(),
    language: z.string().max(48).optional(),
    accent: colorOrEmpty.optional()
  })
  .partial();

const wordSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().max(4000),
  norm: z.string().max(4000),
  start: microseconds,
  end: microseconds,
  confidence: z.number().min(0).max(1),
  source: timingSourceSchema,
  locked: z.boolean()
});

const lineSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().max(4000),
  words: z.array(wordSchema).max(600),
  start: microseconds,
  end: microseconds,
  sectionId: z.string().max(128).nullable(),
  locked: z.boolean(),
  style: z
    .object({
      sizeRatio: z.number().min(0.01).max(0.5).optional(),
      weight: z.number().min(100).max(900).optional(),
      color: z.string().max(32).optional(),
      uppercase: z.boolean().optional(),
      align: z.enum(['left', 'center', 'right']).optional()
    })
    .partial(),
  scene: sceneVisualSchema.optional(),
  speaker: z.enum(['A', 'B']).nullable(),
  translation: z.string().max(4000).nullable(),
  source: timingSourceSchema,
  confidence: z.number().min(0).max(1).optional()
});

const sectionSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum([
    'INTRO', 'VERSE', 'PRE_CHORUS', 'CHORUS', 'HOOK', 'REFRAIN',
    'BRIDGE', 'BREAKDOWN', 'INSTRUMENTAL', 'OUTRO', 'UNKNOWN'
  ]),
  label: z.string().max(64),
  occurrence: z.number().int().min(0).max(999)
});

const backgroundSchema = z.object({
  kind: z.enum(['gradient', 'image', 'solid', 'mesh', 'visualizer', 'horizon']),
  assetId: z.string().max(128).nullable(),
  colors: z.array(colorOrEmpty).min(1).max(8),
  motion: z.number().min(0).max(2),
  scrim: z.number().min(0).max(1),
  visualizerBand: z.number().min(0).max(1),
  visualizerGain: z.number().min(0).max(4)
});

const typographySchema = z.object({
  fontStack: z.string().max(512),
  weight: z.number().min(100).max(900),
  sizeRatio: z.number().min(0.01).max(0.5),
  lineHeight: z.number().min(0.8).max(3),
  letterSpacing: z.number().min(-0.2).max(0.5),
  align: z.enum(['left', 'center', 'right']),
  anchor: z.enum(['top', 'center', 'bottom']),
  uppercase: z.boolean(),
  color: colorOrEmpty,
  activeColor: colorOrEmpty,
  shadowBlur: z.number().min(0).max(200),
  shadowColor: colorOrEmpty,
  shadowOffsetY: z.number().min(-100).max(100),
  outlineWidth: z.number().min(0).max(40),
  outlineColor: colorOrEmpty
});

const karaokeSchema = z.object({
  mode: z.enum(['line', 'word', 'progressive', 'none']),
  fillEase: z.enum(['linear', 'smooth']),
  glow: z.number().min(0).max(2),
  scale: z.number().min(0.8).max(1.5),
  colorShift: z.boolean(),
  beatAware: z.boolean()
});

const motionSchema = z.object({
  enter: enterMotionSchema,
  exit: exitMotionSchema,
  enterUs: microseconds,
  exitUs: microseconds,
  overlapUs: microseconds,
  intensity: z.number().min(0).max(2)
});

const brandSchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(200),
  logoAssetId: z.string().max(128).nullable(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  opacity: z.number().min(0).max(1)
});

const cardSchema = z.object({
  enabled: z.boolean(),
  title: z.string().max(200),
  subtitle: z.string().max(400),
  durationUs: microseconds
});

const designSchema = z.object({
  themeId: z.string().max(64),
  aspectId: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3', 'custom']),
  customSize: z.object({ width: z.number().int().min(128).max(7680), height: z.number().int().min(128).max(4320) }).nullable(),
  background: backgroundSchema,
  typography: typographySchema,
  karaoke: karaokeSchema,
  motion: motionSchema,
  brand: brandSchema,
  intro: cardSchema,
  outro: cardSchema,
  accent: colorOrEmpty.nullable()
});

export const presetStyleSchema = designSchema.pick({ typography: true, motion: true, karaoke: true, accent: true });

const audioSchema = z.object({
  assetId: z.string().max(128),
  fileName: z.string().max(512),
  mimeType: z.string().max(128),
  bytes: z.number().int().nonnegative(),
  durationUs: microseconds,
  sampleRate: z.number().int().positive(),
  channels: z.number().int().min(1).max(32),
  peaksAssetId: z.string().max(128),
  contentHash: z.string().max(128)
});

const voiceoverSchema = z.object({
  assetId: z.string().min(1).max(128),
  fileName: z.string().max(512),
  mimeType: z.string().max(128),
  bytes: z.number().int().nonnegative(),
  contentHash: z.string().max(128),
  sampleRate: z.number().int().positive(),
  durationUs: microseconds,
  voiceId: z.string().min(1).max(128),
  voiceIdB: z.string().min(1).max(128).nullable().optional(),
  mode: z.enum(['timed', 'sequential']).optional(),
  pauseMs: z.number().int().min(0).max(10_000).optional(),
  sourceSignature: z.string().min(1).max(128),
  enabled: z.boolean(),
  musicGain: z.number().min(0).max(2),
  speechGain: z.number().min(0).max(2),
  createdAt: z.number().finite()
});

const exportSchema = z.object({
  presetId: z.string().max(64),
  width: z.number().int().min(128).max(7680),
  height: z.number().int().min(128).max(4320),
  fps: z.number().int().min(12).max(60),
  videoBitrate: z.number().int().min(100_000).max(80_000_000),
  codec: z.enum(['h264', 'vp9', 'av1']),
  audioBitrate: z.number().int().min(32_000).max(512_000),
  globalOffsetUs: z.number().finite(),
  rangeStartUs: microseconds,
  rangeEndUs: microseconds,
  includeAudio: z.boolean(),
  fileName: z.string().max(256)
});

export const projectSchema = z.object({
  formatVersion: z.number().int().min(1),
  id: z.string().min(1).max(128),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  meta: z.object({
    title: z.string().max(300),
    artist: z.string().max(300),
    album: z.string().max(300),
    language: z.string().max(16),
    notes: z.string().max(8000)
  }),
  audio: audioSchema.nullable(),
  voiceover: voiceoverSchema.nullable(),
  lyrics: z.object({
    source: z.enum(['user', 'file', 'asr', 'script', 'spec', 'empty']),
    originalText: z.string().max(200_000),
    originalFileName: z.string().max(512).nullable(),
    lines: z.array(lineSchema).max(5000)
  }),
  sections: z.array(sectionSchema).max(500),
  design: designSchema,
  export: exportSchema,
  ui: z.object({
    mode: z.enum(['simple', 'advanced']),
    zoomPxPerSecond: z.number().min(2).max(4000),
    selection: z.string().max(128).nullable(),
    lastPlayheadUs: z.number().finite()
  })
});

export const assetRecordSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['audio', 'peaks', 'image', 'video', 'json']),
  fileName: z.string().max(512),
  mimeType: z.string().max(128),
  bytes: z.number().int().nonnegative(),
  contentHash: z.string().max(128),
  createdAt: z.number().finite()
});

export const projectFileSchema = z.object({
  kind: z.literal('vidlyrics.project'),
  formatVersion: z.number().int().min(1),
  app: z.object({ name: z.string().max(64), version: z.string().max(32) }),
  exportedAt: z.number().finite(),
  project: projectSchema,
  assets: z.array(assetRecordSchema).max(200)
});

export type ValidatedProject = z.infer<typeof projectSchema>;
export type ValidatedProjectFile = z.infer<typeof projectFileSchema>;

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  /** Machine-readable issue codes, safe to show to the user. */
  issues: { path: string; message: string; code: string }[];
}

function toIssues(error: z.ZodError): ValidationResult<never>['issues'] {
  return error.issues.slice(0, 40).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code
  }));
}

export function validateProject(input: unknown): ValidationResult<ValidatedProject> {
  const result = projectSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data, issues: [] };
  return { ok: false, issues: toIssues(result.error) };
}

export function validateProjectFile(input: unknown): ValidationResult<ValidatedProjectFile> {
  const result = projectFileSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data, issues: [] };
  return { ok: false, issues: toIssues(result.error) };
}

/** Reject project files written by a newer app than this one. */
export function isFutureFormat(formatVersion: number, currentVersion: number): boolean {
  return formatVersion > currentVersion;
}

/** Summarise validation issues into one readable line for the import dialog. */
export function summariseIssues(issues: ValidationResult<never>['issues']): string {
  if (issues.length === 0) return '';
  const first = issues[0];
  if (!first) return '';
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${first.path}: ${first.message}${more}`;
}
