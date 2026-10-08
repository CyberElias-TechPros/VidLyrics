import audioType from 'audio-type';

export interface CompatibilityDecodeResult {
  channelData: Float32Array[];
  sampleRate: number;
  format: string;
}

export class CompatibilityDecodeError extends Error {
  constructor(message: string, readonly errorCode: 'AUDIO_UNSUPPORTED_FORMAT' | 'AUDIO_DECODE_FAILED' | 'AUDIO_EMPTY') {
    super(message);
    this.name = 'CompatibilityDecodeError';
  }
}

function normalizeFormat(value: string | undefined): string | undefined {
  const valueLower = value?.toLowerCase().trim().replace(/^\./, '').split(';', 1)[0];
  if (!valueLower) return undefined;
  const mimeAliases: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp2': 'mp2',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/ogg': 'oga',
    'audio/vorbis': 'oga',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff',
    'audio/aac': 'aac',
    'audio/x-aac': 'aac',
    'audio/vnd.dlna.adts': 'aac',
    'audio/x-opus': 'opus',
    'audio/x-vorbis': 'oga',
    'audio/vnd.wave': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4b': 'm4a',
    'application/mp4': 'm4a',
    'application/x-m4a': 'm4a',
    'video/mp4': 'm4a',
    'video/quicktime': 'm4a',
    'video/3gpp': 'm4a',
    'video/3gpp2': 'm4a',
    'video/x-m4v': 'm4a',
    'audio/amr': 'amr',
    'audio/3gpp': 'amr',
    'audio/3gpp2': 'amr',
    'mp4': 'm4a',
    'm4b': 'm4a',
    'm4p': 'm4a',
    'm4v': 'm4a',
    'mov': 'm4a',
    '3gp': 'm4a',
    '3g2': 'm4a',
    'qt': 'm4a',
    'audio/x-ms-wma': 'wma',
    'audio/wma': 'wma',
    'audio/x-caf': 'caf',
    'audio/qoa': 'qoa',
    'audio/x-wavpack': 'wv',
    'application/ogg': 'oga'
  };
  return mimeAliases[valueLower] ?? valueLower;
}

function compatibleType(detected: string | undefined, formatHint?: string, mimeType?: string): string | undefined {
  // Prefer the file signature over the name or MIME type: filenames and browser
  // MIME labels are frequently missing or wrong for user-supplied music files.
  const value = normalizeFormat(detected) ?? normalizeFormat(formatHint) ?? normalizeFormat(mimeType);
  if (value === 'ogg') return 'oga';
  if (value === 'aif' || value === 'aifc') return 'aiff';
  if (value === 'wavpack') return 'wv';
  if (value === 'monkeysaudio') return 'ape';
  if (value === 'musepack') return 'mpc';
  if (value === 'dsd') return 'dsf';
  if (value === 'mp2') return 'mp3';
  return value;
}

type DecodedAudio = { channelData: Float32Array[]; sampleRate: number };
const RECOGNIZED_AUDIO_TYPES = new Set([
  'wav', 'aiff', 'mp3', 'aac', 'flac', 'tta', 'm4a', 'opus', 'oga', 'qoa', 'caf', 'wma', 'amr',
  'gsm', 'wv', 'mpc', 'ape', 'dsf', 'dff', 'eac3', 'ac3', 'dts', 'it', 's3m', 'xm', 'mod', 'mkv', 'webm', 'avi'
]);

async function decodeKnownFormat(format: string, bytes: Uint8Array): Promise<DecodedAudio | null> {
  switch (format) {
    case 'mp3': return (await import('@audio/decode-mp3')).default(bytes);
    case 'flac': return (await import('@audio/decode-flac')).default(bytes);
    case 'opus': return (await import('@audio/decode-opus')).default(bytes);
    case 'oga': return (await import('@audio/decode-vorbis')).default(bytes);
    case 'aac': {
      const { AACDecoder } = await import('@wasm-audio-decoders/aac');
      const decoder = new AACDecoder();
      try {
        await decoder.ready;
        return await decoder.decodeFile(bytes);
      } finally {
        decoder.free();
      }
    }
    case 'm4a': return (await import('./mp4Decode')).decodeMp4Audio(bytes);
    case 'wav': return (await import('@audio/decode-wav')).default(bytes);
    case 'aiff': return (await import('@audio/decode-aiff')).default(bytes);
    case 'caf': return (await import('@audio/decode-caf')).default(bytes);
    case 'amr': return (await import('@audio/decode-amr')).default(bytes);
    case 'gsm': return (await import('@audio/decode-gsm')).default(bytes);
    case 'wma': return (await import('@audio/decode-wma')).default(bytes);
    case 'ape': return (await import('@audio/decode-ape')).default(bytes);
    case 'ac3':
    case 'eac3': return (await import('@audio/decode-eac3')).default(bytes);
    case 'wv': return (await import('@audio/decode-wavpack')).default(bytes);
    case 'tta': return (await import('@audio/decode-tta')).default(bytes);
    case 'mpc': return (await import('@audio/decode-mpc')).default(bytes);
    case 'dsf':
    case 'dff': return (await import('@audio/decode-dsd')).default(bytes);
    case 'mod':
    case 'xm':
    case 's3m':
    case 'it': return (await import('@audio/decode-mod')).default(bytes);
    case 'qoa': return (await import('@audio/decode-qoa')).default(bytes);
    default: return null;
  }
}

function validateDecodedAudio(audio: DecodedAudio, format: string): CompatibilityDecodeResult {
  const channelData = audio.channelData.filter((channel) => channel instanceof Float32Array);
  if (channelData.length === 0 || channelData.some((channel) => channel.length === 0)) {
    throw new CompatibilityDecodeError(`The ${format.toUpperCase()} decoder returned no audio samples.`, 'AUDIO_EMPTY');
  }
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate < 1) {
    throw new CompatibilityDecodeError(`The ${format.toUpperCase()} decoder reported an invalid sample rate.`, 'AUDIO_DECODE_FAILED');
  }
  return { channelData, sampleRate: audio.sampleRate, format };
}

/**
 * Browser-native decoding varies by OS, browser, and codec build. When it does
 * not recognize a file, use local, format-specific decoders bundled with the
 * app. No audio bytes are sent over the network.
 */
export async function decodeWithCompatibilityCodec(
  buffer: ArrayBuffer,
  formatHint?: string,
  mimeType?: string
): Promise<CompatibilityDecodeResult> {
  const bytes = new Uint8Array(buffer);
  const format = compatibleType(audioType(bytes), formatHint, mimeType);
  if (!format || !RECOGNIZED_AUDIO_TYPES.has(format)) {
    throw new CompatibilityDecodeError(
      'The browser could not decode this file, and its audio format could not be identified locally. Try a standard audio export such as PCM WAV or MP3.',
      'AUDIO_UNSUPPORTED_FORMAT'
    );
  }

  let audio: DecodedAudio | null;
  try {
    audio = await decodeKnownFormat(format, bytes);
  } catch (error) {
    throw new CompatibilityDecodeError(
      `The bundled ${format.toUpperCase()} decoder could not read this file${error instanceof Error ? `: ${error.message}` : '.'}`,
      'AUDIO_DECODE_FAILED'
    );
  }
  if (!audio) {
    throw new CompatibilityDecodeError(
      `No compatible local decoder is bundled for ${format.toUpperCase()} audio. Try exporting the track as WAV or MP3.`,
      'AUDIO_UNSUPPORTED_FORMAT'
    );
  }
  return validateDecodedAudio(audio, format);
}
