package com.vidlyrics.core

import java.util.Locale

/**
 * Lyric import: LRC (incl. enhanced word tags), SRT, WebVTT (incl. inline word
 * tags), ASS (incl. {\kf} karaoke), timed JSON and plain text.
 *
 * Import is lossless and non-destructive: callers receive raw text plus timings
 * and decide how to merge them. A malformed block is skipped with a warning;
 * one bad cue never destroys a whole import.
 */
enum class LyricFormat(val wire: String) {
    LRC("lrc"), SRT("srt"), VTT("vtt"), ASS("ass"), JSON("json"), TXT("txt"), PROJECT("project")
}

data class ParsedWord(val text: String, val start: Microseconds, val end: Microseconds)
data class ParsedLine(
    val text: String, val start: Microseconds?, val end: Microseconds?,
    val words: List<ParsedWord> = emptyList()
)
data class ParsedMeta(
    val title: String? = null, val artist: String? = null, val album: String? = null,
    val offsetUs: Microseconds = 0
)
data class ParsedLyrics(
    val format: LyricFormat, val lines: List<ParsedLine>, val meta: ParsedMeta = ParsedMeta(),
    val warnings: List<String> = emptyList()
)

fun detectFormat(fileName: String, contents: String): LyricFormat {
    val ext = fileName.substringAfterLast('.', "").lowercase(Locale.ROOT)
    if (ext == "srt") return LyricFormat.SRT
    if (ext == "vtt") return LyricFormat.VTT
    if (ext == "ass" || ext == "ssa") return LyricFormat.ASS
    if (ext == "lrc") return LyricFormat.LRC
    if (ext == "json") {
        val isProject = contents.contains("\"kind\":\"vidlyrics.project\"") ||
            contents.contains("\"kind\": \"vidlyrics.project\"")
        return if (isProject) LyricFormat.PROJECT else LyricFormat.JSON
    }
    val head = contents.take(4096).trimStart()
    if (head.startsWith("WEBVTT")) return LyricFormat.VTT
    if (Regex("""^\[Script Info\]""", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)).containsMatchIn(head)) return LyricFormat.ASS
    if (head.startsWith("{") || head.startsWith("[")) {
        val parsed = Json.tryParse(contents)
        if (parsed?.get("kind")?.asString == "vidlyrics.project") return LyricFormat.PROJECT
        if (Regex("""" (text|line|start|words) " """.trim()).containsMatchIn(head)) return LyricFormat.JSON
        // A JSON object carrying a `lines` array is ours even without a hint.
        if (parsed?.get("lines")?.asArray != null) return LyricFormat.JSON
    }
    if (Regex("""^\[\d{1,2}:\d{2}([.:]\d{1,3})?\]""", RegexOption.MULTILINE).containsMatchIn(head)) return LyricFormat.LRC
    if (Regex("""^\d+\s*\n\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->""", RegexOption.MULTILINE).containsMatchIn(head)) return LyricFormat.SRT
    return LyricFormat.TXT
}

fun parseLyrics(fileName: String, contents: String): ParsedLyrics {
    val format = detectFormat(fileName, contents)
    return when (format) {
        LyricFormat.LRC -> parseLrc(contents)
        LyricFormat.SRT -> parseSrtOrVtt(contents, LyricFormat.SRT)
        LyricFormat.VTT -> parseSrtOrVtt(contents, LyricFormat.VTT)
        LyricFormat.ASS -> parseAss(contents)
        LyricFormat.JSON -> parseJsonLyrics(contents)
        LyricFormat.PROJECT -> parseTimedJson(contents)
        LyricFormat.TXT -> parsePlainText(contents)
    }
}

/* ------------------------------- LRC ------------------------------- */

private val LRC_META = Regex("""^\[(ti|ar|al|by|re|ve|offset|length|au|hash|sign|qq|total|language):(.*)]$""", RegexOption.IGNORE_CASE)
private val LRC_TIME = Regex("""\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?]""")
private val LRC_WORD_TIME = Regex("""<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>""")

private fun tagToUs(min: String, sec: String, frac: String?): Microseconds {
    val digits = ((frac ?: "0") + "000").take(3)
    return (min.toLong() * 60 + sec.toLong()) * Time.US_PER_SECOND + digits.toLong() * Time.US_PER_MS
}

