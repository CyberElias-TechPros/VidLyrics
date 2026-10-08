import type { AppError, RecoveryRoute } from './types';

/**
 * Error catalogue.
 *
 * Every failure the product can reach is defined here, with a plain-language
 * explanation and at least one route forward. There is no code path that shows
 * a bare "Something went wrong" toast — an error with no recovery route is a
 * bug in this file, not in the UI.
 */

export type ErrorCode =
  | 'AUDIO_UNSUPPORTED_FORMAT'
  | 'AUDIO_DECODE_FAILED'
  | 'AUDIO_TOO_LARGE'
  | 'AUDIO_TOO_LONG'
  | 'AUDIO_EMPTY'
  | 'AUDIOCONTEXT_BLOCKED'
  | 'STORAGE_QUOTA'
  | 'MULTIPLE_TABS'
  | 'WEBCODECS_UNAVAILABLE'
  | 'ENCODER_FAILED'
  | 'OUT_OF_MEMORY'
  | 'RENDER_INTERRUPTED'
  | 'TAB_THROTTLED'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'MODEL_CANCELLED'
  | 'WEBGPU_UNAVAILABLE'
  | 'ALIGNMENT_LOW_CONFIDENCE'
  | 'IMPORT_INVALID_PROJECT'
  | 'IMPORT_FUTURE_VERSION'
  | 'IMPORT_INVALID_LYRICS'
  | 'IMPORT_MISSING_ASSET'
  | 'LYRICS_EMPTY'
  | 'NO_AUDIO_FOR_RENDER'
  | 'FONT_UNAVAILABLE'
  | 'NETWORK_OFFLINE'
  | 'WORKER_UNREACHABLE'
  | 'CANCELLED'
  | 'UNKNOWN';

interface Definition {
  title: string;
  detail: string;
  recovery: RecoveryRoute[];
  retryable: boolean;
  fatal: boolean;
}

