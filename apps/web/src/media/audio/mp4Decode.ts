import type { Movie, Sample } from 'mp4box';

interface DecodedAudio {
  channelData: Float32Array[];
  sampleRate: number;
}

interface DescriptorNode {
  tag?: number;
  data?: Uint8Array;
  descs?: DescriptorNode[];
}

interface BoxNode {
  esds?: { esd?: DescriptorNode };
  boxes?: unknown[];
  wave?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findAudioSpecificConfig(description: unknown): Uint8Array | null {
  const queue: unknown[] = [description];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current) || visited.has(current)) continue;
    visited.add(current);

    const node = current as BoxNode;
    const descriptors = node.esds?.esd?.descs ?? [];
    const decoderConfig = descriptors.find((descriptor) => descriptor.tag === 4);
    const config = decoderConfig?.descs?.find((descriptor) => descriptor.tag === 5)?.data;
    if (config instanceof Uint8Array && config.length > 0) return config;

    if (Array.isArray(node.boxes)) queue.push(...node.boxes);
    if (node.wave) queue.push(node.wave);
  }

  return null;
}

async function decodeAlac(bytes: Uint8Array): Promise<DecodedAudio | null> {
  // This small MIT-licensed decoder handles common 16/24-bit mono or stereo
  // ALAC tracks directly from their MP4/M4A container. Other ALAC layouts stay
  // available to the browser-native decoder.
  const { openTrack, decodeTrack, closeTrack } = await import('@mgz-dev/alac');
  let track: ReturnType<typeof openTrack>;
  try {
    track = openTrack(bytes);
  } catch {
    return null;
  }
  if (!track) return null;

  try {
    const { sampleRate, channels, bits, samples, bytesPerSample } = track;
    const bytesPerChannel = bits / 8;
    const frameBytes = bytesPerChannel * channels;
    if (
      !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(samples) || samples <= 0 ||
      (channels !== 1 && channels !== 2) ||
      (bits !== 16 && bits !== 24) ||
      bytesPerSample !== frameBytes
    ) return null;

    const channelData = Array.from({ length: channels }, () => new Float32Array(samples));
    const chunkFrames = 32_768;
    for (let start = 0; start < samples; start += chunkFrames) {
      const count = Math.min(chunkFrames, samples - start);
      const pcm = decodeTrack(track, start, count);
      if (pcm.byteLength !== count * frameBytes) {
        throw new Error('The ALAC decoder returned an incomplete sample block.');
      }
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let frame = 0; frame < count; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const offset = frame * frameBytes + channel * bytesPerChannel;
          let sample: number;
          if (bits === 16) {
            sample = view.getInt16(offset, true) / 32_768;
          } else {
            const unsigned = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
            const signed = unsigned & 0x80_0000 ? unsigned - 0x100_0000 : unsigned;
            sample = signed / 8_388_608;
          }
          channelData[channel]![start + frame] = sample;
        }
      }
    }
    return { channelData, sampleRate };
  } finally {
    closeTrack(track);
  }
}

async function decodeAacMp4(samples: Sample[], audioSpecificConfig: Uint8Array): Promise<DecodedAudio> {
  const { AACDecoder } = await import('@wasm-audio-decoders/aac');
  const decoder = new AACDecoder({ audioSpecificConfig });
  try {
    await decoder.ready;
    const result = await decoder.decodeFrames(samples.map((sample) => {
      if (!sample.data || sample.data.length === 0) throw new Error('The MP4 audio track contains an empty AAC sample.');
      return sample.data;
    }));
    return { channelData: result.channelData, sampleRate: result.sampleRate };
  } finally {
    decoder.free();
  }
}

async function decodeAacTrack(buffer: ArrayBuffer): Promise<DecodedAudio | null> {
  const { createFile, MP4BoxBuffer } = await import('mp4box');
  const file = createFile();
  const samples: Sample[] = [];

  return new Promise<DecodedAudio | null>((resolve, reject) => {
    let parsed = false;
    let settled = false;
    const finish = (audio: DecodedAudio | null) => {
      if (settled) return;
      settled = true;
      resolve(audio);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('The MP4 audio track could not be read.'));
    };

    file.onError = (_module: string, message: string) => fail(new Error(`MP4 container parsing failed: ${message}`));
    file.onReady = (info: Movie) => {
      parsed = true;
      try {
        const track = info.audioTracks.find((candidate) => candidate.codec === 'mp4a.40' || candidate.codec.startsWith('mp4a.40.'));
        if (!track) {
          finish(null);
          return;
        }

        file.onSamples = (trackId, _user, batch) => {
          if (trackId === track.id) samples.push(...batch);
        };
        file.setExtractionOptions(track.id, undefined, { nbSamples: 1_000 });
        file.start();
        file.flush();
        file.stop();

        const audioSpecificConfig = findAudioSpecificConfig(samples[0]?.description);
        if (!audioSpecificConfig) throw new Error('The MP4 AAC track is missing its AudioSpecificConfig.');
        if (samples.length === 0) throw new Error('The MP4 AAC track contains no audio samples.');
        void decodeAacMp4(samples, audioSpecificConfig).then(finish, fail);
      } catch (error) {
        fail(error);
      }
    };

    try {
      const source = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
      file.appendBuffer(source);
      file.flush();
      if (!parsed && !settled) fail(new Error('The MP4 container did not include complete audio metadata.'));
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Local fallback for common AAC and ALAC audio tracks in MP4-family containers.
 * Browser-native decoding remains first; this path is only used when it fails.
 */
export async function decodeMp4Audio(bytes: Uint8Array): Promise<DecodedAudio | null> {
  const alac = await decodeAlac(bytes);
  if (alac) return alac;
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return decodeAacTrack(buffer);
}