private fun parseEnhancedLrcWords(rest: String): List<ParsedWord> {
    val marks = LRC_WORD_TIME.findAll(rest).map { m ->
        Triple(tagToUs(m.groupValues[1], m.groupValues[2], m.groupValues[3].ifEmpty { null }),
            m.range.first, m.range.last + 1)
    }.toList()
    if (marks.size < 2) return emptyList()
    return marks.mapIndexed { i, mark ->
        val text = rest.substring(mark.second, if (i + 1 < marks.size) marks[i + 1].second else rest.length)
            .replace(LRC_WORD_TIME, "").trim()
        val end = if (i + 1 < marks.size) marks[i + 1].first else mark.first + 400_000
        ParsedWord(text, mark.first, maxOf(mark.first, end))
    }.filter { it.text.isNotEmpty() }
}

private fun parseLrc(contents: String): ParsedLyrics {
    val warnings = mutableListOf<String>()
    val lines = mutableListOf<ParsedLine>()
    var title: String? = null; var artist: String? = null; var album: String? = null; var offset = 0L
    for (raw in contents.replace(Regex("\r\n?"), "\n").split('\n')) {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) continue
        val meta = LRC_META.matchEntire(trimmed)
        if (meta != null && !Regex("""^\[\d{1,2}:""").containsMatchIn(trimmed)) {
            when (meta.groupValues[1].lowercase(Locale.ROOT)) {
                "ti" -> title = meta.groupValues[2].trim()
                "ar", "au" -> artist = meta.groupValues[2].trim()
                "al" -> album = meta.groupValues[2].trim()
                "offset" -> {
                    val n = meta.groupValues[2].trim().toLongOrNull()
                    if (n != null) offset = -n * Time.US_PER_MS
                    else warnings += "Ignored non-numeric LRC offset."
                }
            }
            continue
        }
        val stamps = LRC_TIME.findAll(trimmed).toList()
        if (stamps.isEmpty()) continue
        val rest = trimmed.substring(stamps.last().range.last + 1)
        val text = normalizeDisplay(rest.replace(LRC_WORD_TIME, ""))
        if (text.isEmpty()) continue
        val words = parseEnhancedLrcWords(rest)
        for (s in stamps) {
            val start = tagToUs(s.groupValues[1], s.groupValues[2], s.groupValues[3].ifEmpty { null })
            lines += ParsedLine(text, maxOf(0, start + offset), null, words)
        }
    }
    lines.sortBy { it.start ?: 0 }
    return ParsedLyrics(LyricFormat.LRC, lines, ParsedMeta(title, artist, album, offset), warnings)
}

/* --------------------------- SRT / VTT ----------------------------- */

private val CUE_RANGE = Regex("""(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})""")
private val VTT_WORD_TAG = Regex("""<(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})>""")

private fun rangeToUs(m: MatchResult, offset: Int): Microseconds {
    val h = m.groupValues[offset + 0].toLong(); val min = m.groupValues[offset + 1].toLong()
    val s = m.groupValues[offset + 2].toLong()
    val frac = (m.groupValues[offset + 3] + "000").take(3).toLong()
    return ((h * 60 + min) * 60 + s) * Time.US_PER_SECOND + frac * Time.US_PER_MS
}

private fun stripVttInlineTags(text: String): String = text
    .replace(Regex("""<\d{1,2}:\d{2}:\d{2}\.\d{1,3}>"""), "")
    .replace(Regex("""</?c\.[^>]*>"""), "")
    .replace(Regex("""<[^>]+>"""), "")

private fun parseVttWordTags(text: String): List<ParsedWord> {
    val marks = VTT_WORD_TAG.findAll(text).map { m ->
        val start = ((m.groupValues[1].toLong() * 60 + m.groupValues[2].toLong()) * 60 + m.groupValues[3].toLong()) * Time.US_PER_SECOND +
            (m.groupValues[4] + "000").take(3).toLong() * Time.US_PER_MS
        Triple(start, m.range.first, m.range.last + 1)
    }.toList()
    if (marks.size < 2) return emptyList()
    return marks.mapIndexed { i, mark ->
        val chunk = text.substring(mark.third, if (i + 1 < marks.size) marks[i + 1].second else text.length)
        ParsedWord(normalizeDisplay(stripVttInlineTags(chunk)), mark.first,
            if (i + 1 < marks.size) marks[i + 1].first else mark.first)
    }.filter { it.text.isNotEmpty() }
}

