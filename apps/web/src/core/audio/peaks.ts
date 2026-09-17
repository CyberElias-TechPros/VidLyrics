import type { Microseconds } from '../types';
import { usFromSeconds } from '../time';

/**
 * Waveform peak extraction.
 *
 * The waveform is drawn from min/max/RMS peaks per bucket, not from raw samples
 * — a 3-minute stereo track is ~31 million samples and redrawing that on every
 * zoom change is what makes naive timeline editors stutter.
 *
 * Peaks are stored at a FIXED high resolution (default 1 px per 10 ms, so a
 * 3-minute song is ~18 000 buckets) and then decimated at draw time. That is
 * what lets zooming stay instant instead of triggering a recomputation.
 */

export interface PeakData {
  /** Interleaved [min, max, rms] triples. */
  data: Float32Array;
  buckets: number;
  microsecondsPerBucket: Microseconds;
  durationUs: Microseconds;
  sampleRate: number;
  channels: number;
  /** Peak absolute amplitude, for normalisation. */
  peakAmplitude: number;
}

export interface PeakOptions {
  /** Target microseconds per bucket. */
  bucketUs?: Microseconds;
  onProgress?: (progress: number) => void;
  shouldCancel?: () => boolean;
}

export class PeakCancelledError extends Error {
  constructor() {
    super('Waveform extraction was cancelled.');
    this.name = 'PeakCancelledError';
  }
}

const DEFAULT_BUCKET_US = usFromSeconds(0.01);

export async function computePeaks(
  pcm: Float32Array,
  sampleRate: number,
  channels: number,
  options: PeakOptions = {}
): Promise<PeakData> {
  const bucketUs = options.bucketUs ?? DEFAULT_BUCKET_US;
  const samplesPerBucket = Math.max(1, Math.round((bucketUs / 1_000_000) * sampleRate));
  const frames = Math.floor(pcm.length / Math.max(1, channels));
  const buckets = Math.max(1, Math.ceil(frames / samplesPerBucket));
  const data = new Float32Array(buckets * 3);

  let peakAmplitude = 0;
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let lastYield = start;

  for (let b = 0; b < buckets; b += 1) {
    if (options.shouldCancel?.()) throw new PeakCancelledError();
    const startFrame = b * samplesPerBucket;
    const endFrame = Math.min(frames, startFrame + samplesPerBucket);
    let min = 1;
    let max = -1;
    let sumSquares = 0;
    let count = 0;

    for (let f = startFrame; f < endFrame; f += 1) {
      let sample = 0;
      for (let c = 0; c < channels; c += 1) sample += pcm[f * channels + c] ?? 0;
      sample /= Math.max(1, channels);
      if (sample < min) min = sample;
      if (sample > max) max = sample;
      sumSquares += sample * sample;
      count += 1;
      const abs = Math.abs(sample);
      if (abs > peakAmplitude) peakAmplitude = abs;
    }

    if (count === 0) {
      min = 0;
      max = 0;
    }
    data[b * 3] = min;
    data[b * 3 + 1] = max;
    data[b * 3 + 2] = count > 0 ? Math.sqrt(sumSquares / count) : 0;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastYield > 200) {
      options.onProgress?.(b / buckets);
      lastYield = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  options.onProgress?.(1);
  return {
    data,
    buckets,
    microsecondsPerBucket: bucketUs,
    durationUs: usFromSeconds(frames / Math.max(1, sampleRate)),
    sampleRate,
    channels,
    peakAmplitude
  };
}

export interface PeakSample {
  min: number;
  max: number;
  rms: number;
}

/** Peak values covering a time range, aggregated across the buckets it spans. */
export function peaksInRange(peaks: PeakData, startUs: Microseconds, endUs: Microseconds): PeakSample {
  if (peaks.buckets === 0) return { min: 0, max: 0, rms: 0 };
  const first = Math.max(0, Math.floor(startUs / peaks.microsecondsPerBucket));
  const last = Math.min(peaks.buckets - 1, Math.ceil(endUs / peaks.microsecondsPerBucket));
  let min = 1;
  let max = -1;
  let rmsSum = 0;
  let count = 0;
  for (let i = first; i <= last; i += 1) {
    const vMin = peaks.data[i * 3] ?? 0;
    const vMax = peaks.data[i * 3 + 1] ?? 0;
    if (vMin < min) min = vMin;
    if (vMax > max) max = vMax;
    rmsSum += peaks.data[i * 3 + 2] ?? 0;
    count += 1;
  }
  if (count === 0) return { min: 0, max: 0, rms: 0 };
  return { min, max, rms: rmsSum / count };
}

/** Serialise peaks for IndexedDB / .json export. */
export function serialisePeaks(peaks: PeakData): { buckets: number; bucketUs: number; durationUs: number; sampleRate: number; channels: number; peak: number; data: number[] } {
  return {
    buckets: peaks.buckets,
    bucketUs: peaks.microsecondsPerBucket,
    durationUs: peaks.durationUs,
    sampleRate: peaks.sampleRate,
    channels: peaks.channels,
    peak: peaks.peakAmplitude,
    data: Array.from(peaks.data)
  };
}

export function deserialisePeaks(payload: { buckets: number; bucketUs: number; durationUs: number; sampleRate: number; channels: number; peak: number; data: number[] }): PeakData {
  return {
    buckets: payload.buckets,
    microsecondsPerBucket: payload.bucketUs,
    durationUs: payload.durationUs,
    sampleRate: payload.sampleRate,
    channels: payload.channels,
    peakAmplitude: payload.peak,
    data: Float32Array.from(payload.data)
  };
}

/** Downsample to one entry per output pixel — the draw loop needs no more. */
export function decimate(peaks: PeakData, startUs: Microseconds, endUs: Microseconds, pixels: number): { min: number; max: number; rms: number }[] {
  const out: { min: number; max: number; rms: number }[] = [];
  if (pixels <= 0 || endUs <= startUs) return out;
  const stepUs = (endUs - startUs) / pixels;
  for (let p = 0; p < pixels; p += 1) {
    const sample = peaksInRange(peaks, startUs + p * stepUs, startUs + (p + 1) * stepUs);
    out.push(sample);
  }
  return out;
}
