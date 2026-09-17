/**
 * Radix-2 in-place FFT.
 *
 * Hand-written rather than pulled from a dependency: it runs in a worker on a
 * plain Float32Array, allocates nothing per call, and has no Node APIs that
 * would break Cloudflare/worker compatibility.
 *
 * Input arrays are interleaved real/imaginary pairs of length 2 * size.
 */

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Bit-reversal permutation table, computed once per FFT size. */
function bitReverseTable(size: number): Uint32Array {
  const table = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let i = 0; i < size; i += 1) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b += 1) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    table[i] = r;
  }
  return table;
}

const tableCache = new Map<number, Uint32Array>();

function getTable(size: number): Uint32Array {
  let table = tableCache.get(size);
  if (!table) {
    table = bitReverseTable(size);
    tableCache.set(size, table);
  }
  return table;
}

/** In-place complex FFT. `data` length must be 2 * size. */
export function fft(data: Float32Array, size: number): void {
  const table = getTable(size);
  for (let i = 0; i < size; i += 1) {
    const j = table[i] ?? i;
    if (j > i) {
      const ri = data[2 * i] ?? 0;
      const ii = data[2 * i + 1] ?? 0;
      data[2 * i] = data[2 * j] ?? 0;
      data[2 * i + 1] = data[2 * j + 1] ?? 0;
      data[2 * j] = ri;
      data[2 * j + 1] = ii;
    }
  }

  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < size; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k += 1) {
        const aIdx = 2 * (i + k);
        const bIdx = 2 * (i + k + half);
        const aRe = data[aIdx] ?? 0;
        const aIm = data[aIdx + 1] ?? 0;
        const bRe = data[bIdx] ?? 0;
        const bIm = data[bIdx + 1] ?? 0;
        const tRe = bRe * curRe - bIm * curIm;
        const tIm = bRe * curIm + bIm * curRe;
        data[aIdx] = aRe + tRe;
        data[aIdx + 1] = aIm + tIm;
        data[bIdx] = aRe - tRe;
        data[bIdx + 1] = aIm - tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Magnitude spectrum of a real signal windowed with a Hann window. */
export function magnitudeSpectrum(
  samples: Float32Array,
  size: number,
  out: Float32Array,
  scratch: Float32Array
): Float32Array {
  scratch.fill(0);
  const half = size / 2;
  for (let i = 0; i < size; i += 1) {
    const s = samples[i] ?? 0;
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    scratch[2 * i] = s * window;
  }
  fft(scratch, size);
  for (let k = 0; k <= half; k += 1) {
    const re = scratch[2 * k] ?? 0;
    const im = scratch[2 * k + 1] ?? 0;
    out[k] = Math.sqrt(re * re + im * im) / size;
  }
  return out;
}
