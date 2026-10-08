import type { Microseconds } from '../types';
import { usFromSeconds } from '../time';
import type { ErrorCode } from '../errors';

/**
 * Input validation for user-supplied files.
 *
 * Everything here is a pure function so it can be tested without a browser, and
 * so inexpensive checks (empty/oversize and obvious non-media files) happen
 * before decoding; codec recognition is deferred to the browser and bundled
 * local decoders because extensions and MIME types are not reliable.
 */

export const MAX_AUDIO_BYTES = 250 * 1024 * 1024; // 250 MB
export const SOFT_AUDIO_BYTES = 80 * 1024 * 1024; // warn, do not block
export const MAX_AUDIO_DURATION_US: Microseconds = usFromSeconds(60 * 20); // 20 minutes
export const SOFT_AUDIO_DURATION_US: Microseconds = usFromSeconds(60 * 6);

// Candidate audio files include common and long-tail codecs/containers. The
// decoder sniffs file signatures and may reject codecs unavailable locally.
export const AUDIO_EXTENSIONS = [
  'mp3', 'mp2', 'wav', 'wave', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'webm', 'aiff', 'aif', 'aifc', 'caf',
  'mp4', 'mov', 'm4v', '3gp', '3g2', 'mkv', 'mka', 'avi', 'amr', 'gsm', 'wma', 'ape', 'wv', 'tta', 'mpc', 'dsf', 'dff',
  'eac3', 'ac3', 'dts', 'qoa', 'mod', 'xm', 's3m', 'it', 'mpa', 'm1a', 'm2a', 'au', 'snd', 'voc', 'mpg', 'mpeg'
];

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'];

export const LYRIC_EXTENSIONS = ['lrc', 'srt', 'vtt', 'ass', 'ssa', 'txt', 'json'];

export const PROJECT_EXTENSIONS = ['vidlyricsproject', 'vlsp', 'json'];

export type FileKind = 'audio' | 'image' | 'lyrics' | 'project' | 'unknown';

export interface FileCheck {
  ok: boolean;
  /** Blocking problem; the file must not be used. */
  errorCode?: ErrorCode;
  /** Non-blocking advice, shown alongside a successful import. */
  warning?: string;
  kind: FileKind;
}

export function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function classifyFile(name: string, mimeType: string): FileKind {
  const ext = extensionOf(name);
  const normalizedMime = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (AUDIO_EXTENSIONS.includes(ext) || normalizedMime.startsWith('audio/') || normalizedMime.startsWith('video/') || normalizedMime === 'application/ogg') return 'audio';
  if (IMAGE_EXTENSIONS.includes(ext) || mimeType.startsWith('image/')) return 'image';
  if (ext === 'vidlyricsproject' || ext === 'vlsp') return 'project';
  if (LYRIC_EXTENSIONS.includes(ext)) return 'lyrics';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return 'lyrics';
  return 'unknown';
}

export function validateAudioFile(name: string, mimeType: string, bytes: number): FileCheck {
  const kind = classifyFile(name, mimeType);
  if (bytes === 0) {
    return { ok: false, errorCode: 'AUDIO_EMPTY', kind: 'audio' };
  }
  if (kind === 'lyrics' || kind === 'image' || kind === 'project') {
    return { ok: false, errorCode: 'AUDIO_UNSUPPORTED_FORMAT', kind: 'audio' };
  }
  // `unknown` is intentionally allowed: the file signature may identify an
  // audio codec whose extension or MIME type is not in our candidate catalog.
  if (bytes > MAX_AUDIO_BYTES) {
    return { ok: false, errorCode: 'AUDIO_TOO_LARGE', kind: 'audio' };
  }
  if (bytes > SOFT_AUDIO_BYTES) {
    return {
      ok: true,
      kind: 'audio',
      warning: 'That is a large file. Decoding and exporting it will use a lot of memory on this device.'
    };
  }
  return { ok: true, kind: 'audio' };
}

export function validateAudioDuration(durationUs: Microseconds): FileCheck {
  if (durationUs <= 0) return { ok: false, errorCode: 'AUDIO_EMPTY', kind: 'audio' };
  if (durationUs > MAX_AUDIO_DURATION_US) {
    return { ok: false, errorCode: 'AUDIO_TOO_LONG', kind: 'audio' };
  }
  if (durationUs > SOFT_AUDIO_DURATION_US) {
    return { ok: true, kind: 'audio', warning: 'Tracks over six minutes may not export in one pass. Consider exporting a range.' };
  }
  return { ok: true, kind: 'audio' };
}

export function validateLyricsText(text: string): { ok: boolean; lineCount: number; errorCode?: ErrorCode } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, lineCount: 0, errorCode: 'LYRICS_EMPTY' };
  return { ok: true, lineCount: lines.length };
}

/** Strip anything that could break out of an attribute or a download filename. */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/** Content hash for asset dedupe and for verifying re-linked audio on import. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic fallback so dedupe still works where SubtleCrypto is absent
  // (non-secure contexts). Not a security boundary — asset ids never authorise.
  const view = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < view.length; i += 97) {
    h1 = Math.imul(h1 ^ (view[i] ?? 0), 16777619) >>> 0;
    h2 = Math.imul(h2 + (view[i] ?? 0), 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.padEnd(64, '0').slice(0, 64);
}
