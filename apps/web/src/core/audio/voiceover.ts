import type { Line } from '../types';

/**
 * A compact content signature for generated speech. It intentionally covers
 * lyric order, text, and cue starts: changing any of those makes the rendered
 * voice track stale, while changing only a cue end does not.
 */
const signatureCache = new WeakMap<Line[], string>();

export function voiceoverSourceSignature(lines: Line[]): string {
  const cached = signatureCache.get(lines);
  if (cached) return cached;

  let hash = 0x811c9dc5;
  let hasLine = false;
  const add = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const line of lines) {
    if (line.text.trim().length === 0) continue;
    if (hasLine) add('\u001e');
    add(`${line.id}\u001f${line.text}\u001f${Math.round(line.start)}`);
    hasLine = true;
  }
  const signature = (hash >>> 0).toString(16).padStart(8, '0');
  signatureCache.set(lines, signature);
  return signature;
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
}

/** Mix a mono voice track over interleaved music, preserving the music's rate. */
export function mixVoiceover(options: MixVoiceoverOptions): Float32Array {
  const {
    music, musicSampleRate, channels, voice, voiceSampleRate,
    voiceTimelineOffsetUs, musicGain, voiceGain, rangeStartUs, rangeEndUs
  } = options;
  const safeChannels = Math.max(1, Math.floor(channels));
  const musicFrames = Math.floor(music.length / safeChannels);
  const startFrame = Math.min(musicFrames, Math.max(0, Math.floor(((rangeStartUs ?? 0) / 1_000_000) * musicSampleRate)));
  const endFrame = Math.min(
    musicFrames,
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
      const index = absoluteFrame * safeChannels + channel;
      const outputIndex = frame * safeChannels + channel;
      const mixed = (music[index] ?? 0) * safeMusicGain + speech * safeVoiceGain;
      // Avoid hard wrap/clipping in the final AAC/WAV encode. The default mix
      // ducks music, so this clamp should only touch unusually hot overlaps.
      output[outputIndex] = Math.max(-1, Math.min(1, mixed));
    }
  }
  return output;
}
