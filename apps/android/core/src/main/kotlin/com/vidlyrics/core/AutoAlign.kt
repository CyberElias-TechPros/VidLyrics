package com.vidlyrics.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Automatic lyric ↔ audio alignment using on-device signal processing.
 *
 * What it really does: computes an adaptive-whitened spectral-flux onset
 * envelope, weights each onset by the vocal-band energy ratio, then uses a
 * dynamic program to choose one onset per lyric line while penalising gaps that
 * disagree with how long the line should take to sing. It is a heuristic and
 * the UI says so: every produced timestamp carries a confidence below 1 and is
 * painted as heat. Manual tap-sync remains the always-available ground truth.
 *
 * If a device-specific CTC/Whisper pack is installed, its word timings are
 * reconciled with the true lyric text by reconcileTranscript() instead.
 */
data class TranscriptWord(val text: String, val start: Microseconds, val end: Microseconds,
                          val confidence: Double = 0.7)

data class AlignResult(
    val lines: List<Line>, val method: String, val confidence: Double,
    val message: String, val anchors: List<Microseconds> = emptyList()
)

private data class Anchor(val timeUs: Microseconds, val strength: Double)

private fun detectAnchors(analysis: AudioAnalysis): List<Anchor> {
    val env = analysis.spectrum
    val onset = prepareOnsetEnvelope(onsetEnvelope(env))
    if (onset.isEmpty()) return emptyList()
    val out = ArrayList<Anchor>()
    val minGapFrames = max(1, (350_000.0 / env.frameUs).toInt())
    var lastFrame = -minGapFrames
    for (f in 1 until onset.size - 1) {
        val v = onset[f].toDouble()
        if (v < 0.16 || v < onset[f - 1] || v < onset[f + 1]) continue
        if (f - lastFrame < minGapFrames) continue
        val vocal = if (f < analysis.vocalActivity.size) analysis.vocalActivity[f].toDouble() else 0.5
        val strength = min(1.0, 0.62 * v + 0.38 * vocal)
        out += Anchor(Math.round(f * env.frameUs.toDouble()), strength)
        lastFrame = f
    }
    return out.sortedBy { it.timeUs }
}

/** Choose one anchor per line with a duration-aware DP. */
private fun chooseAnchors(anchors: List<Anchor>, weights: List<Double>, usableUs: Microseconds): List<Int> {
    val n = weights.size
    if (n == 0 || anchors.isEmpty()) return emptyList()
    val pool = anchors.withIndex().sortedByDescending { it.value.strength }.take(240).sortedBy { it.index }
    val k = pool.size
    if (k < n) return emptyList()
    val totalWeight = weights.sum().takeIf { it > 0 } ?: 1.0
    val expected = weights.map { max(400_000.0, usableUs * (it / totalWeight)) }
    val dp = Array(n) { DoubleArray(k) { Double.NEGATIVE_INFINITY } }
    val parent = Array(n) { IntArray(k) { -1 } }
    for (j in 0 until k) dp[0][j] = pool[j].value.strength * 2.0
    val minGap = 380_000L
    for (i in 1 until n) {
        for (j in i until k) {
            var best = Double.NEGATIVE_INFINITY
            var bestPrev = -1
            for (p in i - 1 until j) {
                if (dp[i - 1][p] == Double.NEGATIVE_INFINITY) continue
                val gap = (pool[j].value.timeUs - pool[p].value.timeUs).toDouble()
                if (gap < minGap) continue
                val deviation = abs(gap - expected[i - 1]) / max(1.0, expected[i - 1])
                val score = dp[i - 1][p] + pool[j].value.strength * 2.0 - min(3.0, deviation)
                if (score > best) { best = score; bestPrev = p }
            }
            dp[i][j] = best
            parent[i][j] = bestPrev
        }
    }
    var bestJ = -1
    var bestScore = Double.NEGATIVE_INFINITY
    for (j in n - 1 until k) if (dp[n - 1][j] > bestScore) { bestScore = dp[n - 1][j]; bestJ = j }
    if (bestJ < 0 || parent[n - 1][bestJ] == -1) return emptyList()
    val chosen = IntArray(n)
    var j = bestJ
    for (i in n - 1 downTo 0) {
        chosen[i] = pool[j].index
        j = parent[i][j]
        if (j < 0 && i > 0) return emptyList()
    }
    return chosen.toList()
}