private fun parseSrtOrVtt(contents: String, format: LyricFormat): ParsedLyrics {
    val warnings = mutableListOf<String>()
    val lines = mutableListOf<ParsedLine>()
    val normalized = contents.replace(Regex("\r\n?"), "\n").removePrefix("\uFEFF")
    var skipped = 0
    for (block in normalized.split(Regex("""\n{2,}"""))) {
        val body = block.split('\n').filter { it.trim().isNotEmpty() }.toMutableList()
        if (body.isEmpty()) continue
        if (format == LyricFormat.VTT && body[0].startsWith("WEBVTT")) {
            body.removeAt(0); if (body.isEmpty()) continue
        }
        if (body[0].startsWith("NOTE") || body[0].startsWith("STYLE")) continue
        val rangeIndex = body.indexOfFirst { CUE_RANGE.containsMatchIn(it) }
        if (rangeIndex == -1) { skipped++; continue }
        val m = CUE_RANGE.find(body[rangeIndex])
        if (m == null) { skipped++; continue }
        val start = rangeToUs(m, 1)
        val end = rangeToUs(m, 5)
        val rawText = body.drop(rangeIndex + 1).joinToString(" ")
        val text = normalizeDisplay(body.drop(rangeIndex + 1).joinToString(" ") { stripVttInlineTags(it) })
        if (text.isEmpty()) { skipped++; continue }
        lines += ParsedLine(text, start, end, if (format == LyricFormat.VTT) parseVttWordTags(rawText) else emptyList())
    }
    if (skipped > 0) warnings += "Skipped $skipped block(s) without a usable timestamp range."
    return ParsedLyrics(format, lines, ParsedMeta(), warnings)
}

/* ------------------------------- ASS ------------------------------- */

private fun splitAssFields(payload: String): List<String> {
    val fields = ArrayList<String>(10)
    var start = 0
    for (i in 0 until 9) {
        val comma = payload.indexOf(',', start)
        if (comma == -1) return fields
        fields += payload.substring(start, comma)
        start = comma + 1
    }
    fields += payload.substring(start)   // the 10th field keeps its commas
    return fields
}

private fun stripAssOverrides(text: String): String = text
    .replace(Regex("""\{[^}]*}"""), "")
    .replace(Regex("""\\N""", RegexOption.IGNORE_CASE), "\n")
    .replace(Regex("""\\n"""), "\n")
    .replace(Regex("""\\h"""), " ")

private val ASS_KARAOKE = Regex("""\{\\[kK](?:f|o)?(\d+)}([^{}]*)""")

private fun parseAssClock(text: String): Microseconds? {
    val m = Regex("""^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})$""").matchEntire(text.trim()) ?: return null
    val h = m.groupValues[1].toLong(); val min = m.groupValues[2].toLong(); val s = m.groupValues[3].toLong()
    val cs = (m.groupValues[4] + "00").take(2).toLong()
    return (h * 3600 + min * 60 + s) * Time.US_PER_SECOND + cs * 10_000
}

private fun parseAss(contents: String): ParsedLyrics {
    val warnings = mutableListOf<String>()
    val lines = mutableListOf<ParsedLine>()
    var section = ""
    var title: String? = null
    for (raw in contents.replace(Regex("\r\n?"), "\n").split('\n')) {
        val line = raw.trim()
        if (line.isEmpty()) continue
        if (line.startsWith("[") && line.endsWith("]")) {
            section = line.substring(1, line.length - 1).lowercase(Locale.ROOT); continue
        }
        if (section == "script info") {
            val idx = line.indexOf(':')
            if (idx > 0 && line.substring(0, idx).trim().equals("title", true)) title = line.substring(idx + 1).trim()
            continue
        }
        if (section != "events" || !line.startsWith("Dialogue:", true)) continue
        val payload = line.substring(line.indexOf(':') + 1)
        val fields = splitAssFields(payload)
        if (fields.size < 10) { warnings += "Skipped a malformed ASS Dialogue line."; continue }
        val start = parseAssClock(fields[1]) ?: 0
        val end = parseAssClock(fields[2]) ?: start
        val text = fields[9]
        var cursor = start
        val words = ASS_KARAOKE.findAll(text).mapNotNull { m ->
            val duration = m.groupValues[1].toLong() * 10_000
            val clean = normalizeDisplay(stripAssOverrides(m.groupValues[2]))
            val word = if (clean.isEmpty()) null else ParsedWord(clean, cursor, cursor + duration)
            cursor += duration
            word
        }.toList()
        val clean = normalizeDisplay(stripAssOverrides(text))
        if (clean.isEmpty()) continue
        lines += ParsedLine(clean, start, end, words)
    }
    lines.sortBy { it.start ?: 0 }
    return ParsedLyrics(LyricFormat.ASS, lines, ParsedMeta(title = title), warnings)
}

/* ------------------------------ JSON ------------------------------- */

private enum class TimeUnit { MICROSECONDS, MILLISECONDS, SECONDS }

