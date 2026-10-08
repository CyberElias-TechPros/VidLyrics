import { usFromSeconds } from '../time';

export interface DecodedWav {
  /** Interleaved float PCM in the file's original channel layout. */
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  frames: number;
  durationUs: number;
}

const readFourCc = (view: DataView, offset: number): string =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/** Parse a regular RIFF/WAVE PCM or IEEE-float file without Web Audio. */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  if (buffer.byteLength < 12) throw new Error('WAV file is too short.');
  const view = new DataView(buffer);
  if (readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') {
    throw new Error('Audio file is not a RIFF/WAVE file.');
  }

  let format: { audioFormat: number; channels: number; sampleRate: number; blockAlign: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  let cursor = 12;

  while (cursor + 8 <= buffer.byteLength) {
    const id = readFourCc(view, cursor);
    const size = view.getUint32(cursor + 4, true);
    const start = cursor + 8;
    const end = start + size;
    if (end > buffer.byteLength) throw new Error('WAV chunk extends beyond the end of the file.');

    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV format chunk is incomplete.');
      format = {
        audioFormat: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        blockAlign: view.getUint16(start + 12, true),
        bitsPerSample: view.getUint16(start + 14, true)
      };
    } else if (id === 'data' && dataOffset < 0) {
      dataOffset = start;
      dataSize = size;
    }

    cursor = end + (size & 1);
  }

  if (!format || dataOffset < 0) throw new Error('WAV file is missing its format or audio data.');
  const { audioFormat, channels, sampleRate, blockAlign, bitsPerSample } = format;
  if (channels < 1 || sampleRate < 1 || blockAlign < 1) throw new Error('WAV format has invalid audio dimensions.');
  if (![8, 16, 24, 32, 64].includes(bitsPerSample)) throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}.`);
  if (audioFormat !== 1 && audioFormat !== 3) throw new Error(`Unsupported WAV encoding: ${audioFormat}.`);
  if (audioFormat === 3 && bitsPerSample !== 32 && bitsPerSample !== 64) {
    throw new Error(`Unsupported floating-point WAV bit depth: ${bitsPerSample}.`);
  }

  const bytesPerSample = bitsPerSample / 8;
  if (blockAlign < channels * bytesPerSample) throw new Error('WAV block alignment is invalid.');
  const frames = Math.floor(dataSize / blockAlign);
  const samples = new Float32Array(frames * channels);

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataOffset + frame * blockAlign + channel * bytesPerSample;
      let sample: number;
      if (audioFormat === 3) {
        sample = bitsPerSample === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
      } else if (bitsPerSample === 8) {
        sample = (view.getUint8(offset) - 128) / 128;
      } else if (bitsPerSample === 16) {
        sample = view.getInt16(offset, true) / 32768;
      } else if (bitsPerSample === 24) {
        let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
        if (value & 0x800000) value |= 0xff000000;
        sample = value / 8_388_608;
      } else {
        sample = view.getInt32(offset, true) / 2_147_483_648;
      }
      samples[frame * channels + channel] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    }
  }

  return { samples, sampleRate, channels, frames, durationUs: usFromSeconds(frames / sampleRate) };
}
