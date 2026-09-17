import { fft, magnitudeSpectrum, nextPowerOfTwo } from './fft';
import type { Microseconds } from '../types';
import { usFromSeconds } from '../time';

/**
 * Spectral envelope.
 *
 * The visualizer, beat detection and instrumental-region detection all need the
 * same thing: "how much energy is in each frequency band at time T". Computing
 * that from the decoded PCM ONCE, at scene-build time, is what makes the export
 * deterministic — a realtime AnalyserNode would give the visualizer different
 * values in preview and in the rendered file.
 *
 * Storage: bands are log-scaled into a Uint8 per frame. For a 3-minute song
 * that is roughly 250 KB, which is the difference between "fine" and "the tab
 * ran out of memory".
 */

export const BAND_COUNT = 32;

export interface SpectrumEnvelope {
  /** Analysis frames, each BAND_COUNT log-scaled 0..255 values. */
  bands: Uint8Array;
  frameCount: number;
  /** Microseconds per analysis frame. */
  frameUs: Microseconds;
  sampleRate: number;
  fftSize: number;
  /** Mean energy per band across the whole track, for normalising bar heights. */
  bandMeans: Float32Array;
}

/** Perceptual (mel-ish) band edges, logarithmically spaced up to Nyquist. */
export function melBandEdges(sampleRate: number, fftSize: number, bandCount: number): number[] {
  const nyquist = sampleRate / 2;
  const melLow = 0;
  const melHigh = 2595 * Math.log10(1 + nyquist / 700);
  const edges: number[] = [];
  const binHz = sampleRate / fftSize;
  for (let i = 0; i <= bandCount; i += 1) {
    const mel = melLow + ((melHigh - melLow) * i) / bandCount;
    const hz = 700 * (Math.pow(10, mel / 2595) - 1);
    edges.push(Math.min(fftSize / 2, Math.max(1, Math.round(hz / binHz))));
  }
  return edges;
}

export interface SpectrumOptions {
  fftSize?: number;
  hopSize?: number;
  bandCount?: number;
  /** Called with 0..1 progress so the UI can show a real progress bar. */
  onProgress?: (progress: number) => void;
  shouldCancel?: () => boolean;
}

export class AnalysisCancelledError extends Error {
  constructor() {
    super('Audio analysis was cancelled.');
    this.name = 'AnalysisCancelledError';
  }
}

/**
 * Compute a band-energy envelope over the whole track.
 * Yields to the event loop every ~200 ms so the progress bar can actually paint.
 */
export async function computeSpectrum(
  pcm: Float32Array,
  sampleRate: number,
  options: SpectrumOptions = {}
): Promise<SpectrumEnvelope> {
  const fftSize = nextPowerOfTwo(options.fftSize ?? 1024);
  const hopSize = Math.max(1, options.hopSize ?? fftSize / 2);
  const bandCount = options.bandCount ?? BAND_COUNT;

  const frameCount = Math.max(1, Math.floor((pcm.length - fftSize) / hopSize) + 1);
  const edges = melBandEdges(sampleRate, fftSize, bandCount);
  const bands = new Uint8Array(frameCount * bandCount);
  const means = new Float64Array(bandCount);

  const scratch = new Float32Array(fftSize * 2);
  const mag = new Float32Array(fftSize / 2 + 1);
  const windowed = new Float32Array(fftSize);

  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let lastYield = start;

  for (let f = 0; f < frameCount; f += 1) {
    if (options.shouldCancel?.()) throw new AnalysisCancelledError();

    const offset = f * hopSize;
    for (let i = 0; i < fftSize; i += 1) windowed[i] = pcm[offset + i] ?? 0;
    magnitudeSpectrum(windowed, fftSize, mag, scratch);

    for (let b = 0; b < bandCount; b += 1) {
      const lo = edges[b] ?? 0;
      const hi = Math.max(lo + 1, edges[b + 1] ?? mag.length - 1);
      let sum = 0;
      for (let k = lo; k < hi && k < mag.length; k += 1) sum += mag[k] ?? 0;
      const energy = sum / Math.max(1, hi - lo);
      // Perceptual log scale into 0..255.
      const scaled = Math.round(Math.min(255, Math.max(0, 255 * (Math.log10(1 + energy * 400) / 3))));
      bands[f * bandCount + b] = scaled;
      means[b] = (means[b] ?? 0) + scaled;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastYield > 200) {
      options.onProgress?.(f / frameCount);
      lastYield = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  options.onProgress?.(1);
  const bandMeans = new Float32Array(bandCount);
  for (let b = 0; b < bandCount; b += 1) {
    const total = means[b] ?? 0;
    bandMeans[b] = total > 0 ? total / frameCount : 0;
  }

  return {
    bands,
    frameCount,
    frameUs: usFromSeconds(hopSize / sampleRate),
    sampleRate,
    fftSize,
    bandMeans
  };
}

/** Bands at a given timestamp. Returns a zeroed array before/after the track. */
export function bandsAt(env: SpectrumEnvelope, timeUs: Microseconds): Uint8Array {
  const out = new Uint8Array(BAND_COUNT);
  if (!env || env.frameCount === 0 || timeUs < 0) return out;
  const frameIndex = Math.floor(timeUs / Math.max(1, env.frameUs));
  // Beyond the analysed range there is no audio, so report silence rather than
  // clamping to the last frame and freezing the visualizer at full height.
  if (frameIndex >= env.frameCount) return out;
  const frame = frameIndex;
  for (let b = 0; b < BAND_COUNT; b += 1) out[b] = env.bands[frame * BAND_COUNT + b] ?? 0;
  return out;
}

/** Scalar "how loud is it right now", normalised against the track mean. */
export function energyAt(env: SpectrumEnvelope, timeUs: Microseconds, bandIndex: number): number {
  const bands = bandsAt(env, timeUs);
  const idx = Math.min(BAND_COUNT - 1, Math.max(0, Math.round(bandIndex * (BAND_COUNT - 1))));
  const value = bands[idx] ?? 0;
  const mean = env.bandMeans[idx] ?? 1;
  return Math.min(1.6, value / Math.max(8, mean));
}