private fun inferTimeUnit(entries: List<JsonValue>, declared: String?): TimeUnit {
    when (declared) {
        "microseconds" -> return TimeUnit.MICROSECONDS
        "milliseconds" -> return TimeUnit.MILLISECONDS
        "seconds" -> return TimeUnit.SECONDS
    }
    var max = 0.0
    fun scan(v: JsonValue) {
        when (v) {
            is JsonValue.Num -> if (v.value > max) max = v.value
            is JsonValue.Arr -> v.value.forEach(::scan)
            is JsonValue.Obj -> for ((k, child) in v.value) {
                if (k == "start" || k == "end" || k == "time" || k == "timestamp") scan(child)
                else if (child is JsonValue.Obj || child is JsonValue.Arr) scan(child)
            }
            else -> Unit
        }
    }
    entries.forEach(::scan)
    return when {
        max == 0.0 -> TimeUnit.MICROSECONDS
        max < 10_000 -> TimeUnit.SECONDS
        max < 10_000_000 -> TimeUnit.MILLISECONDS
        else -> TimeUnit.MICROSECONDS
    }
}

private fun coerceTimeUs(v: JsonValue?, unit: TimeUnit): Microseconds? {
    if (v == null) return null
    v.asString?.let { Time.parseClock(it)?.let { return it }; it.toDoubleOrNull()?.let { n -> return coerceTimeUs(JsonValue.Num(n), unit) } }
    val n = v.asDouble ?: return null
    return when (unit) {
        TimeUnit.SECONDS -> Time.fromSeconds(n)
        TimeUnit.MILLISECONDS -> Time.fromMs(n)
        TimeUnit.MICROSECONDS -> Math.round(n)
    }
}

private fun entriesFromJson(root: JsonValue?): List<JsonValue> {
    if (root == null) return emptyList()
    val array = root.asArray
    if (array != null) return array
    val keys = listOf("lines", "lyrics", "cues", "segments")
    return keys.flatMap { root.array(it) }
}

private fun parseJsonLyrics(contents: String): ParsedLyrics {
    val warnings = mutableListOf<String>()
    val root = Json.tryParse(contents)
    if (root == null) {
        warnings += "JSON could not be parsed."
        return ParsedLyrics(LyricFormat.JSON, emptyList(), ParsedMeta(), warnings)
    }
    val entries = entriesFromJson(root)
    val declared = root.get("timeUnit")?.asString
    val unit = inferTimeUnit(entries, declared)
    if (declared == null && entries.isNotEmpty()) warnings += "No time unit was declared, so timings were read as ${unit.name.lowercase(Locale.ROOT)}."
    val lines = mutableListOf<ParsedLine>()
    for (entry in entries) {
        val text = normalizeDisplay(entry.string("text").ifEmpty { entry.string("line") })
        if (text.isEmpty()) continue
        val start = coerceTimeUs(entry.get("start"), unit)
        val end = coerceTimeUs(entry.get("end"), unit)
        var cursor = start ?: 0
        val words = entry.array("words").mapNotNull { w ->
            val wt = normalizeDisplay(w.string("text"))
            if (wt.isEmpty()) return@mapNotNull null
            val ws = coerceTimeUs(w.get("start"), unit) ?: cursor
            val we = maxOf(ws, coerceTimeUs(w.get("end"), unit) ?: ws)
            cursor = we
            ParsedWord(wt, ws, we)
        }
        lines += ParsedLine(text, start, end, words)
    }
    lines.sortBy { it.start ?: 0 }
    return ParsedLyrics(LyricFormat.JSON, lines, ParsedMeta(), warnings)
}

/** A .vidlyricsproject file is a richer JSON shape; extract its lines. */
private fun parseTimedJson(contents: String): ParsedLyrics {
    val warnings = mutableListOf<String>()
    val root = Json.tryParse(contents) ?: return ParsedLyrics(LyricFormat.PROJECT, emptyList(), ParsedMeta(), listOf("Project file is not valid JSON."))
    val project = root.get("project") ?: root
    val entries = project.array("lyrics").let { v ->
        if (v.isEmpty()) project.get("lyrics")?.array("lines") ?: emptyList() else v
    }
    val lines = entries.mapNotNull { e ->
        val text = e.string("text")
        if (text.isBlank()) return@mapNotNull null
        ParsedLine(normalizeDisplay(text), e.long("start"), e.long("end").takeIf { it > 0 })
    }
    return ParsedLyrics(LyricFormat.PROJECT, lines, ParsedMeta(), warnings)
}

/* ------------------------------- TXT ------------------------------- */

private fun parsePlainText(contents: String): ParsedLyrics {
    val cleaned = stripTimingResidue(contents)
    val lines = normalizeDisplay(cleaned).split('\n')
        .map { it.trim() }.filter { it.isNotEmpty() }
        .map { ParsedLine(it, null, null) }
    return ParsedLyrics(LyricFormat.TXT, lines)
}
