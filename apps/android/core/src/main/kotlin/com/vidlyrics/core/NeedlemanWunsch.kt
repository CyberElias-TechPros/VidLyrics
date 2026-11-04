package com.vidlyrics.core

/**
 * Needleman–Wunsch global alignment.
 *
 * Reconciles a machine transcript against the user's true lyrics: the model
 * supplies timings, the user's text supplies words, and this decides which
 * timing belongs to which word (and which words have no evidence at all).
 * Matching is done on normalised strings so "don't" matches "dont" and
 * accented text matches plain text.
 */
data class AlignedPair<A, B>(val a: A?, val b: B?, val score: Double)

private fun similarity(a: String, b: String): Double {
    if (a == b) return 1.0
    if (a.isEmpty() || b.isEmpty()) return 0.0
    val maxLen = maxOf(a.length, b.length)
    if (maxLen > 24) return if (a.startsWith(b) || b.startsWith(a)) 0.6 else 0.0
    var prev = IntArray(b.length + 1) { it }
    var curr = IntArray(b.length + 1)
    for (i in 1..a.length) {
        curr[0] = i
        for (j in 1..b.length) {
            val cost = if (a[i - 1] == b[j - 1]) 0 else 1
            curr[j] = minOf(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        }
        val tmp = prev; prev = curr; curr = tmp
    }
    return maxOf(0.0, 1.0 - prev[b.length].toDouble() / maxLen)
}

fun <A, B> alignSequences(a: List<A>, b: List<B>, keyA: (A) -> String, keyB: (B) -> String,
                          matchReward: Double = 2.0, gapPenalty: Double = -1.0): List<AlignedPair<A, B>> {
    val n = a.size; val m = b.size
    if (n == 0 || m == 0) return a.map { AlignedPair<A, B>(it, null, 0.0) } + b.map { AlignedPair<A, B>(null, it, 0.0) }
    val ka = a.map(keyA); val kb = b.map(keyB)
    val f = DoubleArray((n + 1) * (m + 1))
    val idx = { i: Int, j: Int -> i * (m + 1) + j }
    for (i in 1..n) f[idx(i, 0)] = i * gapPenalty
    for (j in 1..m) f[idx(0, j)] = j * gapPenalty
    fun diagScore(i: Int, j: Int): Double {
        val sim = similarity(ka[i - 1], kb[j - 1])
        return f[idx(i - 1, j - 1)] + if (sim >= 0.5) sim * matchReward else sim * matchReward - (1 - sim) * matchReward
    }
    for (i in 1..n) for (j in 1..m) {
        f[idx(i, j)] = maxOf(diagScore(i, j), f[idx(i - 1, j)] + gapPenalty, f[idx(i, j - 1)] + gapPenalty)
    }
    val out = ArrayList<AlignedPair<A, B>>(n + m)
    var i = n; var j = m
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && kotlin.math.abs(f[idx(i, j)] - diagScore(i, j)) < 1e-9) {
            out += AlignedPair(a[i - 1], b[j - 1], similarity(ka[i - 1], kb[j - 1])); i--; j--; continue
        }
        if (i > 0 && kotlin.math.abs(f[idx(i, j)] - (f[idx(i - 1, j)] + gapPenalty)) < 1e-9) {
            out += AlignedPair<A, B>(a[i - 1], null, 0.0); i--; continue
        }
        if (j > 0) { out += AlignedPair<A, B>(null, b[j - 1], 0.0); j--; continue }
        break
    }
    return out.asReversed()
}

fun alignmentScore(pairs: List<AlignedPair<*, *>>): Double {
    if (pairs.isEmpty()) return 0.0
    val matched = pairs.filter { it.score > 0 }
    if (matched.isEmpty()) return 0.0
    return matched.sumOf { it.score } / pairs.size
}
