import type { Microseconds } from './time';

/** Re-exported so callers can brand timings from one place. */
export type { Microseconds };

/* ------------------------------------------------------------------ *
 * IDENTIFIERS
 * ------------------------------------------------------------------ */

export type Id = string;

/* ------------------------------------------------------------------ *
 * LYRICS
 * ------------------------------------------------------------------ */

/** Provenance of a timestamp. Drives confidence heat and undo semantics. */
export type TimingSource = 'human' | 'align' | 'asr' | 'estimate' | 'tap';

export interface Word {
  id: Id;
  /** The characters the user sees. Never rewritten destructively. */
  text: string;
  /** Normalised form used for matching/alignment. Never displayed. */
  norm: string;
  start: Microseconds;
  end: Microseconds;
  /** 0..1. 1 === set or confirmed by a human. */
  confidence: number;
  source: TimingSource;
  locked: boolean;
}

export interface Line {
  id: Id;
  /** Original text exactly as imported/typed. The source of truth for display. */
  text: string;
  words: Word[];
  start: Microseconds;
  end: Microseconds;
  sectionId: Id | null;
  /** Timing is authoritative; the user will not accept automatic edits. */
  locked: boolean;
  /** Per-line override, merged over the theme defaults. */
  style: Partial<LineStyle>;
  /** Optional second voice (duet / call-and-response). */
  speaker: 'A' | 'B' | null;
  /** Optional translated/romanised companion line, rendered beneath. */
  translation: string | null;
  source: TimingSource;
  /**
   * 0..1 confidence that this line's timing is correct, when a heuristic or an
   * aligner produced it. Absent when the user set the timing themselves.
   */
  confidence?: number;
}

export type SectionKind =
  | 'INTRO'
  | 'VERSE'
  | 'PRE_CHORUS'
  | 'CHORUS'
  | 'HOOK'
  | 'REFRAIN'
  | 'BRIDGE'
  | 'BREAKDOWN'
  | 'INSTRUMENTAL'
  | 'OUTRO'
  | 'UNKNOWN';

export interface Section {
  id: Id;
  kind: SectionKind;
  label: string;
  /** Index among sections of the same kind — drives palette/scene variation. */
  occurrence: number;
}

/* ------------------------------------------------------------------ *
 * DESIGN
 * ------------------------------------------------------------------ */

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | 'custom';

export interface Aspect {
  id: AspectId;
  label: string;
  width: number;
  height: number;
  /** Fractional insets that platform UI overlays, per edge. */
  safeArea: { top: number; right: number; bottom: number; left: number };
}

export type BackgroundKind = 'gradient' | 'image' | 'solid' | 'mesh' | 'visualizer';

export interface BackgroundSpec {
  kind: BackgroundKind;
  /** Theme-supplied default; may reference an asset id for 'image'. */
  assetId: Id | null;
  colors: string[];
  /** Ken Burns / drift amount, 0 disables. */
  motion: number;
  /** Opacity of the darkening scrim behind text (readability floor). */
  scrim: number;
  /** FFT band used to drive the visualizer, 0..1. */
  visualizerBand: number;
  visualizerGain: number;
}

export interface TypographySpec {
  fontStack: string;
  /** Weight for the active lyric line. */
  weight: number;
  /** Font size as a fraction of composition height. */
  sizeRatio: number;
  lineHeight: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
  /** Vertical anchor within the safe area. */
  anchor: 'top' | 'center' | 'bottom';
  uppercase: boolean;
  color: string;
  activeColor: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetY: number;
  /** Outline/halo width in px at 1080p, scaled with composition. */
  outlineWidth: number;
  outlineColor: string;
}

export type KaraokeMode = 'line' | 'word' | 'progressive' | 'none';

export interface KaraokeSpec {
  mode: KaraokeMode;
  /** Progressive fill sweeps horizontally inside the word box. */
  fillEase: 'linear' | 'smooth';
  glow: number;
  scale: number;
  /** Colour transition on activation. */
  colorShift: boolean;
  /** Snap word activation to the nearest detected beat. */
  beatAware: boolean;
}

export interface MotionSpec {
  enter: 'fade' | 'rise' | 'clip' | 'blur' | 'wordCascade' | 'none';
  exit: 'fade' | 'sink' | 'blur' | 'none';
  /** Duration in microseconds for enter/exit transitions. */
  enterUs: Microseconds;
  exitUs: Microseconds;
  /** Overlap between consecutive lines, microseconds. */
  overlapUs: Microseconds;
  intensity: number;
}

export interface LineStyle {
  sizeRatio: number;
  weight: number;
  color: string;
  uppercase: boolean;
  align: 'left' | 'center' | 'right';
}

export interface BrandSpec {
  enabled: boolean;
  text: string;
  logoAssetId: Id | null;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
}

export interface CardSpec {
  enabled: boolean;
  title: string;
  subtitle: string;
  durationUs: Microseconds;
}

