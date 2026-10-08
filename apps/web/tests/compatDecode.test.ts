import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatibilityDecodeError, decodeWithCompatibilityCodec } from '../src/media/audio/compatDecode';
import { decodeAudioFile } from '../src/media/audio/decode';

function readAudioFixture(name: string): ArrayBuffer {
  const source = readFileSync(new URL(`./fixtures/audio/${name}`, import.meta.url));
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  return buffer;
}

function makePcm16Wav(): ArrayBuffer {
  const buffer = new ArrayBuffer(48);
  const view = new DataView(buffer);
  const fourCc = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  fourCc(0, 'RIFF');
  view.setUint32(4, 40, true);
  fourCc(8, 'WAVE');
  fourCc(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  fourCc(36, 'data');
  view.setUint32(40, 4, true);
  view.setInt16(44, 16_384, true);
  view.setInt16(46, -16_384, true);
  return buffer;
}

afterEach(() => vi.unstubAllGlobals());

describe('local audio codec fallback', () => {
  it('sniffs the content when the extension and MIME type are wrong', async () => {
    const result = await decodeWithCompatibilityCodec(makePcm16Wav(), 'mp3', 'audio/mpeg');
    expect(result.format).toBe('wav');
    expect(result.sampleRate).toBe(8_000);
    expect(result.channelData).toHaveLength(1);
    expect(Array.from(result.channelData[0] ?? [])).toEqual([0.5, -0.5]);
  });

  it('uses a bundled decoder when browser audio APIs and workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const result = await decodeAudioFile(makePcm16Wav(), { formatHint: 'mp3', mimeType: 'audio/mpeg', withSpectrum: false });
    expect(result.ranInWorker).toBe(false);
    expect(result.sampleRate).toBe(8_000);
    expect(result.channels).toBe(1);
    expect(Array.from(result.pcm)).toEqual([0.5, -0.5]);
  });

  it('reports an explicit unsupported-format error for unidentified data', async () => {
    const buffer = new TextEncoder().encode('not an audio stream').buffer;
    await expect(decodeWithCompatibilityCodec(buffer, 'unknown', 'application/octet-stream'))
      .rejects.toMatchObject({ name: 'CompatibilityDecodeError', errorCode: 'AUDIO_UNSUPPORTED_FORMAT' });
  });

  it('decodes AAC audio from an MP4 container locally', async () => {
    const result = await decodeWithCompatibilityCodec(readAudioFixture('video-aac.mp4'), 'mp4', 'video/mp4');
    expect(result.format).toBe('m4a');
    expect(result.sampleRate).toBe(48_000);
    expect(result.channelData).toHaveLength(2);
    expect(result.channelData[0]?.length).toBeGreaterThan(0);
  });

  it('decodes common 24-bit ALAC audio from an M4A container locally', async () => {
    const result = await decodeWithCompatibilityCodec(readAudioFixture('alac24-mono.m4a'), 'm4a', 'audio/mp4');
    expect(result.format).toBe('m4a');
    expect(result.sampleRate).toBe(44_100);
    expect(result.channelData).toHaveLength(1);
    expect(result.channelData[0]?.length).toBe(22_050);
    expect(result.channelData[0]?.some((sample) => sample !== 0)).toBe(true);
  });

  it('does not claim an unavailable local container decoder exists', async () => {
    const buffer = new Uint8Array(32);
    buffer.set(new TextEncoder().encode('....ftypM4A '), 0);
    await expect(decodeWithCompatibilityCodec(buffer.buffer, 'm4a'))
      .rejects.toBeInstanceOf(CompatibilityDecodeError);
  });
});
