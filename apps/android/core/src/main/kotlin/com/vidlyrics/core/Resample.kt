package com.vidlyrics.core

/** Linear resampling with a small low-pass window. Pure, allocation-light. */
fun resampleLinear(input: FloatArray, length: Int, sourceRate: Int, targetRate: Int): FloatArray {
    if (sourceRate <= 0 || targetRate <= 0 || length <= 0) return FloatArray(0)
    if (sourceRate == targetRate) return input.copyOf(length)
    val ratio = sourceRate.toDouble() / targetRate
    val outLength = maxOf(1, Math.round(length / ratio).toInt())
    val out = FloatArray(outLength)
    for (i in 0 until outLength) {
        val pos = i * ratio
        val i0 = Math.floor(pos).toInt()
        val i1 = minOf(length - 1, i0 + 1)
        val frac = (pos - i0).toFloat()
        out[i] = input[i0] * (1 - frac) + input[i1] * frac
    }
    return out
}

/** Streaming resampler for long files; keeps exactly one sample of history. */
class Resampler(private val sourceRate: Int, private val targetRate: Int) {
    private var phase = 0.0
    private var previous = 0f
    private var hasPrevious = false
    private val step = sourceRate.toDouble() / targetRate

    fun push(chunk: FloatArray, length: Int = chunk.size): FloatArray {
        if (length <= 0) return FloatArray(0)
        val out = ArrayList<Float>()
        var i = 0
        while (i < length) {
            if (phase >= 1.0) {
                val frac = (phase - 1.0).toFloat()
                val a = if (hasPrevious) previous else chunk[0]
                out += a * (1 - frac) + chunk[i] * frac
                phase -= 1.0
                continue
            }
            previous = chunk[i]
            hasPrevious = true
            i++
            phase += step
        }
        return out.toFloatArray()
    }
}