fun alignLyricsToAudio(lines: List<Line>, analysis: AudioAnalysis, durationUs: Microseconds,
                       leadInUs: Microseconds = 300_000): AlignResult {
    if (lines.isEmpty()) return AlignResult(emptyList(), "none", 0.0, "There are no lyric lines to sync.")
    val usable = max(1_000_000L, durationUs - leadInUs)
    val anchors = detectAnchors(analysis)
    val weights = lines.map { lineWeight(it.text) }
    val chosen = chooseAnchors(anchors, weights, usable)
    if (chosen.isEmpty()) {
        // Honest degradation: estimates, clearly marked low-confidence, and a
        // message that points to tap-sync rather than pretending success.
        val estimated = postProcess(estimateLineTimings(lines, DistributeOptions(durationUs = durationUs)),
            PostProcessOptions(durationUs = durationUs, applyLeadIn = true))
        return AlignResult(estimated, "estimate", 0.25,
            "Not enough clear vocal onsets were found. Timings are an estimate — tap-sync for exact placement.",
            emptyList())
    }
    val starts = chosen.map { anchors[it].timeUs }
    var result = lines.mapIndexed { i, line ->
        val start = starts[i]
        val next = if (i + 1 < starts.size) starts[i + 1] else null
        val expected = Math.round(usable * (weights[i] / (weights.sum().takeIf { it > 0 } ?: 1.0)))
        var end = if (next != null) (next - 150_000).coerceAtLeast(start + 600_000)
        else minOf(durationUs, start + expected)
        if (end <= start) end = start + 600_000
        val strength = anchors[chosen[i]].strength
        val confidence = min(0.92, max(0.28, 0.28 + 0.62 * strength))
        val base = line.copy(start = start, end = end, source = TimingSource.ALIGN,
            confidence = confidence, words = emptyList())
        base.copy(words = interpolateWords(base, start, end).map { it.copy(confidence = confidence) })
    }
    result = postProcess(result, PostProcessOptions(durationUs = durationUs, applyLeadIn = true))
    val mean = result.map { it.confidence }.average()
    val message = if (mean < 0.45)
        "Auto-sync found weak evidence in this track. Check the heat map or tap-sync the uncertain lines."
    else "Aligned ${result.size} lines to detected vocal onsets. Review the highlighted low-confidence lines."
    return AlignResult(result, "onset-dp", mean, message, starts)
}

/**
 * Reconcile a machine transcript with the user's true lyrics.
 *
 * The transcript supplies timings; the user's text supplies the words. Global
 * sequence alignment decides which timing belongs to which word, and any word
 * with no evidence is interpolated with a low confidence instead of being
 * silently given a made-up timestamp presented as certain.
 */