export interface Design {
  themeId: string;
  aspectId: AspectId;
  customSize: { width: number; height: number } | null;
  background: BackgroundSpec;
  typography: TypographySpec;
  karaoke: KaraokeSpec;
  motion: MotionSpec;
  brand: BrandSpec;
  intro: CardSpec;
  outro: CardSpec;
  /** Album-art derived accent colour, if the user extracted a palette. */
  accent: string | null;
}

/* ------------------------------------------------------------------ *
 * AUDIO + ASSETS
 * ------------------------------------------------------------------ */

export interface AudioMeta {
  /** Key into the local asset store. Content-hash addressed. */
  assetId: Id;
  fileName: string;
  mimeType: string;
  bytes: number;
  durationUs: Microseconds;
  sampleRate: number;
  channels: number;
  peaksAssetId: Id;
  /** SHA-256 of the file bytes; used for dedupe and for re-linking assets. */
  contentHash: string;
}

export interface AssetRecord {
  id: Id;
  kind: 'audio' | 'peaks' | 'image' | 'video' | 'json';
  fileName: string;
  mimeType: string;
  bytes: number;
  contentHash: string;
  createdAt: number;
}

/** Local, generated voiceover audio and its reproducible mix settings. */
export interface VoiceoverMeta {
  assetId: Id;
  fileName: string;
  mimeType: string;
  bytes: number;
  contentHash: string;
  sampleRate: number;
  durationUs: Microseconds;
  voiceId: string;
  /** Signature of lyric order, text and starts used to synthesize this track. */
  sourceSignature: string;
  enabled: boolean;
  musicGain: number;
  speechGain: number;
  createdAt: number;
}

/* ------------------------------------------------------------------ *
 * EXPORT
 * ------------------------------------------------------------------ */

export type CodecId = 'h264' | 'vp9' | 'av1';

export interface ExportSettings {
  presetId: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  codec: CodecId;
  audioBitrate: number;
  /** Applied at render time only — never written back into stored timings. */
  globalOffsetUs: Microseconds;
  /** Trim range, defaults to the full audio duration. */
  rangeStartUs: Microseconds;
  rangeEndUs: Microseconds;
  includeAudio: boolean;
  fileName: string;
}

/* ------------------------------------------------------------------ *
 * PROJECT
 * ------------------------------------------------------------------ */

export type LyricSource = 'user' | 'file' | 'asr' | 'empty';

export interface LyricsState {
  source: LyricSource;
  /** Raw text the user supplied, preserved verbatim for re-parsing. */
  originalText: string;
  originalFileName: string | null;
  lines: Line[];
}

export interface Project {
  formatVersion: number;
  id: Id;
  createdAt: number;
  updatedAt: number;
  meta: {
    title: string;
    artist: string;
    album: string;
    language: string;
    notes: string;
  };
  audio: AudioMeta | null;
  voiceover: VoiceoverMeta | null;
  lyrics: LyricsState;
  sections: Section[];
  design: Design;
  export: ExportSettings;
  /** Editor-only, persisted so a reload restores the exact working context. */
  ui: {
    mode: 'simple' | 'advanced';
    zoomPxPerSecond: number;
    selection: Id | null;
    lastPlayheadUs: Microseconds;
  };
}

export interface ProjectFile {
  kind: 'vidlyrics.project';
  formatVersion: number;
  /** Written by, for forward-compat refusals. */
  app: { name: string; version: string };
  exportedAt: number;
  project: Project;
  /** Asset manifests without payloads; the file itself carries no binaries. */
  assets: AssetRecord[];
}

/* ------------------------------------------------------------------ *
 * STATE MACHINES (explicit lifecycles — no ambiguous booleans)
 * ------------------------------------------------------------------ */

export type MediaState =
  | 'IDLE'
  | 'IMPORTING'
  | 'VALIDATING'
  | 'DECODING'
  | 'ANALYZING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED';

export type SyncState = 'IDLE' | 'PARSING' | 'ALIGNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

export type RenderState =
  | 'IDLE'
  | 'QUEUED'
  | 'PREPARING'
  | 'RENDERING'
  | 'ENCODING'
  | 'MUXING'
  | 'VALIDATING'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

/** Every failure carries a machine-readable recovery route, never a dead end. */
export type RecoveryRoute =
  | 'retry'
  | 'manual-tap-sync'
  | 'lower-resolution'
  | 'shorter-range'
  | 'smaller-model'
  | 'remove-project'
  | 'close-other-tab'
  | 'update-browser'
  | 'try-different-file'
  | 'documentation';

export interface AppError {
  code: string;
  title: string;
  /** Plain-language explanation of what happened. */
  detail: string;
  /** What the user should do next. */
  recovery: RecoveryRoute[];
  /** Technical detail, shown behind a disclosure, never in a toast. */
  technical?: string;
  retryable: boolean;
  fatal: boolean;
}
