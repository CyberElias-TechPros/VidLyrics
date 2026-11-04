package com.vidlyrics.core

/**
 * Timing post-processing. Every pass is idempotent (except the opt-in lead-in)
 * and never touches a locked line.
 *
 * Invariant: for sorted lines, start <= end and end <= next.start. Cross-fades
 * are handled by the motion spec at render time, never by overlapping stored
 * data.
 */
data class PostProcessOptions(
    val minLineUs: Microseconds = 600_000,
    val applyLeadIn: Boolean = false,
    val leadInUs: Microseconds = 300_000,
    val gapFillUs: Microseconds = 400_000,
    val durationUs: Microseconds? = null,
    val beatGrid: List<Microseconds> = emptyList(),
    val beatToleranceUs: Microseconds = 90_000
)

fun sortLines(lines: List<Line>): List<Line> = lines.sortedWith(compareBy<Line> { it.start }.thenBy { it.id })

private fun clampWords(words: List<Word>, start: Microseconds, end: Microseconds): List<Word> = words.map { w ->
    val ws = minOf(maxOf(w.start, start), end)
    val we = minOf(maxOf(w.end, ws), end)
    if (ws == w.start && we == w.end) w else w.copy(start = ws, end = we)
}

fun clampTimings(lines: List<Line>, durationUs: Microseconds?): List<Line> = lines.map { line ->
    val start = maxOf(0L, line.start)
    val end = maxOf(start, if (durationUs == null) line.end else minOf(line.end, durationUs))
    if (start == line.start && end == line.end) line
    else line.copy(start = start, end = end, words = clampWords(line.words, start, end))
}

private fun stretchWords(words: List<Word>, start: Microseconds, end: Microseconds): List<Word> {
    val first = words.firstOrNull() ?: return words
    val last = words.last()
    val oldSpan = maxOf(1.0, (last.end - first.start).toDouble())
    val scale = maxOf(1.0, (end - start).toDouble()) / oldSpan
    return words.map { w ->
        w.copy(start = Math.round(start + (w.start - first.start) * scale),
            end = Math.round(start + (w.end - first.start) * scale))
    }
}

fun enforceMinimumDuration(lines: List<Line>, minLineUs: Microseconds): List<Line> = lines.map { line ->
    if (line.end - line.start >= minLineUs) return@map line
    val end = line.start + minLineUs
    line.copy(end = end, words = if (line.words.isEmpty()) line.words else stretchWords(line.words, line.start, end))
}

private fun shiftWords(words: List<Word>, delta: Microseconds): List<Word> = words.map { w ->
    w.copy(start = maxOf(0, w.start + delta), end = maxOf(0, w.end + delta))
}

fun applyLeadIn(lines: List<Line>, leadInUs: Microseconds): List<Line> {
    var previousEnd = 0L
    return lines.map { line ->
        if (line.locked) { previousEnd = line.end; return@map line }
        val start = maxOf(previousEnd, line.start - leadInUs)
        previousEnd = line.end
        if (start == line.start) line else line.copy(start = start, words = shiftWords(line.words, start - line.start))
    }
}

/** Close SHORT silences; long silences (instrumentals) are preserved. */
fun fillGaps(lines: List<Line>, gapFillUs: Microseconds): List<Line> {
    val sorted = sortLines(lines)
    val nextStartById = HashMap<String, Microseconds>()
    for (i in 0 until sorted.size - 1) nextStartById[sorted[i].id] = sorted[i + 1].start
    return lines.map { line ->
        val nextStart = nextStartById[line.id] ?: return@map line
        if (line.locked) return@map line
        val gap = nextStart - line.end
        if (gap <= 0 || gap > gapFillUs) line else line.copy(end = nextStart)
    }
}

fun snapToBeatGrid(lines: List<Line>, beats: List<Microseconds>, toleranceUs: Microseconds): List<Line> {
    if (beats.isEmpty()) return lines
    fun snap(t: Microseconds): Microseconds {
        var best = t; var bestDelta = Double.POSITIVE_INFINITY
        for (b in beats) {
            val d = kotlin.math.abs(b - t)
            if (d < bestDelta) { bestDelta = d.toDouble(); best = b }
            if (b > t + toleranceUs) break
        }
        return if (bestDelta <= toleranceUs) best else t
    }
    fun repair(words: List<Word>): List<Word> {
        var prevEnd = -1L
        return words.map { w ->
            val s = maxOf(w.start, prevEnd)
            val e = maxOf(w.end, s)
            prevEnd = e
            if (s == w.start && e == w.end) w else w.copy(start = s, end = e)
        }
    }
    return lines.map { line ->
        if (line.locked || line.words.isEmpty()) return@map line
        var changed = false
        val words = line.words.map { w ->
            val s = snap(w.start)
            if (s == w.start) w else { changed = true; w.copy(start = s) }
        }
        if (changed) line.copy(words = repair(words)) else line
    }
}

fun resolveOverlaps(lines: List<Line>, durationUs: Microseconds?): List<Line> {
    val sorted = sortLines(lines)
    val trimmed = HashMap<String, Line>()
    var previousEnd = 0L
    for (line in sorted) {
        val adjusted = if (line.start < previousEnd) {
            val start = minOf(previousEnd, line.end)
            line.copy(start = start, words = shiftWords(line.words, start - line.start))
        } else line
        trimmed[line.id] = adjusted
        previousEnd = maxOf(previousEnd, adjusted.end)
    }
    return clampTimings(lines.map { trimmed[it.id] ?: it }, durationUs)
}

data class InstrumentalRegion(val start: Microseconds, val end: Microseconds)

fun detectInstrumentalRegions(lines: List<Line>, durationUs: Microseconds, minLengthUs: Microseconds = 2_500_000): List<InstrumentalRegion> {
    if (durationUs <= 0) return emptyList()
    val sorted = sortLines(lines).filter { it.end > it.start }
    val regions = mutableListOf<InstrumentalRegion>()
    var cursor = 0L
    for (line in sorted) {
        if (line.start - cursor >= minLengthUs) regions += InstrumentalRegion(cursor, line.start)
        cursor = maxOf(cursor, line.end)
    }
    if (durationUs - cursor >= minLengthUs) regions += InstrumentalRegion(cursor, durationUs)
    return regions
}

fun postProcess(lines: List<Line>, options: PostProcessOptions = PostProcessOptions()): List<Line> {
    var result = sortLines(lines)
    result = clampTimings(result, options.durationUs)
    result = enforceMinimumDuration(result, options.minLineUs)
    result = resolveOverlaps(result, options.durationUs)
    if (options.applyLeadIn) result = applyLeadIn(result, options.leadInUs)
    result = fillGaps(result, options.gapFillUs)
    if (options.beatGrid.isNotEmpty()) result = snapToBeatGrid(result, options.beatGrid, options.beatToleranceUs)
    result = resolveOverlaps(result, options.durationUs)
    return refreshWordTimings(result)
}

fun rebuildWordsForLine(line: Line, newText: String): Line {
    val next = line.copy(text = newText, words = emptyList())
    return next.copy(words = interpolateWords(next, next.start, next.end))
}
