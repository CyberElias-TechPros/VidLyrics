package com.vidlyrics.core

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sin

fun clamp01(v: Double): Double = when { v < 0.0 -> 0.0; v > 1.0 -> 1.0; v.isNaN() -> 0.0; else -> v }
fun clamp01(v: Float): Float = when { v < 0f -> 0f; v > 1f -> 1f; v.isNaN() -> 0f; else -> v }
fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t
fun easeOutCubic(t: Double): Double = 1.0 - (1.0 - clamp01(t)).pow(3.0)
fun easeInCubic(t: Double): Double = clamp01(t).pow(3.0)
fun easeInOutCubic(t: Double): Double {
    val x = clamp01(t)
    return if (x < 0.5) 4 * x * x * x else 1 - (-2 * x + 2).pow(3.0) / 2
}
fun easeOutBack(t: Double): Double {
    val x = clamp01(t)
    val c1 = 1.70158; val c3 = c1 + 1
    return 1 + c3 * (x - 1).pow(3.0) + c1 * (x - 1).pow(2.0)
}

/**
 * Deterministic smooth noise. Uses no Math.random(), no Date.now() and no
 * mutable state, so the same (time, seed) always yields the same background
 * drift in the live preview and in the encoded MP4.
 */
fun smoothNoise(x: Double, seed: Int): Double {
    val i = kotlin.math.floor(x).toInt()
    val f = x - i
    val u = f * f * (3 - 2 * f)
    return lerp(hash01(i, seed), hash01(i + 1, seed), u.toFloat()).toDouble() * 2 - 1
}

private fun hash01(n: Int, seed: Int): Float {
    var h = n * 374761393 + seed * 668265263
    h = (h xor (h shr 13)) * 1274126177
    h = h xor (h shr 16)
    return (h.toUInt().toFloat() / UInt.MAX_VALUE.toFloat())
}
