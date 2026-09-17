import type {
  Aspect,
  AspectId,
  BackgroundSpec,
  Design,
  ExportSettings,
  KaraokeSpec,
  MotionSpec,
  TypographySpec
} from '../types';
import { usFromMs, usFromSeconds } from '../time';

/**
 * Design tokens for the composition surface.
 *
 * Font stacks are deliberately SYSTEM stacks. Two reasons, both hard:
 *   1. Exported video rasterises text, so a webfont must finish loading before
 *      frame 0 or the render silently uses a fallback. System fonts are always
 *      resident, which removes a whole class of "why does frame 0 look wrong".
 *   2. Redistribution. We ship zero font binaries, so there is no licence to
 *      audit. Users may load their own OFL font from disk; the UI asks them to
 *      confirm the licence permits embedding in exported video.
 */

const SANS = '"Inter var", Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DISPLAY = '"Space Grotesk", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", Georgia, serif';
const MONO = '"JetBrains Mono", "SF Mono", "Cascadia Mono", ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';

export const ASPECTS: Aspect[] = [
  { id: '16:9', label: '16:9 Landscape', width: 1920, height: 1080, safeArea: { top: 0.06, right: 0.06, bottom: 0.1, left: 0.06 } },
  { id: '9:16', label: '9:16 Vertical', width: 1080, height: 1920, safeArea: { top: 0.12, right: 0.08, bottom: 0.18, left: 0.08 } },
  { id: '1:1', label: '1:1 Square', width: 1080, height: 1080, safeArea: { top: 0.08, right: 0.08, bottom: 0.12, left: 0.08 } },
  { id: '4:5', label: '4:5 Portrait', width: 1080, height: 1350, safeArea: { top: 0.09, right: 0.08, bottom: 0.16, left: 0.08 } },
  { id: '4:3', label: '4:3 Classic', width: 1440, height: 1080, safeArea: { top: 0.06, right: 0.06, bottom: 0.1, left: 0.06 } },
  { id: 'custom', label: 'Custom', width: 1280, height: 720, safeArea: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } }
];

export function getAspect(id: AspectId): Aspect {
  return ASPECTS.find((a) => a.id === id) ?? ASPECTS[0]!;
}

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Editorial label shown in the theme picker. */
  category: 'Cinematic' | 'Modern' | 'Karaoke' | 'Editorial';
  background: BackgroundSpec;
  typography: TypographySpec;
  karaoke: KaraokeSpec;
  motion: MotionSpec;
  /** Swatches used by the theme picker to render an honest preview. */
  swatches: string[];
}

function baseTypography(overrides: Partial<TypographySpec> = {}): TypographySpec {
  return {
    fontStack: DISPLAY,
    weight: 700,
    sizeRatio: 0.062,
    lineHeight: 1.18,
    letterSpacing: -0.01,
    align: 'center',
    anchor: 'center',
    uppercase: false,
    color: '#f4f5f7',
    activeColor: '#ffffff',
    shadowBlur: 24,
    shadowColor: 'rgba(0,0,0,0.55)',
    shadowOffsetY: 2,
    outlineWidth: 0,
    outlineColor: 'rgba(0,0,0,0.85)',
    ...overrides
  };
}

function baseMotion(overrides: Partial<MotionSpec> = {}): MotionSpec {
  return {
    enter: 'rise',
    exit: 'fade',
    enterUs: usFromMs(320),
    exitUs: usFromMs(220),
    overlapUs: usFromMs(120),
    intensity: 1,
    ...overrides
  };
}