const CATALOGUE: Record<ErrorCode, Definition> = {
  AUDIO_UNSUPPORTED_FORMAT: {
    title: 'No compatible local decoder found',
    detail:
      'This release could not identify or decode the file. Browser support varies by codec; the app also includes local decoders for MP3, AAC, FLAC, Ogg Vorbis/Opus, WAV, AIFF, CAF, AMR, GSM, WMA, APE, WavPack, Musepack, TTA, DSD, QOA, AC-3/E-AC-3, tracker modules, and AAC or common 16/24-bit mono/stereo ALAC tracks in MP4-family containers. Try re-exporting as PCM WAV or MP3 if this file still fails.',
    recovery: ['try-different-file', 'documentation'],
    retryable: false,
    fatal: false
  },
  AUDIO_DECODE_FAILED: {
    title: 'The file could not be decoded',
    detail:
      'The file may be truncated, corrupted, encrypted, or use a damaged stream. VidLyrics tries the browser decoder and bundled local codec decoders; if both fail, re-export the track as uncompressed PCM WAV and import it again.',
    recovery: ['try-different-file', 'documentation'],
    retryable: true,
    fatal: false
  },
  AUDIO_TOO_LARGE: {
    title: 'That file is larger than the browser can hold in memory',
    detail:
      'Decoding happens entirely in this tab, so a very large file can exhaust it. A 20-minute track at 320 kbps is the practical ceiling on most machines.',
    recovery: ['shorter-range', 'try-different-file', 'documentation'],
    retryable: false,
    fatal: false
  },
  AUDIO_TOO_LONG: {
    title: 'That track is longer than the recommended limit',
    detail:
      'You can still work with it, but exporting the whole thing in one pass may run out of memory. Export a section instead, or lower the resolution.',
    recovery: ['shorter-range', 'lower-resolution', 'documentation'],
    retryable: false,
    fatal: false
  },
  AUDIO_EMPTY: {
    title: 'That file contains no audio',
    detail: 'The decoder reported zero samples. The file may be a playlist stub or a download that did not finish.',
    recovery: ['try-different-file'],
    retryable: false,
    fatal: false
  },
  AUDIOCONTEXT_BLOCKED: {
    title: 'Audio needs one click to start',
    detail:
      'Browsers block audio until you interact with the page. Press play and audio will start immediately — nothing was lost.',
    recovery: ['retry'],
    retryable: true,
    fatal: false
  },
  STORAGE_QUOTA: {
    title: 'Your browser storage is full',
    detail:
      'Projects and audio are stored locally so nothing is uploaded. Free space by removing projects you no longer need, then try again.',
    recovery: ['remove-project', 'documentation'],
    retryable: true,
    fatal: false
  },
  MULTIPLE_TABS: {
    title: 'This project is open in another tab',
    detail:
      'Two tabs editing the same project will overwrite each other. Close the other tab, or continue here and accept that its changes will be replaced.',
    recovery: ['close-other-tab'],
    retryable: false,
    fatal: false
  },
  WEBCODECS_UNAVAILABLE: {
    title: 'This browser cannot encode MP4 locally',
    detail:
      'WebCodecs is required for fast, frame-accurate export and is available in Chrome, Edge and Opera. Safari and Firefox cannot export here yet. Your project is saved, and you can still export subtitles and the project file.',
    recovery: ['update-browser', 'documentation'],
    retryable: false,
    fatal: false
  },
  ENCODER_FAILED: {
    title: 'The video encoder stopped unexpectedly',
    detail:
      'This usually means the encoder ran out of memory or the GPU was reclaimed. Try a lower resolution or a shorter range — your timings are all saved.',
    recovery: ['lower-resolution', 'shorter-range', 'retry'],
    retryable: true,
    fatal: false
  },
  OUT_OF_MEMORY: {
    title: 'The browser ran out of memory during export',
    detail:
      'Encoding a long track at high resolution needs more RAM than this tab can get. Lower the resolution, shorten the range, or export in two halves.',
    recovery: ['lower-resolution', 'shorter-range', 'documentation'],
    retryable: true,
    fatal: false
  },
  RENDER_INTERRUPTED: {
    title: 'Export was interrupted',
    detail:
      'The tab lost focus or was throttled by the operating system. Keep this tab in the foreground while exporting, or export a shorter range.',
    recovery: ['retry', 'shorter-range', 'documentation'],
    retryable: true,
    fatal: false
  },
  TAB_THROTTLED: {
    title: 'Background tabs slow down or stop rendering',
    detail:
      'Mobile and desktop browsers throttle timers in hidden tabs, which stalls a long export. Keep this tab visible until it finishes.',
    recovery: ['retry', 'documentation'],
    retryable: true,
    fatal: false
  },
  MODEL_DOWNLOAD_FAILED: {
    title: 'The model download failed',
    detail:
      'Automatic alignment needs a one-time model download. Your connection dropped part way. You can retry, choose the smaller model, or sync manually instead — manual tap-sync needs no download at all.',
    recovery: ['retry', 'smaller-model', 'manual-tap-sync'],
    retryable: true,
    fatal: false
  },
  MODEL_CANCELLED: {
    title: 'Model download cancelled',
    detail: 'No model was installed and nothing was changed. Sync manually, or start the download again when you are ready.',
    recovery: ['manual-tap-sync', 'retry'],
    retryable: true,
    fatal: false
  },
  WEBGPU_UNAVAILABLE: {
    title: 'WebGPU is not available, so alignment will be slower',
    detail:
      'The app fell back to the WASM SIMD path automatically. Results are identical; a 3-minute song takes longer. Nothing is blocked.',
    recovery: ['retry', 'manual-tap-sync'],
    retryable: false,
    fatal: false
  },
  ALIGNMENT_LOW_CONFIDENCE: {
    title: 'Automatic timing does not look reliable on this track',
    detail:
      'Heavy reverb, layered vocals and dense production defeat alignment. The timings are marked low-confidence in the editor. Tap-sync gives you exact control in about a minute and works on any track.',
    recovery: ['manual-tap-sync', 'retry', 'documentation'],
    retryable: true,
    fatal: false
  },
  IMPORT_INVALID_PROJECT: {
    title: 'That is not a valid project file',
    detail: 'The file did not contain readable project data. Subtitle files (.lrc, .srt, .vtt, .ass) are imported with "Import lyrics" instead.',
    recovery: ['try-different-file', 'documentation'],
    retryable: false,
    fatal: false
  },
  IMPORT_FUTURE_VERSION: {
    title: 'This project was saved by a newer version',
    detail:
      'Opening it here would discard fields the newer version added, so it has been refused. Update the app to open this file.',
    recovery: ['update-browser', 'documentation'],
    retryable: false,
    fatal: true
  },
  IMPORT_INVALID_LYRICS: {
    title: 'Those lyrics could not be read',
    detail: 'No recognisable lyric lines were found. Paste the text directly instead, or check the file is plain text or a supported subtitle format.',
    recovery: ['try-different-file', 'documentation'],
    retryable: false,
    fatal: false
  },
  IMPORT_MISSING_ASSET: {
    title: 'The audio file for this project is not linked',
    detail:
      'Project files do not contain audio — that would make them enormous. Re-link the original audio file; the app verifies it by content hash.',
    recovery: ['try-different-file', 'documentation'],
    retryable: false,
    fatal: false
  },
  LYRICS_EMPTY: {
    title: 'There are no lyrics to time yet',
    detail: 'Paste lyrics, import a subtitle file, or start with an empty line list and add lines as you go.',
    recovery: ['documentation'],
    retryable: false,
    fatal: false
  },
  NO_AUDIO_FOR_RENDER: {
    title: 'Add audio before exporting a video',
    detail: 'A lyric video needs the audio track to mux into the output. Subtitle exports do not need audio.',
    recovery: ['try-different-file', 'documentation'],
    retryable: false,
    fatal: false
  },
  FONT_UNAVAILABLE: {
    title: 'A font did not finish loading',
    detail:
      'Rendering continued with a fallback font so nothing was lost. If the preview looks wrong, reload once — the font will be cached.',
    recovery: ['retry', 'documentation'],
    retryable: true,
    fatal: false
  },
  NETWORK_OFFLINE: {
    title: 'You are offline',
    detail:
      'Everything that matters works offline: editing, syncing, previewing and exporting all run on your device. Only optional model downloads need a connection.',
    recovery: ['manual-tap-sync', 'documentation'],
    retryable: false,
    fatal: false
  },
  WORKER_UNREACHABLE: {
    title: 'Optional service unavailable',
    detail:
      'The optional edge service is unreachable. This only affects anonymous usage counts and model downloads — the app itself is unaffected.',
    recovery: ['retry', 'documentation'],
    retryable: true,
    fatal: false
  },
  CANCELLED: {
    title: 'Cancelled',
    detail: 'The operation was stopped. Everything completed before that point was kept.',
    recovery: ['retry'],
    retryable: true,
    fatal: false
  },
  UNKNOWN: {
    title: 'Something went wrong',
    detail: 'The unexpected happened. Your project is saved locally, so a reload will bring it back. Manual tap-sync is always available if you need to keep working.',
    recovery: ['retry', 'manual-tap-sync', 'documentation'],
    retryable: true,
    fatal: false
  }
};

export function appError(code: ErrorCode, technical?: string): AppError {
  const def = CATALOGUE[code];
  return {
    code,
    title: def.title,
    detail: def.detail,
    recovery: def.recovery,
    retryable: def.retryable,
    fatal: def.fatal,
    technical
  };
}

export const RECOVERY_LABELS: Record<RecoveryRoute, string> = {
  retry: 'Try again',
  'manual-tap-sync': 'Sync manually instead',
  'lower-resolution': 'Lower the resolution',
  'shorter-range': 'Export a shorter range',
  'smaller-model': 'Use the smaller model',
  'remove-project': 'Free up storage',
  'close-other-tab': 'I closed the other tab',
  'update-browser': 'How to get a compatible browser',
  'try-different-file': 'Choose a different file',
  documentation: 'Read the guide'
};

export function isFatal(error: AppError): boolean {
  return error.fatal;
}
