import type { Line, Microseconds } from '../types';
import { spokenTextForScene } from '../lyrics/script';

/**
 * A compact content signature for generated speech. It intentionally covers
 * lyric order, spoken text, and cue starts: changing any of those makes the
 * rendered voice track stale, while changing only a cue end does not.
 */
const signatureCache = new WeakMap<Line[], string>();

export interface VoiceoverSignatureOptions {
  voiceIdB?: string | null;
}

export function voiceoverSourceSignature(lines: Line[], options?: VoiceoverSignatureOptions): string {
  const voiceB = options?.voiceIdB?.trim() || null;
  if (!voiceB) {
    const cached = signatureCache.get(lines);
    if (cached) return cached;
  }

  let hash = 0x811c9dc5;
  let hasLine = false;
  const add = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  if (voiceB) add(`vb:${voiceB}\u001d`);
  for (const line of lines) {
    const spoken = line.scene ? spokenTextForScene(line) : line.text;
    if (spoken.trim().length === 0) continue;
    if (hasLine) add('\u001e');
    const speakerTag = voiceB && line.speaker === 'B' ? '\u001fB' : '';
    add(`${line.id}\u001f${spoken}\u001f${Math.round(line.start)}${speakerTag}`);
    hasLine = true;
  }
  const signature = (hash >>> 0).toString(16).padStart(8, '0');
  if (!voiceB) signatureCache.set(lines, signature);
  return signature;
}

export interface SequentialClipInput {
  lineId: string;
  samples: Float32Array;
}

export interface SequentialVoiceoverResult {
  pcm: Float32Array;
  sampleRate: number;
  durationUs: Microseconds;
  cues: { lineId: string; startUs: Microseconds; endUs: Microseconds }[];
}

/**
 * Concatenate per-scene speech clips end-to-end and emit sample-exact timings.
 * This powers the local script-to-video workflow where audio length drives each
 * visual scene's exact duration.
 */
export function stitchSequentialVoiceClips(
  clips: SequentialClipInput[],
  sampleRate: number,
  options: { leadInUs?: Microseconds; pauseUs?: Microseconds; tailUs?: Microseconds } = {}
): SequentialVoiceoverResult {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive.');
  }
  const leadFrames = Math.max(0, Math.round(((options.leadInUs ?? 120_000) * sampleRate) / 1_000_000));
  const pauseFrames = Math.max(0, Math.round(((options.pauseUs ?? 300_000) * sampleRate) / 1_000_000));
  const tailFrames = Math.max(0, Math.round(((options.tailUs ?? 240_000) * sampleRate) / 1_000_000));

  const nonEmpty = clips.filter((clip) => clip.samples.length > 0);
  if (nonEmpty.length === 0) {
    return { pcm: new Float32Array(0), sampleRate, durationUs: 0, cues: [] };
  }

  const totalClipFrames = nonEmpty.reduce((sum, clip) => sum + clip.samples.length, 0);
  const totalFrames = leadFrames + totalClipFrames + Math.max(0, nonEmpty.length - 1) * pauseFrames + tailFrames;
  const pcm = new Float32Array(totalFrames);
  const cues: SequentialVoiceoverResult['cues'] = [];

  let cursor = leadFrames;
  for (let i = 0; i < nonEmpty.length; i += 1) {
    const clip = nonEmpty[i]!;
    const startFrame = cursor;
    const endFrame = startFrame + clip.samples.length;
    for (let s = 0; s < clip.samples.length; s += 1) {
      pcm[startFrame + s] = Math.max(-1, Math.min(1, clip.samples[s] ?? 0));
    }
    cues.push({
      lineId: clip.lineId,
      startUs: Math.round((startFrame / sampleRate) * 1_000_000),
      endUs: Math.round((endFrame / sampleRate) * 1_000_000)
    });
    cursor = endFrame + (i < nonEmpty.length - 1 ? pauseFrames : tailFrames);
  }

  return {
    pcm,
    sampleRate,
    durationUs: Math.round((pcm.length / sampleRate) * 1_000_000),
    cues
  };
}

export interface StandaloneVoiceoverOptions {
  voice: Float32Array;
  voiceSampleRate: number;
  targetSampleRate?: number;
  voiceTimelineOffsetUs: number;
  voiceGain: number;
  rangeStartUs: number;
  rangeEndUs: number;
}

/**
 * Render a standalone mono voiceover buffer aligned to a video export window
 * (including intro/outro silence, global render offset and optional resampling
 * to 48 kHz when a browser's AAC encoder rejects 22.05 kHz).
 */
