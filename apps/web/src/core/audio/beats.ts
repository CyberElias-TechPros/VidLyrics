import type { SpectrumEnvelope } from './spectrum';
import { BAND_COUNT } from './spectrum';
import type { Microseconds } from '../types';
import { usFromSeconds } from '../time';

/**
 * Beat detection.
 *
 * Pipeline: spectral flux (onset strength) -> autocorrelation for tempo ->
 * phase search for the downbeat -> a regular beat grid.
 *
 * This is a heuristic, not ground truth, and the product treats it that way:
 * beat snapping is OFF by default and always shown as a suggestion. Where a
 * produced track defeats it, the user snaps manually or turns it off, and
 * nothing else in the app depends on the result.
 */

export interface BeatGrid {
  bpm: number;
  /** Absolute timestamps of each beat. */
  beats: Microseconds[];
  /** Autocorrelation strength at the chosen tempo, 0..1. */
  confidence: number;
  intervalUs: Microseconds;
}

export interface BeatOptions {
  minBpm?: number;
  maxBpm?: number;
}

const DEFAULT_MIN_BPM = 60;
const DEFAULT_MAX_BPM = 190;

/** Positive spectral difference — the standard onset-strength signal. */
export function onsetEnvelope(env: SpectrumEnvelope): Float32Array {
  const out = new Float32Array(env.frameCount);
  if (env.frameCount < 2) return out;
  for (let f = 1; f < env.frameCount; f += 1) {
    let flux = 0;
    for (let b = 0; b < BAND_COUNT; b += 1) {
      const prev = env.bands[(f - 1) * BAND_COUNT + b] ?? 0;
      const cur = env.bands[f * BAND_COUNT + b] ?? 0;
      const delta = cur - prev;
      if (delta > 0) flux += delta;
    }
    out[f] = flux;
  }
  return out;
}

function normalise(values: Float32Array): Float32Array {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return values;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = (values[i] ?? 0) / max;
  return out;
}

/**
 * Adaptive-threshold normalisation plus smoothing.
 *
 * Two steps that autocorrelation of a raw flux envelope cannot do without:
 *
 *   1. Subtract a local moving average and half-wave rectify. A track with a loud
 *      sustained section otherwise has its quiet-but-regular beats drowned out by
 *      the overall energy contour.
 *   2. Smooth over a few frames. Onsets land on a ~23 ms analysis grid while a
 *      beat interval is rarely an exact multiple of it, so without tolerance the
 *      autocorrelation aligns only a fraction of the beats and picks a wrong lag.
 */
function prepareOnsetEnvelope(onset: Float32Array): Float32Array {
  const n = onset.length;
  if (n < 8) return onset;
  const window = 9;
  const half = Math.floor(window / 2);
  const residual = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j += 1) {
      sum += onset[j] ?? 0;
      count += 1;
    }
    const mean = count > 0 ? sum / count : 0;
    residual[i] = Math.max(0, (onset[i] ?? 0) - mean * 0.9);
  }

  // Non-maximum suppression. A transient spans 2-3 analysis frames, and those
  // duplicates are exactly what makes a half-tempo lag score HIGHER than the
  // true one: at the sub-harmonic lag both members of each pair line up, while
  // at the true lag only one does. Collapse each burst to its strongest frame.
  const peaks = new Float32Array(n);
  const nmsRadius = 2;
  for (let i = 0; i < n; i += 1) {
    const value = residual[i] ?? 0;
    if (value <= 0) continue;
    let isMax = true;
    for (let j = Math.max(0, i - nmsRadius); j <= Math.min(n - 1, i + nmsRadius); j += 1) {
      if (j !== i && (residual[j] ?? 0) > value) {
        isMax = false;
        break;
      }
    }
    if (isMax) peaks[i] = value;
  }

  const smoothed = new Float32Array(n);
  const sHalf = 2;
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - sHalf); j <= Math.min(n - 1, i + sHalf); j += 1) {
      sum += peaks[j] ?? 0;
      count += 1;
    }
    smoothed[i] = count > 0 ? sum / count : 0;
  }
  return normalise(smoothed);
}

/**
 * Perceptual tempo prior.
 *
 * Autocorrelation alone cannot distinguish 60 BPM from 120 BPM: every click
 * aligns at both lags, so the scores are nearly tied and a coin flip decides.
 * Weighting by a log-Gaussian centred on 120 BPM breaks the tie the way a
 * listener would, without overriding a genuinely strong slower signal (a true
 * 60 BPM track has no onsets between its beats, so its own lag wins anyway).
 */
