import { computePeaks, type PeakData } from '../../core/audio/peaks';
import { computeSpectrum, type SpectrumEnvelope } from '../../core/audio/spectrum';
import { usFromSeconds } from '../../core/time';
import type { ErrorCode } from '../../core/errors';
import { CompatibilityDecodeError, decodeWithCompatibilityCodec } from './compatDecode';

/**
 * Audio decode + analysis, with a worker fast path and a main-thread fallback.
 *
 * The fallback exists because worker construction fails in real deployments:
 * strict CSP without `worker-src`, a bundler that inlined the worker, or an
 * older Safari. When that happens the user should get a slower decode, not a
 * dead end.
 */

export interface DecodeResult {
  /** Mono mixdown, the input to every analysis pass. */
  pcm: Float32Array;
  /** Interleaved channels, the input to the encoder. */
  interleaved: Float32Array;
  sampleRate: number;
  channels: number;
  durationUs: number;
  peaks: PeakData;
  spectrum: SpectrumEnvelope | null;
  ranInWorker: boolean;
}

export interface DecodeOptions {
  withSpectrum?: boolean;
  onProgress?: (stage: 'decoding' | 'peaks' | 'spectrum', progress: number) => void;
  signal?: AbortSignal;
  formatHint?: string;
  mimeType?: string;
}

export class DecodeError extends Error {
  constructor(
    message: string,
    readonly errorCode: ErrorCode
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}

async function decodeOnMainThread(
  file: ArrayBuffer,
  options: DecodeOptions
): Promise<Omit<DecodeResult, 'ranInWorker'>> {
  const Ctor: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  let channelData: Float32Array[] | null = null;
  let sampleRate = 0;
  let durationSeconds = 0;
  if (Ctor) {
    const context = new Ctor();
    try {
      const buffer = await context.decodeAudioData(file.slice(0));
      if (buffer && buffer.length > 0) {
        sampleRate = buffer.sampleRate;
        durationSeconds = buffer.duration;
        channelData = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
      }
    } catch {
      // Continue with the bundled decoder below. Browser codec support differs
      // by operating system, browser, and the exact codec inside a container.
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  if (!channelData) {
    if (options.signal?.aborted) throw new DecodeError('Decoding was cancelled.', 'CANCELLED');
    options.onProgress?.('decoding', 0.2);
    try {
      const compatible = await decodeWithCompatibilityCodec(file, options.formatHint, options.mimeType);
      channelData = compatible.channelData;
      sampleRate = compatible.sampleRate;
      durationSeconds = Math.min(...channelData.map((channel) => channel.length)) / sampleRate;
    } catch (error) {
      if (error instanceof CompatibilityDecodeError) throw new DecodeError(error.message, error.errorCode);
      throw new DecodeError(error instanceof Error ? error.message : 'Audio decode failed.', 'AUDIO_DECODE_FAILED');
    }
  }

  if (options.signal?.aborted) throw new DecodeError('Decoding was cancelled.', 'CANCELLED');
  if (channelData.length === 0 || channelData.some((channel) => channel.length === 0)) {
    throw new DecodeError('The file decoded to zero samples.', 'AUDIO_EMPTY');
  }
  const channels = channelData.length;
  const length = Math.min(...channelData.map((channel) => channel.length));
  const interleaved = new Float32Array(length * channels);
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < channels; c += 1) interleaved[i * channels + c] = channelData[c]?.[i] ?? 0;
  }
  const pcm = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += channelData[c]?.[i] ?? 0;
    pcm[i] = sum / channels;
  }

  options.onProgress?.('peaks', 0);
  const peaks = await computePeaks(pcm, sampleRate, 1, {
    onProgress: (p) => options.onProgress?.('peaks', p),
    shouldCancel: () => options.signal?.aborted === true
  });

  let spectrum: SpectrumEnvelope | null = null;
  if (options.withSpectrum !== false) {
    options.onProgress?.('spectrum', 0);
    spectrum = await computeSpectrum(pcm, sampleRate, {
      onProgress: (p) => options.onProgress?.('spectrum', p),
      shouldCancel: () => options.signal?.aborted === true
    });
  }

  return {
    pcm,
    interleaved,
    sampleRate,
    channels,
    durationUs: usFromSeconds(durationSeconds || length / sampleRate),
    peaks,
    spectrum
  };
}

type WorkerMessage =
  | { type: 'PROGRESS'; id: number; stage: 'decoding' | 'peaks' | 'spectrum'; progress: number }
  | { type: 'DECODE_RESULT'; id: number; ok: false; errorCode: ErrorCode; message: string }
  | {
      type: 'DECODE_RESULT';
      id: number;
      ok: true;
      pcm: Float32Array;
      interleaved: Float32Array;
      sampleRate: number;
      channels: number;
      durationSeconds: number;
      peaks: PeakData;
      spectrum: SpectrumEnvelope | null;
    };

export async function decodeAudioFile(file: ArrayBuffer, options: DecodeOptions = {}): Promise<DecodeResult> {
  if (options.signal?.aborted) throw new DecodeError('Decoding was cancelled.', 'CANCELLED');
  try {
    const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    const result = await new Promise<DecodeResult>((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9);
      const abort = () => {
        worker.terminate();
        options.signal?.removeEventListener('abort', abort);
        reject(new DecodeError('Decoding was cancelled.', 'CANCELLED'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });

      worker.onmessage = (event: MessageEvent) => {
        const message = event.data as WorkerMessage;

        if (message.type === 'PROGRESS') {
          options.onProgress?.(message.stage, message.progress);
          return;
        }
        worker.terminate();
        options.signal?.removeEventListener('abort', abort);
        if (!message.ok) {
          reject(new DecodeError(message.message ?? 'decode failed', message.errorCode ?? 'AUDIO_DECODE_FAILED'));
          return;
        }
        const payload = message as unknown as {
          pcm: Float32Array;
          interleaved: Float32Array;
          sampleRate: number;
          channels: number;
          durationSeconds: number;
          peaks: PeakData;
          spectrum: SpectrumEnvelope | null;
        };
        resolve({
          pcm: payload.pcm,
          interleaved: payload.interleaved,
          sampleRate: payload.sampleRate,
          channels: payload.channels,
          durationUs: usFromSeconds(payload.durationSeconds),
          peaks: payload.peaks,
          spectrum: payload.spectrum,
          ranInWorker: true
        });
      };

      worker.onerror = () => {
        worker.terminate();
        options.signal?.removeEventListener('abort', abort);
        reject(new Error('worker failed'));
      };

      // Copy before transferring: the caller still owns `file` and may need it
      // for hashing or for a retry, and a transferred buffer is detached.
      const transferable = file.slice(0);
      worker.postMessage(
        {
          type: 'DECODE',
          id,
          buffer: transferable,
          withSpectrum: options.withSpectrum !== false,
          formatHint: options.formatHint,
          mimeType: options.mimeType
        },
        [transferable]
      );
    });
    return result;
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    if (options.signal?.aborted) throw new DecodeError('Decoding was cancelled.', 'CANCELLED');
    // Worker unavailable or crashed — same native + local-codec fallback, on the main thread.
    const fallback = await decodeOnMainThread(file, options);
    return { ...fallback, ranInWorker: false };
  }
}
