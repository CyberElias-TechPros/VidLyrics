/// <reference lib="webworker" />
import { computePeaks } from '../../core/audio/peaks';
import { computeSpectrum, type SpectrumEnvelope } from '../../core/audio/spectrum';

/**
 * Audio decode + analysis worker.
 *
 * Decoding a large file on the main thread freezes the UI for seconds, and the
 * analysis passes (peaks, spectral envelope) are far heavier still. Everything
 * below runs off the main thread so the editor stays responsive — including the
 * progress bar that reports on the work happening here.
 *
 * Fallback: if worker construction fails, `decode.ts` runs the same functions on
 * the main thread. The functions themselves are worker-agnostic on purpose.
 */

export interface DecodeRequest {
  type: 'DECODE';
  id: number;
  buffer: ArrayBuffer;
  /** Target sample rate for the analysis pass; null keeps the file's rate. */
  analysisSampleRate?: number;
  withSpectrum?: boolean;
}

export interface DecodeResponse {
  type: 'DECODE_RESULT';
  id: number;
  ok: true;
  pcm: Float32Array;
  interleaved: Float32Array;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  peaks: Awaited<ReturnType<typeof computePeaks>>;
  spectrum: SpectrumEnvelope | null;
}

export interface ErrorResponse {
  type: 'DECODE_RESULT';
  id: number;
  ok: false;
  errorCode: 'AUDIO_DECODE_FAILED' | 'AUDIO_EMPTY' | 'CANCELLED';
  message: string;
}

export interface ProgressMessage {
  type: 'PROGRESS';
  id: number;
  stage: 'decoding' | 'peaks' | 'spectrum';
  progress: number;
}

let cancelled = false;

async function decodeBuffer(buffer: ArrayBuffer, targetSampleRate?: number): Promise<AudioBuffer> {
  const OfflineCtor = (self as unknown as { OfflineAudioContext: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (!OfflineCtor) throw new Error('offline-audio-unavailable');
  // decodeAudioData is available on OfflineAudioContext inside a worker; the
  // two-argument form with a scratch context is the compatible path.
  const scratch = new OfflineCtor(1, 128, 44100);
  const decoded = await scratch.decodeAudioData(buffer.slice(0));
  if (!decoded || decoded.length === 0) throw new Error('empty');
  if (!targetSampleRate || decoded.sampleRate === targetSampleRate) return decoded;

  // Resample into a single-rate buffer so analysis and export agree.
  const ratio = targetSampleRate / decoded.sampleRate;
  const frames = Math.floor(decoded.length * ratio);
  const resampler = new OfflineCtor(decoded.numberOfChannels, Math.max(1, frames), targetSampleRate);
  for (let c = 0; c < decoded.numberOfChannels; c += 1) {
    const channel = resampler.createBufferSource();
    channel.buffer = decoded;
    channel.connect(resampler.destination);
    channel.start(0);
  }
  return resampler.startRendering();
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const request = event.data;
  if (request.type !== 'DECODE') return;
  cancelled = false;

  const post = (message: DecodeResponse | ErrorResponse | ProgressMessage) => {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage(message);
  };

  try {
    post({ type: 'PROGRESS', id: request.id, stage: 'decoding', progress: 0.1 });
    const audioBuffer = await decodeBuffer(request.buffer, request.analysisSampleRate);

    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const interleaved = new Float32Array(length * channels);
    const channelData: Float32Array[] = [];
    for (let c = 0; c < channels; c += 1) channelData.push(audioBuffer.getChannelData(c));
    for (let i = 0; i < length; i += 1) {
      for (let c = 0; c < channels; c += 1) interleaved[i * channels + c] = channelData[c]?.[i] ?? 0;
    }
    // Mono mixdown is what analysis runs on: cheaper and perceptually closer to
    // what the beat detector should hear than an interleaved stereo stream.
    const pcm = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels; c += 1) sum += channelData[c]?.[i] ?? 0;
      pcm[i] = sum / channels;
    }

    post({ type: 'PROGRESS', id: request.id, stage: 'peaks', progress: 0 });
    const peaks = await computePeaks(pcm, audioBuffer.sampleRate, 1, {
      onProgress: (p) => post({ type: 'PROGRESS', id: request.id, stage: 'peaks', progress: p }),
      shouldCancel: () => cancelled
    });

    let spectrum: SpectrumEnvelope | null = null;
    if (request.withSpectrum !== false) {
      post({ type: 'PROGRESS', id: request.id, stage: 'spectrum', progress: 0 });
      spectrum = await computeSpectrum(pcm, audioBuffer.sampleRate, {
        onProgress: (p) => post({ type: 'PROGRESS', id: request.id, stage: 'spectrum', progress: p }),
        shouldCancel: () => cancelled
      });
    }

    post({
      type: 'DECODE_RESULT',
      id: request.id,
      ok: true,
      pcm,
      interleaved,
      sampleRate: audioBuffer.sampleRate,
      channels,
      durationSeconds: audioBuffer.duration,
      peaks,
      spectrum
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode: ErrorResponse['errorCode'] = cancelled ? 'CANCELLED' : message === 'empty' ? 'AUDIO_EMPTY' : 'AUDIO_DECODE_FAILED';
    post({ type: 'DECODE_RESULT', id: request.id, ok: false, errorCode, message });
  }
};

self.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
  if (event.data?.type === 'CANCEL') cancelled = true;
});