export const THEMES: Theme[] = [
  {
    id: 'nocturne',
    name: 'Nocturne',
    blurb: 'Near-black field, warm white type, a single soft glow. Reads as a music video title card rather than a subtitle.',
    category: 'Cinematic',
    swatches: ['#0a0b10', '#141824', '#f4f5f7'],
    background: { kind: 'gradient', assetId: null, colors: ['#08090d', '#131a2b', '#08090d'], motion: 0.15, scrim: 0.42, visualizerBand: 0.18, visualizerGain: 0.6 },
    typography: baseTypography({ fontStack: DISPLAY, weight: 600, sizeRatio: 0.064, color: '#e9ecf2', activeColor: '#ffffff', shadowBlur: 32 }),
    karaoke: { mode: 'word', fillEase: 'smooth', glow: 0.55, scale: 1.03, colorShift: true, beatAware: true },
    motion: baseMotion({ enter: 'blur', enterUs: usFromMs(360) }),
  },
  {
    id: 'neon-circuit',
    name: 'Neon Circuit',
    blurb: 'Cyan-to-magenta field with hard glow. Built for electronic and hyperpop.',
    category: 'Modern',
    swatches: ['#05060f', '#00e5ff', '#ff2fb9'],
    background: { kind: 'gradient', assetId: null, colors: ['#04050c', '#0b2a4a', '#3a0a3d'], motion: 0.4, scrim: 0.5, visualizerBand: 0.35, visualizerGain: 1 },
    typography: baseTypography({ fontStack: DISPLAY, weight: 800, uppercase: true, letterSpacing: 0.02, sizeRatio: 0.058, color: '#cfe9ff', activeColor: '#00e5ff', shadowBlur: 40, shadowColor: 'rgba(0,229,255,0.35)' }),
    karaoke: { mode: 'progressive', fillEase: 'linear', glow: 1, scale: 1.05, colorShift: true, beatAware: true },
    motion: baseMotion({ enter: 'clip', enterUs: usFromMs(300) }),
  },
  {
    id: 'paper-light',
    name: 'Paper Light',
    blurb: 'Bright editorial layout. The right choice for podcasts, audiobooks and acoustic sessions.',
    category: 'Editorial',
    swatches: ['#f7f5f0', '#1a1a1a', '#c2410c'],
    background: { kind: 'solid', assetId: null, colors: ['#f7f5f0'], motion: 0, scrim: 0, visualizerBand: 0, visualizerGain: 0 },
    typography: baseTypography({ fontStack: SERIF, weight: 500, sizeRatio: 0.058, color: '#1a1a1a', activeColor: '#b91c1c', shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', lineHeight: 1.32 }),
    karaoke: { mode: 'word', fillEase: 'smooth', glow: 0, scale: 1, colorShift: true, beatAware: false },
    motion: baseMotion({ enter: 'fade', exit: 'fade', enterUs: usFromMs(260) }),
  },
  {
    id: 'sunset-drive',
    name: 'Sunset Drive',
    blurb: 'Warm mesh gradient with slow drift. Warm vocals, indie, R&B.',
    category: 'Modern',
    swatches: ['#2b0f3a', '#ff7a45', '#ffd166'],
    background: { kind: 'mesh', assetId: null, colors: ['#2b0f3a', '#b4366b', '#ff7a45', '#ffd166'], motion: 0.35, scrim: 0.38, visualizerBand: 0.25, visualizerGain: 0.8 },
    typography: baseTypography({ fontStack: DISPLAY, weight: 700, sizeRatio: 0.06, color: '#fff3e2', activeColor: '#ffffff' }),
    karaoke: { mode: 'progressive', fillEase: 'smooth', glow: 0.5, scale: 1.02, colorShift: false, beatAware: true },
    motion: baseMotion({ enter: 'rise' }),
  },
  {
    id: 'mono-brutal',
    name: 'Mono Brutal',
    blurb: 'Oversized uppercase on flat black. Maximum legibility at 9:16 on a phone.',
    category: 'Modern',
    swatches: ['#000000', '#ffffff', '#f5f5f5'],
    background: { kind: 'solid', assetId: null, colors: ['#000000'], motion: 0, scrim: 0, visualizerBand: 0, visualizerGain: 0 },
    typography: baseTypography({ fontStack: MONO, weight: 700, uppercase: true, sizeRatio: 0.072, letterSpacing: -0.03, lineHeight: 1.05, color: '#ffffff', activeColor: '#ffffff', shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' }),
    karaoke: { mode: 'word', fillEase: 'linear', glow: 0, scale: 1, colorShift: false, beatAware: false },
    motion: baseMotion({ enter: 'clip', exit: 'none', enterUs: usFromMs(200), exitUs: 0 }),
  },
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Slow green-to-violet wash. Ambient, worship, cinematic instrumental.',
    category: 'Cinematic',
    swatches: ['#04121a', '#16a085', '#7b5cff'],
    background: { kind: 'mesh', assetId: null, colors: ['#04121a', '#0d3b3f', '#16a085', '#7b5cff'], motion: 0.28, scrim: 0.45, visualizerBand: 0.12, visualizerGain: 0.7 },
    typography: baseTypography({ fontStack: DISPLAY, weight: 500, sizeRatio: 0.06, color: '#eaf6f2', activeColor: '#ffffff', shadowBlur: 28 }),
    karaoke: { mode: 'progressive', fillEase: 'smooth', glow: 0.6, scale: 1.02, colorShift: true, beatAware: false },
    motion: baseMotion({ enter: 'blur', enterUs: usFromMs(420) }),
  },
  {
    id: 'cinema-classic',
    name: 'Cinema Classic',
    blurb: 'Gold serif on black with letterbox bars. Ballads and standards.',
    category: 'Cinematic',
    swatches: ['#000000', '#e8c87a', '#f7f3e8'],
    background: { kind: 'gradient', assetId: null, colors: ['#000000', '#1a1408', '#000000'], motion: 0.08, scrim: 0.3, visualizerBand: 0.1, visualizerGain: 0.4 },
    typography: baseTypography({ fontStack: SERIF, weight: 400, sizeRatio: 0.058, color: '#f7f3e8', activeColor: '#e8c87a', shadowBlur: 20, lineHeight: 1.3 }),
    karaoke: { mode: 'word', fillEase: 'smooth', glow: 0.45, scale: 1.01, colorShift: true, beatAware: false },
    motion: baseMotion({ enter: 'fade', exit: 'fade', enterUs: usFromMs(400), exitUs: usFromMs(300) }),
  },
  {
    id: 'karaoke-stage',
    name: 'Karaoke Stage',
    blurb: 'Bottom-anchored with a hard outline and strong fill. Built to be sung along to.',
    category: 'Karaoke',
    swatches: ['#12062b', '#4c1d95', '#fbbf24'],
    background: { kind: 'gradient', assetId: null, colors: ['#12062b', '#4c1d95', '#12062b'], motion: 0.2, scrim: 0.55, visualizerBand: 0.4, visualizerGain: 0.9 },
    typography: baseTypography({ fontStack: SANS, weight: 800, sizeRatio: 0.056, anchor: 'bottom', color: '#ffffff', activeColor: '#fbbf24', outlineWidth: 6, outlineColor: 'rgba(0,0,0,0.9)', shadowBlur: 16 }),
    karaoke: { mode: 'progressive', fillEase: 'linear', glow: 0.7, scale: 1.06, colorShift: true, beatAware: true },
    motion: baseMotion({ enter: 'rise', enterUs: usFromMs(240), overlapUs: usFromMs(160) }),
  }
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export function designFromTheme(themeId: string, aspectId: AspectId = '16:9'): Design {
  const theme = getTheme(themeId);
  const aspect = getAspect(aspectId);
  return {
    themeId: theme.id,
    aspectId: aspect.id,
    customSize: null,
    background: { ...theme.background },
    typography: { ...theme.typography },
    karaoke: { ...theme.karaoke },
    motion: { ...theme.motion },
    brand: { enabled: false, text: '', logoAssetId: null, position: 'bottom-right', opacity: 0.85 },
    intro: { enabled: false, title: '', subtitle: '', durationUs: usFromSeconds(3) },
    outro: { enabled: false, title: '', subtitle: '', durationUs: usFromSeconds(3) },
    accent: null
  };
}

/* ------------------------------- export ------------------------------- */

export interface ExportPreset {
  id: string;
  label: string;
  platform: string;
  aspectId: AspectId;
  width: number;
  height: number;
  fps: number;
  /** Bits per second. Sized for the platform's own re-encode, not for archive. */
  videoBitrate: number;
  audioBitrate: number;
  note: string;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube', label: 'YouTube', platform: 'YouTube', aspectId: '16:9', width: 1920, height: 1080, fps: 30, videoBitrate: 8_000_000, audioBitrate: 192_000, note: 'Standard long-form upload.' },
  { id: 'youtube-4k', label: 'YouTube 4K', platform: 'YouTube', aspectId: '16:9', width: 3840, height: 2160, fps: 30, videoBitrate: 35_000_000, audioBitrate: 256_000, note: 'Needs a fast machine; check the memory estimate first.' },
  { id: 'youtube-shorts', label: 'YouTube Shorts', platform: 'YouTube', aspectId: '9:16', width: 1080, height: 1920, fps: 30, videoBitrate: 10_000_000, audioBitrate: 192_000, note: 'Keep the hook inside the centre safe area.' },
  { id: 'tiktok', label: 'TikTok', platform: 'TikTok', aspectId: '9:16', width: 1080, height: 1920, fps: 30, videoBitrate: 10_000_000, audioBitrate: 192_000, note: 'Right-hand UI overlaps roughly 12% of the frame.' },
  { id: 'instagram-reels', label: 'Instagram Reels', platform: 'Instagram', aspectId: '9:16', width: 1080, height: 1920, fps: 30, videoBitrate: 10_000_000, audioBitrate: 192_000, note: 'Bottom 18% carries captions and CTAs.' },
  { id: 'instagram-post', label: 'Instagram Post', platform: 'Instagram', aspectId: '4:5', width: 1080, height: 1350, fps: 30, videoBitrate: 8_000_000, audioBitrate: 192_000, note: 'Feed-native portrait.' },
  { id: 'instagram-square', label: 'Instagram Square', platform: 'Instagram', aspectId: '1:1', width: 1080, height: 1080, fps: 30, videoBitrate: 8_000_000, audioBitrate: 192_000, note: 'Legacy feed format.' },
  { id: 'facebook', label: 'Facebook', platform: 'Facebook', aspectId: '16:9', width: 1280, height: 720, fps: 30, videoBitrate: 5_000_000, audioBitrate: 128_000, note: 'Smaller upload, faster processing.' },
  { id: 'karaoke-room', label: 'Karaoke Room', platform: 'General', aspectId: '16:9', width: 1920, height: 1080, fps: 30, videoBitrate: 10_000_000, audioBitrate: 256_000, note: 'Higher audio bitrate for sing-along playback.' },
  { id: 'custom', label: 'Custom', platform: 'General', aspectId: 'custom', width: 1280, height: 720, fps: 30, videoBitrate: 5_000_000, audioBitrate: 160_000, note: 'Set resolution, frame rate and bitrate yourself.' }
];

export function getExportPreset(id: string): ExportPreset {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[0]!;
}

export function exportSettingsFromPreset(presetId: string, durationUs: number): ExportSettings {
  const preset = getExportPreset(presetId);
  return {
    presetId: preset.id,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    videoBitrate: preset.videoBitrate,
    codec: 'h264',
    audioBitrate: preset.audioBitrate,
    globalOffsetUs: 0,
    rangeStartUs: 0,
    rangeEndUs: durationUs,
    includeAudio: true,
    fileName: ''
  };
}

/** Compatibility checks surfaced before a render starts, not after it fails. */
export function validateExportSettings(s: ExportSettings): string[] {
  const errors: string[] = [];
  if (s.width < 128 || s.height < 128) errors.push('Resolution must be at least 128px on both axes.');
  if (s.width > 7680 || s.height > 4320) errors.push('Resolution above 8K is not supported by browser encoders.');
  if (s.width % 2 !== 0 || s.height % 2 !== 0) errors.push('Width and height must both be even for H.264 encoding.');
  if (s.fps < 12 || s.fps > 60) errors.push('Frame rate must be between 12 and 60 fps.');
  if (s.videoBitrate < 500_000) errors.push('Video bitrate below 500 kbps will look heavily compressed.');
  if (s.videoBitrate > 60_000_000) errors.push('Video bitrate above 60 Mbps is unlikely to encode in real time.');
  if (s.rangeEndUs <= s.rangeStartUs) errors.push('The export range is empty or inverted.');
  if (s.audioBitrate < 48_000) errors.push('Audio bitrate below 48 kbps will sound badly degraded.');
  return errors;
}

/** Rough output size, shown before the render so there are no surprises. */
export function estimateOutputBytes(s: ExportSettings): number {
  const seconds = Math.max(0, (s.rangeEndUs - s.rangeStartUs) / 1_000_000);
  const videoBits = seconds * s.videoBitrate;
  const audioBits = s.includeAudio ? seconds * s.audioBitrate : 0;
  return Math.round((videoBits + audioBits) / 8);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Frames and a wall-clock ETA. The multiplier is deliberately conservative:
 * canvas rasterisation plus hardware encode typically runs 2-5x realtime on a
 * mid-range laptop, and over-promising here is how you lose a user's evening.
 */
export function estimateRender(s: ExportSettings, realtimeFactor = 3): { frames: number; etaSeconds: number } {
  const seconds = Math.max(0, (s.rangeEndUs - s.rangeStartUs) / 1_000_000);
  return { frames: Math.round(seconds * s.fps), etaSeconds: Math.round(seconds * realtimeFactor) };
}