fun reconcileTranscript(lines: List<Line>, transcript: List<TranscriptWord>): AlignResult {
    data class TrueWord(val lineIndex: Int, val tokenIndex: Int, val text: String, val line: Line, val tokens: List<Token>)
    val trueWords = ArrayList<TrueWord>()
    lines.forEachIndexed { li, line ->
        highlightTokens(line.text).forEachIndexed { ti, token ->
            trueWords += TrueWord(li, ti, token.text, line, emptyList())
        }
    }
    if (trueWords.isEmpty() || transcript.isEmpty())
        return AlignResult(lines, "transcript-empty", 0.2, "The transcript contained no usable words.")

    val pairs = alignSequences(trueWords, transcript,
        { normalizeForMatch(it.text) }, { normalizeForMatch(it.text) })
    val score = alignmentScore(pairs)
    val assigned = HashMap<Pair<Int, Int>, Pair<Microseconds, Microseconds>>()
    val confidences = HashMap<Pair<Int, Int>, Double>()
    for (p in pairs) {
        val tw = p.a
        val aw = p.b
        if (tw != null && aw != null && p.score >= 0.4) {
            assigned[Pair(tw.lineIndex, tw.tokenIndex)] = Pair(aw.start, max(aw.end, aw.start))
            confidences[Pair(tw.lineIndex, tw.tokenIndex)] = min(0.95, p.score * aw.confidence)
        }
    }
    var matched = 0
    val rebuilt = lines.mapIndexed { li, line ->
        val tokens = highlightTokens(line.text)
        val words = tokens.mapIndexed { ti, token ->
            val range = assigned[Pair(li, ti)]
            if (range != null) {
                matched++
                Word("${line.id}_w$ti", token.text.trim(), normalizeForMatch(token.text),
                    range.first, range.second, confidences[Pair(li, ti)] ?: 0.5,
                    TimingSource.ASR, line.locked)
            } else {
                Word("${line.id}_w$ti", token.text.trim(), normalizeForMatch(token.text),
                    line.start, line.start, 0.25, TimingSource.ESTIMATE, line.locked)
            }
        }
        val withWords = line.copy(words = words, source = TimingSource.ALIGN,
            confidence = min(0.92, 0.3 + 0.5 * score))
        // Fill unmatched words by interpolating between the matched anchors.
        val filled = fillUnmatchedWords(withWords)
        val first = filled.words.firstOrNull()?.start ?: line.start
        val last = filled.words.lastOrNull()?.end ?: line.end
        filled.copy(start = first, end = max(first, last))
    }
    val processed = postProcess(rebuilt, PostProcessOptions())
    return AlignResult(processed, "ctc-nw", min(0.9, 0.3 + 0.6 * score),
        "Matched $matched of ${trueWords.size} words from the local speech model. Unmatched words are marked low-confidence.")
}

private fun fillUnmatchedWords(line: Line): Line {
    val words = line.words.toMutableList()
    val n = words.size
    var i = 0
    while (i < n) {
        if (words[i].source != TimingSource.ESTIMATE) { i++; continue }
        var j = i
        while (j < n && words[j].source == TimingSource.ESTIMATE) j++
        val left = if (i > 0) words[i - 1].end else line.start
        val right = if (j < n) words[j].start else line.end
        val span = max(0L, right - left)
        val count = j - i
        for (k in 0 until count) {
            val s = left + Math.round(span * k.toDouble() / count)
            val e = left + Math.round(span * (k + 1).toDouble() / count)
            words[i + k] = words[i + k].copy(start = s, end = max(s, e), confidence = 0.3)
        }
        i = j
    }
    return line.copy(words = words)
}

/** Silences long enough to be instrumentals, from the waveform envelope. */
fun instrumentalRegions(analysis: AudioAnalysis, minLengthUs: Microseconds = 2_500_000): List<InstrumentalRegion> {
    val p = analysis.peaks
    if (p.buckets == 0) return emptyList()
    val threshold = max(0.004f, p.peakAmplitude * 0.035f)
    val regions = mutableListOf<InstrumentalRegion>()
    var runStart: Microseconds? = null
    for (b in 0 until p.buckets) {
        val rms = p.data[b * 3 + 2]
        val t = b * p.bucketUs
        if (rms < threshold) {
            if (runStart == null) runStart = t
        } else if (runStart != null) {
            if (t - runStart >= minLengthUs) regions += InstrumentalRegion(runStart, t)
            runStart = null
        }
    }
    val end = p.bucketUs * p.buckets
    if (runStart != null && end - runStart >= minLengthUs) regions += InstrumentalRegion(runStart, end)
    return regions
}
