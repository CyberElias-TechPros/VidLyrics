import { describe, it, expect } from 'vitest';
import { fft, magnitudeSpectrum, nextPowerOfTwo } from '../src/core/audio/fft';
import { computePeaks, peaksInRange, decimate, serialisePeaks, deserialisePeaks } from '../src/core/audio/peaks';
import { computeSpectrum, melBandEdges, bandsAt, energyAt } from '../src/core/audio/spectrum';
import { detectBeatGrid, onsetEnvelope, nearestBeat, beatStrength } from '../src/core/audio/beats';
import { usFromSeconds } from '../src/core/time';

function sine(seconds: number, sampleRate: number, frequency: number, amplitude = 0.5): Float32Array {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

/** A click track at an exact tempo — the only honest way to test beat detection. */
/**
 * The click track must be generated at the SAME sample rate it is analysed at.
 * Generating at 44100 and analysing as 22050 halves the perceived tempo, which
 * makes a correct detector look broken.
 */
function clickTrack(bpm: number, seconds: number, sampleRate = 22050): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  const interval = 60 / bpm;
  for (let t = 0; t < seconds; t += interval) {
    const start = Math.floor(t * sampleRate);
    for (let i = 0; i < 400; i += 1) {
      out[start + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * Math.exp(-i / 60);
    }
  }
  return out;
}

describe('fft', () => {
  it('computes power-of-two sizes', () => {
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
  });

  it('places a pure tone in the correct bin', () => {
    const size = 1024;
    const sampleRate = 44100;
    const frequency = 4410; // bin 102.4
    const signal = sine(size / sampleRate, sampleRate, frequency);
    const mag = new Float32Array(size / 2 + 1);
    magnitudeSpectrum(signal, size, mag, new Float32Array(size * 2));
    let peak = 0;
    for (let i = 1; i < mag.length; i += 1) if ((mag[i] ?? 0) > (mag[peak] ?? 0)) peak = i;
    expect(peak).toBe(102);
  });

  it('returns to the original signal after a round trip through the transform', () => {
    const size = 16;
    const data = new Float32Array(size * 2);
    for (let i = 0; i < size; i += 1) data[2 * i] = Math.sin(i);
    const copy = Float32Array.from(data);
    fft(data, size);
    // Inverse by conjugating, transforming and conjugating again.
    for (let i = 0; i < size; i += 1) data[2 * i + 1] = -(data[2 * i + 1] ?? 0);
    fft(data, size);
    for (let i = 0; i < size; i += 1) {
      const re = (data[2 * i] ?? 0) / size;
      // Float32 accumulation over 16 points; 1e-9 is below its precision.
      expect(Math.abs(re - (copy[2 * i] ?? 0))).toBeLessThan(1e-5);
    }
  });
});

describe('waveform peaks', () => {
  it('captures min, max and rms correctly', async () => {
    const sampleRate = 8000;
    const pcm = sine(1, sampleRate, 100, 0.5);
    const peaks = await computePeaks(pcm, sampleRate, 1, { bucketUs: usFromSeconds(0.05) });
    expect(peaks.buckets).toBe(20);
    const sample = peaksInRange(peaks, 0, usFromSeconds(1));
    expect(sample.max).toBeGreaterThan(0.45);
    expect(sample.min).toBeLessThan(-0.45);
    expect(sample.rms).toBeGreaterThan(0.2);
    expect(sample.rms).toBeLessThan(0.5);
  });

  it('handles silence and out-of-range queries', async () => {
    const peaks = await computePeaks(new Float32Array(8000), 8000, 1, { bucketUs: usFromSeconds(0.05) });
    expect(peaksInRange(peaks, 0, usFromSeconds(1)).max).toBe(0);
    expect(peaksInRange(peaks, usFromSeconds(99), usFromSeconds(100)).rms).toBe(0);
  });

  it('decimates to exactly one entry per pixel', async () => {
    const peaks = await computePeaks(sine(2, 8000, 100), 8000, 1, { bucketUs: usFromSeconds(0.01) });
    expect(decimate(peaks, 0, usFromSeconds(2), 100)).toHaveLength(100);
    expect(decimate(peaks, 0, usFromSeconds(2), 0)).toHaveLength(0);
  });

  it('survives an IndexedDB round trip', async () => {
    const peaks = await computePeaks(sine(0.5, 8000, 100), 8000, 1, { bucketUs: usFromSeconds(0.05) });
    const restored = deserialisePeaks(serialisePeaks(peaks));
    expect(restored.buckets).toBe(peaks.buckets);
    expect(Array.from(restored.data)).toEqual(Array.from(peaks.data));
  });
});

describe('spectral envelope', () => {
  it('produces mel-spaced band edges in ascending order', () => {
    const edges = melBandEdges(44100, 1024, 32);
    expect(edges).toHaveLength(33);
    for (let i = 1; i < edges.length; i += 1) expect(edges[i]!).toBeGreaterThanOrEqual(edges[i - 1]!);
  });

  it('concentrates a bass tone in low bands and a treble tone in high bands', async () => {
    const sampleRate = 22050;
    const low = await computeSpectrum(sine(0.5, sampleRate, 120), sampleRate);
    const high = await computeSpectrum(sine(0.5, sampleRate, 6000), sampleRate);
    const mid = Math.floor(low.frameCount / 2) * low.frameUs;
    const argmax = (bands: Uint8Array) => {
      let best = 0;
      for (let i = 1; i < bands.length; i += 1) if ((bands[i] ?? 0) > (bands[best] ?? 0)) best = i;
      return best;
    };
    const lowBand = argmax(bandsAt(low, mid));
    const highBand = argmax(bandsAt(high, mid));
    expect(lowBand).toBeLessThan(8);
    expect(highBand).toBeGreaterThan(16);
    expect(energyAt(low, mid, 0)).toBeGreaterThan(energyAt(high, mid, 0));
  });

  it('returns silence outside the analysed range', async () => {
    const env = await computeSpectrum(sine(0.2, 22050, 440), 22050);
    expect(bandsAt(env, -1).every((v) => v === 0)).toBe(true);
    expect(bandsAt(env, usFromSeconds(9999)).every((v) => v === 0)).toBe(true);
  });
});

describe('beat detection', () => {
  it('recovers the tempo of a 120 BPM click track', async () => {
    const env = await computeSpectrum(clickTrack(120, 8), 22050);
    const grid = detectBeatGrid(env);
    expect(grid).not.toBeNull();
    // Autocorrelation on a clean click track should be close to exact.
    expect(Math.abs((grid?.bpm ?? 0) - 120)).toBeLessThan(4);
    expect(grid!.beats.length).toBeGreaterThan(8);
  });

  it('recovers 90 BPM as well, ruling out a hardcoded tempo', async () => {
    const env = await computeSpectrum(clickTrack(90, 10), 22050);
    const grid = detectBeatGrid(env);
    expect(Math.abs((grid?.bpm ?? 0) - 90)).toBeLessThan(4);
  });

  it('produces a non-empty onset envelope with real onsets', async () => {
    const env = await computeSpectrum(clickTrack(120, 4), 22050);
    const onset = onsetEnvelope(env);
    expect(onset.length).toBe(env.frameCount);
    expect(Math.max(...Array.from(onset))).toBeGreaterThan(0);
  });

  it('finds the nearest beat only within tolerance', async () => {
    const env = await computeSpectrum(clickTrack(120, 6), 22050);
    const grid = detectBeatGrid(env)!;
    const beat = grid.beats[10]!;
    expect(nearestBeat(grid, beat + 20_000, 50_000)).toBe(beat);
    expect(nearestBeat(grid, beat + 240_000, 50_000)).toBeNull();
    expect(beatStrength(grid, beat, 50_000)).toBeGreaterThan(0);
    expect(beatStrength(grid, beat + 240_000, 50_000)).toBe(0);
  });

  it('does not invent a tempo from silence', async () => {
    const env = await computeSpectrum(new Float32Array(22050 * 4), 22050);
    expect(detectBeatGrid(env)).toBeNull();
  });
});
