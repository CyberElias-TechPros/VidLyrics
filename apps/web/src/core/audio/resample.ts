/**
 * Small, allocation-explicit PCM resamplers for browser-side analysis.
 *
 * Whisper expects mono 16 kHz input. The downsampler below integrates each
 * source interval (a box low-pass) before reducing the rate, which is much less
 * prone to aliasing than simply dropping samples and is fast enough to run in a
 * dedicated worker. Upsampling uses linear interpolation.
 */

export function resampleMono(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new RangeError('Source sample rate must be positive.');
  if (!Number.isFinite(targetRate) || targetRate <= 0) throw new RangeError('Target sample rate must be positive.');
  if (input.length === 0) return new Float32Array(0);
  if (sourceRate === targetRate) return input.slice();

  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const sourcePerOutput = sourceRate / targetRate;

  if (sourcePerOutput > 1) {
    // Integrate the source samples covered by each output sample. Fractional
    // edge weights preserve the mean for non-integer ratios such as 44.1 kHz
    // to 16 kHz.
    for (let outIndex = 0; outIndex < outputLength; outIndex += 1) {
      const start = outIndex * sourcePerOutput;
      const end = Math.min(input.length, (outIndex + 1) * sourcePerOutput);
      const first = Math.floor(start);
      const last = Math.min(input.length - 1, Math.ceil(end) - 1);
      let weighted = 0;
      let weight = 0;
      for (let sourceIndex = first; sourceIndex <= last; sourceIndex += 1) {
        const overlap = Math.max(0, Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex));
        weighted += (input[sourceIndex] ?? 0) * overlap;
        weight += overlap;
      }
      output[outIndex] = weight > 0 ? weighted / weight : 0;
    }
    return output;
  }

  for (let outIndex = 0; outIndex < outputLength; outIndex += 1) {
    const sourcePosition = outIndex * sourcePerOutput;
    const index = Math.min(input.length - 1, Math.floor(sourcePosition));
    const next = Math.min(input.length - 1, index + 1);
    const fraction = sourcePosition - index;
    output[outIndex] = (input[index] ?? 0) * (1 - fraction) + (input[next] ?? 0) * fraction;
  }
  return output;
}

/**
 * @fugood/node-whisper-wasm 1.2.0-rc.1 exposes segment t0/t1 in milliseconds:
 * its binding multiplies whisper.cpp's 10 ms ticks by ten before returning them.
 */
export function whisperMillisecondsToUs(milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) return 0;
  return Math.round(milliseconds * 1_000);
}
