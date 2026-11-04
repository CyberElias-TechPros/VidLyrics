package com.vidlyrics.core

/**
 * Timing distribution.
 *
 * Three cases: imported per-word timings win; line timings get word timings
 * synthesised; bare text gets an estimated timeline. Every estimate is tagged
 * ESTIMATE with low confidence so the editor can paint uncertainty rather than
 * presenting machine output as certain.
 */
data class DistributeOptions(
    val gapUs: Microseconds = 250_000,
    val leadInUs: Microseconds = 400_000,
    val minLineUs: Microseconds = 900_000,
    val durationUs: Microseconds? = null
)

fun createLine(text: String): Line = Line(id = newId("ln"), text = text)

fun lineWeight(text: String): Double {
    val norm = normalizeForMatch(text)
    if (norm.isEmpty()) return 1.0
    val chars = graphemes(norm).size
    val syllables = estimateSyllables(norm)
    return maxOf(1.0, chars * 0.6 + syllables * 6.0)
}

/** Rough syllable estimate; used only for weighting, never for display. */
fun estimateSyllables(text: String): Int {
    val words = normalizeForMatch(text).split(' ').filter { it.isNotEmpty() }
    var total = 0
    for (w in words) {
        val clean = w.replace(Regex("[^a-z]"), "")
        if (clean.isEmpty()) { total += 1; continue }
        val trimmed = clean.replace(Regex("""(?:[^laeiouy]es|ed|[^laeiouy]e)$"""), "")
        val groups = Regex("""[aeiouy]{1,2}""").findAll(trimmed).count()
        total += maxOf(1, groups)
    }
    return maxOf(1, total)
}

fun estimateLineTimings(lines: List<Line>, options: DistributeOptions = DistributeOptions()): List<Line> {
    val weights = lines.map { lineWeight(it.text) }
    val totalWeight = weights.sum().takeIf { it > 0 } ?: 1.0
    val spanEnd = options.durationUs ?: (lines.size * 3_000_000L)
    val usable = maxOf(options.minLineUs,
        spanEnd - options.leadInUs - options.gapUs * maxOf(0, lines.size - 1))
    var cursor = options.leadInUs
    return lines.mapIndexed { i, line ->
        if (line.locked || line.source == TimingSource.HUMAN || line.source == TimingSource.TAP) return@mapIndexed line
        val share = maxOf(options.minLineUs, Math.round(usable * (weights[i] / totalWeight)))
        val start = cursor
        val end = start + share
        cursor = end + options.gapUs
        line.copy(start = start, end = end, source = TimingSource.ESTIMATE, confidence = 0.3,
            words = interpolateWords(line.copy(words = emptyList()), start, end))
    }
}

/** Spread a line's duration over grapheme-safe word tokens. */
fun interpolateWords(line: Line, start: Microseconds, end: Microseconds): List<Word> {
    val tokens = highlightTokens(line.text)
    if (tokens.isEmpty()) return emptyList()
    val duration = maxOf(0L, end - start)
    val weights = tokens.map { maxOf(1, graphemes(it.text).size) }
    val total = weights.sum().toDouble().takeIf { it > 0 } ?: 1.0
    var cursor = start
    return tokens.mapIndexed { i, token ->
        val share = Math.round(duration * (weights[i] / total))
        val wStart = cursor
        val wEnd = if (i == tokens.lastIndex) end else cursor + share
        cursor = wEnd
        Word(
            id = "${line.id}_w$i", text = token.text.trim(), norm = normalizeForMatch(token.text),
            start = wStart, end = maxOf(wEnd, wStart),
            confidence = if (line.source == TimingSource.HUMAN || line.source == TimingSource.TAP) 1.0 else line.confidence,
            source = line.source, locked = line.locked
        )
    }
}

/** Only ESTIMATE words are re-derived; human, tap, ASR and imported timings win. */
fun refreshWordTimings(lines: List<Line>): List<Line> = lines.map { line ->
    if (line.words.any { it.source != TimingSource.ESTIMATE }) line
    else line.copy(words = interpolateWords(line.copy(words = emptyList()), line.start, line.end))
}

/** Merge imported cues into project lines; human/tap timings always win. */
fun mergeParsedTimings(lines: List<Line>, parsed: List<ParsedLine>): List<Line> {
    val bySignature = LinkedHashMap<String, ParsedLine>()
    for (p in parsed) {
        if (p.start == null) continue
        val sig = normalizeForMatch(p.text)
        if (sig.isEmpty()) continue
        bySignature.putIfAbsent(sig, p)
    }
    var cursor = 0L
    return lines.mapIndexed { index, line ->
        if (line.source == TimingSource.HUMAN || line.source == TimingSource.TAP || line.locked) {
            cursor = line.end
            return@mapIndexed line
        }
        val match = bySignature[normalizeForMatch(line.text)]
        if (match != null && match.start != null) {
            val start = match.start
            val end = match.end ?: (start + 2_000_000)
            cursor = end
            return@mapIndexed line.copy(start = start, end = end, source = TimingSource.ALIGN,
                confidence = 0.8, words = mergeWordTimings(line, match, start, end))
        }
        // No textual match: place after the previous cue instead of at zero.
        val fallbackStart = maxOf(cursor, if (index == 0) 0 else cursor)
        cursor = fallbackStart
        line.copy(start = fallbackStart, end = maxOf(line.end, fallbackStart + 600_000))
    }
}

private fun mergeWordTimings(line: Line, parsed: ParsedLine, start: Microseconds, end: Microseconds): List<Word> {
    if (parsed.words.isEmpty()) return interpolateWords(line.copy(words = emptyList()), start, end)
    val tokens = highlightTokens(line.text)
    val byText = LinkedHashMap<String, Int>()
    parsed.words.forEachIndexed { i, w ->
        val key = normalizeForMatch(w.text)
        if (key.isNotEmpty()) byText.putIfAbsent(key, i)
    }
    val assigned = HashMap<Int, Pair<Microseconds, Microseconds>>()
    tokens.forEachIndexed { tokenIndex, token ->
        val idx = byText[normalizeForMatch(token.text)]
        if (idx != null) {
            val w = parsed.words[idx]
            assigned[tokenIndex] = Pair(w.start, maxOf(w.end, w.start))
        }
    }
    if (assigned.isEmpty()) return interpolateWords(line.copy(words = emptyList()), start, end)
    var cursor = start
    return tokens.mapIndexed { i, token ->
        val range = assigned[i]
        val wStart = range?.first ?: maxOf(start, cursor)
        val wEnd = range?.second ?: maxOf(wStart, start)
        cursor = wEnd
        Word("${line.id}_w$i", token.text.trim(), normalizeForMatch(token.text), wStart, wEnd,
            if (range != null) 0.85 else 0.4,
            if (range != null) TimingSource.ALIGN else TimingSource.ESTIMATE, line.locked)
    }
}

/** Build lines from pasted text, dropping structural headers. */
fun linesFromText(text: String, durationUs: Microseconds? = null): Pair<List<Line>, List<Section>> {
    val clean = normalizeDisplay(stripTimingResidue(text))
    val raw = clean.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
    // Run inference on the real ordering so sections follow the source document.
    val ordered = raw.map { createLine(it) }
    val inferred = inferSections(ordered)
    val assignment = inferred.assignment
    val sung = ordered.filter { extractStructuralTag(it.text) == null }
        .map { it.copy(sectionId = assignment[it.id]) }
    val estimated = estimateLineTimings(sung, DistributeOptions(durationUs = durationUs))
    return Pair(postProcess(estimated, PostProcessOptions(durationUs = durationUs, applyLeadIn = true)), inferred.sections)
}
