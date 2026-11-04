package com.vidlyrics.core

/**
 * CTC decoding for the optional on-device speech alignment pack.
 *
 * A wav2vec2-class ONNX model emits a [frames × vocab] logit matrix. Greedy
 * decoding with blank collapse yields characters with frame timestamps; those
 * become words, which reconcileTranscript() aligns against the user's lyrics.
 * Keeping this in pure Kotlin means the ONNX glue on Android is just tensor I/O
 * and the decoding logic is unit-tested on a JVM.
 */
data class CtcToken(val char: String, val frame: Int, val score: Float)

fun ctcGreedyDecode(logits: FloatArray, frames: Int, vocabSize: Int, blankId: Int,
                    vocab: List<String>): List<CtcToken> {
    if (frames <= 0 || vocabSize <= 0) return emptyList()
    val out = ArrayList<CtcToken>()
    var previous = blankId
    for (f in 0 until frames) {
        var best = blankId
        var bestScore = Float.NEGATIVE_INFINITY
        val base = f * vocabSize
        for (v in 0 until vocabSize) {
            val score = logits.getOrElse(base + v) { Float.NEGATIVE_INFINITY }
            if (score > bestScore) { bestScore = score; best = v }
        }
        if (best != blankId && best != previous) {
            out += CtcToken(vocab.getOrElse(best) { "" }, f, bestScore)
        }
        previous = best
    }
    return out
}

/** Group decoded characters into words using spaces (or | as word delimiter). */
fun transcriptWords(tokens: List<CtcToken>, frameUs: Microseconds,
                    confidence: Double = 0.65): List<TranscriptWord> {
    if (tokens.isEmpty()) return emptyList()
    val out = ArrayList<TranscriptWord>()
    val sb = StringBuilder()
    var startFrame = tokens[0].frame
    var lastFrame = tokens[0].frame
    fun flush() {
        val text = sb.toString().trim()
        if (text.isNotEmpty()) out += TranscriptWord(text, startFrame * frameUs,
            maxOf(startFrame * frameUs, (lastFrame + 1) * frameUs), confidence)
        sb.setLength(0)
    }
    for (token in tokens) {
        when (token.char) {
            " ", "|" -> { flush(); startFrame = token.frame }
            "" -> Unit
            else -> sb.append(token.char)
        }
        lastFrame = token.frame
    }
    flush()
    return out
}
