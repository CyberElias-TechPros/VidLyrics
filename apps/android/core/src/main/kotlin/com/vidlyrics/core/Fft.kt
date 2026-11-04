package com.vidlyrics.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Radix-2 in-place FFT. `data` is interleaved real/imag, length 2*size. */
fun nextPowerOfTwo(n: Int): Int {
    var p = 1
    while (p < n) p = p shl 1
    return p
}

private val reverseCache = HashMap<Int, IntArray>()

private fun bitReverseTable(size: Int): IntArray = reverseCache.getOrPut(size) {
    val table = IntArray(size)
    val bits = 32 - Integer.numberOfLeadingZeros(size - 1)
    for (i in 0 until size) {
        var x = i; var r = 0
        repeat(bits) { r = (r shl 1) or (x and 1); x = x shr 1 }
        table[i] = r
    }
    table
}

fun fft(data: FloatArray, size: Int) {
    require(size > 0 && size and (size - 1) == 0) { "FFT size must be a power of two" }
    val table = bitReverseTable(size)
    for (i in 0 until size) {
        val j = table[i]
        if (j > i) {
            val ri = data[2 * i]; val ii = data[2 * i + 1]
            data[2 * i] = data[2 * j]; data[2 * i + 1] = data[2 * j + 1]
            data[2 * j] = ri; data[2 * j + 1] = ii
        }
    }
    var len = 2
    while (len <= size) {
        val half = len shr 1
        val angle = -2.0 * PI / len
        val wRe = cos(angle); val wIm = sin(angle)
        var i = 0
        while (i < size) {
            var curRe = 1.0; var curIm = 0.0
            for (k in 0 until half) {
                val a = 2 * (i + k); val b = 2 * (i + k + half)
                val aRe = data[a]; val aIm = data[a + 1]
                val bRe = data[b]; val bIm = data[b + 1]
                val tRe = bRe * curRe - bIm * curIm
                val tIm = bRe * curIm + bIm * curRe
                data[a] = (aRe + tRe).toFloat(); data[a + 1] = (aIm + tIm).toFloat()
                data[b] = (aRe - tRe).toFloat(); data[b + 1] = (aIm - tIm).toFloat()
                val nextRe = curRe * wRe - curIm * wIm
                curIm = curRe * wIm + curIm * wRe
                curRe = nextRe
            }
            i += len
        }
        len = len shl 1
    }
}

/** Magnitude spectrum of a Hann-windowed real signal. */
fun magnitudeSpectrum(samples: FloatArray, size: Int, out: FloatArray, scratch: FloatArray): FloatArray {
    scratch.fill(0f)
    val half = size / 2
    for (i in 0 until size) {
        val window = 0.5 * (1 - cos((2 * PI * i) / (size - 1)))
        scratch[2 * i] = (samples[i] * window).toFloat()
    }
    fft(scratch, size)
    for (k in 0..half) {
        val re = scratch[2 * k]; val im = scratch[2 * k + 1]
        out[k] = sqrt(re * re + im * im) / size
    }
    return out
}