function tempoPrior(bpm: number, centre = 120, sigmaOctaves = 0.9): number {
  const octaves = Math.log2(bpm / centre);
  return Math.exp(-0.5 * (octaves / sigmaOctaves) ** 2);
}

/** Autocorrelation of the onset envelope, restricted to a plausible tempo range. */
export function estimateTempo(env: SpectrumEnvelope, options: BeatOptions = {}): { bpm: number; confidence: number } {
  const onset = prepareOnsetEnvelope(onsetEnvelope(env));
  if (onset.length < 64) return { bpm: 0, confidence: 0 };

  // Silence has no onsets. Reporting a tempo for it would put a beat grid over
  // dead air and snap real lyrics onto invented beats.
  let peak = 0;
  for (const v of onset) if (v > peak) peak = v;
  if (peak <= 0) return { bpm: 0, confidence: 0 };

  const frameSeconds = env.frameUs / 1_000_000;
  if (frameSeconds <= 0) return { bpm: 0, confidence: 0 };

  const minBpm = options.minBpm ?? DEFAULT_MIN_BPM;
  const maxBpm = options.maxBpm ?? DEFAULT_MAX_BPM;
  const minLag = Math.max(2, Math.floor(60 / maxBpm / frameSeconds));
  const maxLag = Math.min(onset.length - 1, Math.ceil(60 / minBpm / frameSeconds));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < onset.length; i += 1) {
      sum += (onset[i] ?? 0) * (onset[i + lag] ?? 0);
      count += 1;
    }
    const raw = count > 0 ? sum / count : 0;
    const bpm = 60 / (lag * frameSeconds);
    const score = raw * tempoPrior(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const bpm = 60 / (bestLag * frameSeconds);
  // Confidence is reported honestly: a produced track with smeared onsets scores
  // far lower than a click track, and the UI uses that to warn the user.
  const confidence = Math.min(1, Math.max(0, bestScore * 4));
  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

/** Find the phase offset that puts beats on the strongest onsets. */
function findPhase(onset: Float32Array, lagFrames: number): number {
  const limit = Math.min(lagFrames, onset.length);
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < limit; phase += 1) {
    let score = 0;
    for (let i = phase; i < onset.length; i += lagFrames) score += onset[i] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

export function detectBeatGrid(env: SpectrumEnvelope, options: BeatOptions = {}): BeatGrid | null {
  const { bpm, confidence } = estimateTempo(env, options);
  if (bpm <= 0 || env.frameUs <= 0) return null;

  const frameSeconds = env.frameUs / 1_000_000;
  const lagFrames = Math.max(1, Math.round(60 / bpm / frameSeconds));
  const intervalUs = Math.round(lagFrames * env.frameUs);
  if (intervalUs <= 0) return null;

  const onset = normalise(onsetEnvelope(env));
  const phase = findPhase(onset, lagFrames);
  const startUs = Math.round(phase * env.frameUs);

  const totalUs = env.frameCount * env.frameUs;
  const beats: Microseconds[] = [];
  for (let t = startUs; t < totalUs; t += intervalUs) beats.push(Math.round(t));

  return {
    bpm,
    beats,
    confidence,
    intervalUs: usFromSeconds(lagFrames * frameSeconds)
  };
}

/** Nearest beat to a timestamp, or null when nothing is within tolerance. */
export function nearestBeat(grid: BeatGrid, timeUs: Microseconds, toleranceUs: Microseconds): Microseconds | null {
  if (grid.beats.length === 0 || grid.intervalUs <= 0) return null;
  const approxIndex = Math.round((timeUs - (grid.beats[0] ?? 0)) / grid.intervalUs);
  for (const offset of [0, -1, 1]) {
    const beat = grid.beats[approxIndex + offset];
    if (beat !== undefined && Math.abs(beat - timeUs) <= toleranceUs) return beat;
  }
  return null;
}

/**
 * Is this beat a "strong" beat (bar line)? Used for beat-aware emphasis so the
 * effect lands on musical accents rather than on every subdivision.
 */
export function beatStrength(grid: BeatGrid, timeUs: Microseconds, toleranceUs: Microseconds): number {
  if (grid.intervalUs <= 0) return 0;
  const beat = nearestBeat(grid, timeUs, toleranceUs);
  if (beat === null) return 0;
  const index = Math.round((beat - (grid.beats[0] ?? 0)) / grid.intervalUs);
  if (index % 4 === 0) return 1;
  if (index % 2 === 0) return 0.6;
  return 0.35;
}
