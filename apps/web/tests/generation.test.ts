import { describe, expect, it } from 'vitest';
import { resampleMono, whisperMillisecondsToUs } from '../src/core/audio/resample';
import { mixVoiceover, voiceoverSourceSignature } from '../src/core/audio/voiceover';
import { decodeWav } from '../src/core/audio/wav';
import { whisperSegmentsToCues } from '../src/core/lyrics/transcript';
import { createLine } from '../src/core/project/factory';
import { usFromSeconds } from '../src/core/time';
import { encodeWav } from '../src/media/export/encoder';

describe('browser-side generation helpers', () => {
  it('resamples mono audio to Whisper’s 16 kHz input rate without changing duration', () => {
    const source = new Float32Array(44_100).fill(0.25);
    const output = resampleMono(source, 44_100, 16_000);
    expect(output).toHaveLength(16_000);
    expect(Array.from(output).every((sample) => Math.abs(sample - 0.25) < 1e-6)).toBe(true);
  });

  it('returns a copy for equal-rate conversion and rejects invalid sample rates', () => {
    const source = Float32Array.from([0, 0.5, -0.5]);
    const output = resampleMono(source, 16_000, 16_000);
    expect(output).toEqual(source);
    expect(output).not.toBe(source);
    expect(() => resampleMono(source, 0, 16_000)).toThrow(RangeError);
  });

  it('converts the Whisper worker’s millisecond timestamps to microseconds', () => {
    expect(whisperMillisecondsToUs(125)).toBe(125_000);
    const cues = whisperSegmentsToCues([
      { text: '  Hello   world  ', t0: 1_250, t1: 2_340 },
      { text: 'late segment', t0: 3_000, t1: 4_500 }
    ], usFromSeconds(4));
    expect(cues).toEqual([
      { text: 'Hello world', startUs: 1_250_000, endUs: 2_340_000 },
      { text: 'late segment', startUs: 3_000_000, endUs: 4_000_000 }
    ]);
  });

  it('encodes and decodes a WAV voiceover as mono PCM', async () => {
    const source = Float32Array.from([-1, -0.5, 0, 0.5, 1]);
    const wav = encodeWav(source, 8_000, 1);
    const decoded = decodeWav(await wav.arrayBuffer());
    expect(decoded.sampleRate).toBe(8_000);
    expect(decoded.channels).toBe(1);
    expect(decoded.frames).toBe(source.length);
    expect(decoded.durationUs).toBe(625);
    expect(decoded.samples[0]).toBe(-1);
    expect(Math.abs((decoded.samples[3] ?? 0) - 0.5)).toBeLessThan(0.001);
  });

  it('rejects data that is not a RIFF/WAVE file', () => {
    expect(() => decodeWav(new ArrayBuffer(12))).toThrow(/RIFF\/WAVE/);
  });

  it('mixes voiceover at its timeline offset while preserving stereo music layout', () => {
    const mixed = mixVoiceover({
      music: new Float32Array([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]),
      musicSampleRate: 4,
      channels: 2,
      voice: new Float32Array([0.5, 0.5, 0.5, 0.5]),
      voiceSampleRate: 4,
      voiceTimelineOffsetUs: 500_000,
      musicGain: 0.5,
      voiceGain: 0.5
    });
    expect(mixed).toHaveLength(8);
    expect(mixed[0]).toBeCloseTo(0.1);
    expect(mixed[1]).toBeCloseTo(0.1);
    expect(mixed[2]).toBeCloseTo(0.1);
    expect(mixed[3]).toBeCloseTo(0.1);
    expect(mixed[4]).toBeCloseTo(0.35);
    expect(mixed[5]).toBeCloseTo(0.35);
    expect(mixed[6]).toBeCloseTo(0.35);
  });

  it('mixes only the requested absolute export range when building a compact audio track', () => {
    const mixed = mixVoiceover({
      music: Float32Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5]),
      musicSampleRate: 4,
      channels: 1,
      voice: new Float32Array(8),
      voiceSampleRate: 4,
      voiceTimelineOffsetUs: 0,
      musicGain: 1,
      voiceGain: 0,
      rangeStartUs: 500_000,
      rangeEndUs: 1_000_000
    });
    expect(mixed).toHaveLength(2);
    expect(mixed[0]).toBeCloseTo(0.2);
    expect(mixed[1]).toBeCloseTo(0.3);
  });

  it('tracks lyric order, text, and starts when deciding whether speech is stale', () => {
    const first = createLine('first line', { start: usFromSeconds(1), end: usFromSeconds(2) });
    const second = createLine('second line', { start: usFromSeconds(3), end: usFromSeconds(4) });
    const initial = voiceoverSourceSignature([first, second]);
    expect(voiceoverSourceSignature([{ ...first, end: usFromSeconds(2.5) }, second])).toBe(initial);
    expect(voiceoverSourceSignature([{ ...first, start: usFromSeconds(1.1) }, second])).not.toBe(initial);
    expect(voiceoverSourceSignature([second, first])).not.toBe(initial);
  });
});