export function renderStandaloneVoiceover(options: StandaloneVoiceoverOptions): { pcm: Float32Array; sampleRate: number } {
  const {
    voice,
    voiceSampleRate,
    voiceTimelineOffsetUs,
    voiceGain,
    rangeStartUs,
    rangeEndUs
  } = options;
  const outRate = Math.max(8_000, Math.round(options.targetSampleRate ?? voiceSampleRate));
  const durationUs = Math.max(0, rangeEndUs - rangeStartUs);
  const frames = Math.max(0, Math.ceil((durationUs / 1_000_000) * outRate));
  const output = new Float32Array(frames);
  const safeGain = Math.max(0, Math.min(2, voiceGain));
  const startSeconds = rangeStartUs / 1_000_000;
  const offsetSeconds = voiceTimelineOffsetUs / 1_000_000;

  for (let frame = 0; frame < frames; frame += 1) {
    const timeSeconds = startSeconds + frame / outRate - offsetSeconds;
    const pos = timeSeconds * voiceSampleRate;
    if (pos >= 0 && pos < voice.length) {
      const before = Math.floor(pos);
      const after = Math.min(voice.length - 1, before + 1);
      const frac = pos - before;
      const sample = ((voice[before] ?? 0) * (1 - frac) + (voice[after] ?? 0) * frac) * safeGain;
      output[frame] = Math.max(-1, Math.min(1, sample));
    }
  }
  return { pcm: output, sampleRate: outRate };
}

export interface MixVoiceoverOptions {
  music: Float32Array;
  musicSampleRate: number;
  channels: number;
  voice: Float32Array;
  voiceSampleRate: number;
  /** Same intro + global-offset transform used by the rendered lyric scene. */
  voiceTimelineOffsetUs: number;
  musicGain: number;
  voiceGain: number;
  /** Optional export window; output begins at this absolute music time. */
  rangeStartUs?: number;
  rangeEndUs?: number;
  /** Keep emitting voice samples past the end of shorter background tracks. */
  extendToRangeEnd?: boolean;
}

/** Mix a mono voice track over interleaved music, preserving the music's rate. */
export function mixVoiceover(options: MixVoiceoverOptions): Float32Array {
  const {
    music, musicSampleRate, channels, voice, voiceSampleRate,
    voiceTimelineOffsetUs, musicGain, voiceGain, rangeStartUs, rangeEndUs, extendToRangeEnd
  } = options;
  const safeChannels = Math.max(1, Math.floor(channels));
  const musicFrames = Math.floor(music.length / safeChannels);
  const maxFrames = extendToRangeEnd && rangeEndUs !== undefined
    ? Math.max(musicFrames, Math.ceil((rangeEndUs / 1_000_000) * musicSampleRate))
    : musicFrames;
  const startFrame = Math.min(maxFrames, Math.max(0, Math.floor(((rangeStartUs ?? 0) / 1_000_000) * musicSampleRate)));
  const endFrame = Math.min(
    maxFrames,
    Math.max(startFrame, rangeEndUs === undefined ? musicFrames : Math.ceil((rangeEndUs / 1_000_000) * musicSampleRate))
  );
  const frames = endFrame - startFrame;
  const output = new Float32Array(frames * safeChannels);
  const safeMusicGain = Math.max(0, Math.min(2, musicGain));
  const safeVoiceGain = Math.max(0, Math.min(2, voiceGain));
  const offsetSeconds = voiceTimelineOffsetUs / 1_000_000;

  for (let frame = 0; frame < frames; frame += 1) {
    const absoluteFrame = startFrame + frame;
    const timeSeconds = absoluteFrame / musicSampleRate - offsetSeconds;
    const voicePosition = timeSeconds * voiceSampleRate;
    let speech = 0;
    if (voicePosition >= 0 && voicePosition < voice.length) {
      const before = Math.floor(voicePosition);
      const after = Math.min(voice.length - 1, before + 1);
      const fraction = voicePosition - before;
      speech = (voice[before] ?? 0) * (1 - fraction) + (voice[after] ?? 0) * fraction;
    }

    for (let channel = 0; channel < safeChannels; channel += 1) {
      const hasMusic = absoluteFrame < musicFrames;
      const index = absoluteFrame * safeChannels + channel;
      const outputIndex = frame * safeChannels + channel;
      const bg = hasMusic ? (music[index] ?? 0) * safeMusicGain : 0;
      const mixed = bg + speech * safeVoiceGain;
      // Avoid hard wrap/clipping in the final AAC/WAV encode. The default mix
      // ducks music, so this clamp should only touch unusually hot overlaps.
      output[outputIndex] = Math.max(-1, Math.min(1, mixed));
    }
  }
  return output;
}
