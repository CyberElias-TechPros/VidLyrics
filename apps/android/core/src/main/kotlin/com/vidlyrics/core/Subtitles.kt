package com.vidlyrics.core

import java.util.Locale

/** Subtitle + project interchange formats. */
enum class SubtitleFormat(val id: String, val extension: String, val label: String) {
    LRC("lrc", ".lrc", "LRC"),
    ENHANCED_LRC("enhanced-lrc", ".lrc", "Enhanced LRC (word timing)"),
    SRT("srt", ".srt", "SubRip"),
    VTT("vtt", ".vtt", "WebVTT"),
    ASS("ass", ".ass", "ASS karaoke"),
    TXT("txt", ".txt", "Plain lyrics"),
    JSON("json", ".json", "Timed lyrics JSON")
}

data class SubtitleOptions(
    /** Applied at export time, NEVER written back to stored timings. */
    val offsetUs: Microseconds = 0,
    val skipUntimed: Boolean = false,
    val artist: String? = null, val title: String? = null, val album: String? = null
)

private fun timedLines(project: Project, options: SubtitleOptions): List<Line> {
    val offset = options.offsetUs
    return project.lyrics.lines
        .filter { it.text.trim().isNotEmpty() }
        .filter { !options.skipUntimed || it.start > 0 || it.end > 0 }
        .map { it.copy(start = maxOf(0, it.start + offset), end = maxOf(0, it.end + offset)) }
        .sortedWith(compareBy<Line> { it.start }.thenBy { it.id })
}

fun toLrc(project: Project, options: SubtitleOptions = SubtitleOptions()): String {
    val lines = timedLines(project, options)
    val header = mutableListOf<String>()
    val title = options.title ?: project.meta.title
    val artist = options.artist ?: project.meta.artist
    val album = options.album ?: project.meta.album
    if (title.isNotEmpty()) header += "[ti:$title]"
    if (artist.isNotEmpty()) header += "[ar:$artist]"
    if (album.isNotEmpty()) header += "[al:$album]"
    header += "[by:$APP_NAME Android]"
    if (options.offsetUs != 0L) header += "[offset:${Math.round(-options.offsetUs / 1000.0)}]"
    return (header + "" + lines.map { "${Time.formatLrcTimestamp(it.start)}${it.text}" } + "").joinToString("\n")
}

fun toEnhancedLrc(project: Project, options: SubtitleOptions = SubtitleOptions()): String {
    val lines = timedLines(project, options)
    val header = listOf("[ti:${options.title ?: project.meta.title}]",
        "[ar:${options.artist ?: project.meta.artist}]", "[by:$APP_NAME Android]", "")
    val body = lines.map { line ->
        val tags = line.words.filter { it.text.trim().isNotEmpty() }.joinToString("") { w ->
            "<${Time.formatLrcTimestamp(w.start).removePrefix("[").removeSuffix("]")}>${w.text}"
        }
        "${Time.formatLrcTimestamp(line.start)}${tags.ifEmpty { line.text }}"
    }
    return (header + body + "").joinToString("\n")
}

fun toSrt(project: Project, options: SubtitleOptions = SubtitleOptions()): String =
    timedLines(project, options).mapIndexed { i, line ->
        "${i + 1}\n${Time.formatSrtTimestamp(line.start)} --> ${Time.formatSrtTimestamp(line.end)}\n${line.text}\n"
    }.joinToString("\n")

fun toVtt(project: Project, options: SubtitleOptions = SubtitleOptions()): String {
    val cues = timedLines(project, options).mapIndexed { i, line ->
        val words = line.words.filter { it.text.trim().isNotEmpty() }
            .joinToString(" ") { "<${Time.formatVttTimestamp(it.start)}>${it.text}" }
        "cue-${i + 1}\n${Time.formatVttTimestamp(line.start)} --> ${Time.formatVttTimestamp(line.end)}\n${words.ifEmpty { line.text }}\n"
    }
    return (listOf("WEBVTT", "") + cues).joinToString("\n")
}

private fun assColor(hex: String, alpha: Int = 0): String {
    val clean = hex.removePrefix("#")
    val full = if (clean.length == 3) clean.map { "$it$it" }.joinToString("") else clean
    if (full.length < 6) return "&H00FFFFFF"
    val r = full.substring(0, 2); val g = full.substring(2, 4); val b = full.substring(4, 6)
    return "&H${"%02X".format(alpha)}$b$g$r".uppercase(Locale.ROOT)
}

data class AssOptions(
    val fontName: String? = null, val fontSize: Int? = null,
    val primaryColour: String? = null, val outlineColour: String? = null,
    val playResX: Int? = null, val playResY: Int? = null
)

fun toAss(project: Project, options: SubtitleOptions = SubtitleOptions(), ass: AssOptions = AssOptions()): String {
    val lines = timedLines(project, options)
    val x = ass.playResX ?: project.export.width
    val y = ass.playResY ?: project.export.height
    val fontSize = ass.fontSize ?: Math.round(y * 0.05f)
    val fontName = ass.fontName ?: project.design.typography.fontStack.split(',')[0].replace(Regex("""["']"""), "")
    val primary = assColor(ass.primaryColour ?: project.design.typography.activeColor)
    val secondary = assColor(ass.primaryColour ?: project.design.typography.color)
    val outline = assColor(ass.outlineColour ?: "#000000")
    val header = listOf(
        "[Script Info]", "Title: ${options.title ?: project.meta.title}",
        "Original Script: $APP_NAME Android $APP_VERSION", "ScriptType: v4.00+",
        "PlayResX: $x", "PlayResY: $y", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,$fontName,$fontSize,$primary,$secondary,$outline,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,${Math.round(y * 0.09f)},1", "",
        "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ""
    )
    val events = lines.map { line ->
        val karaoke = line.words.filter { it.text.trim().isNotEmpty() }.joinToString(" ") { w ->
            val cs = maxOf(1, Math.round((w.end - w.start) / 10_000.0))
            "{\\kf$cs}${w.text}"
        }
        val text = (karaoke.ifEmpty { line.text }).replace("\n", "\\N")
        val speaker = if (line.speaker == "B") "{\\fad(120,120)}" else ""
        "Dialogue: 0,${Time.formatAssTimestamp(line.start)},${Time.formatAssTimestamp(line.end)},Default,,0,0,0,,$speaker$text"
    }
    return (header + events + "").joinToString("\n")
}

fun toPlainText(project: Project): String = project.lyrics.lines
    .map { it.text }.filter { it.trim().isNotEmpty() }.joinToString("\n")

fun toTimedJson(project: Project, options: SubtitleOptions = SubtitleOptions(),
                instrumentals: List<InstrumentalRegion> = emptyList()): JsonValue {
    val lines = timedLines(project, options)
    return jObj(
        "app" to jObj("name" to jStr(APP_NAME), "version" to jStr(APP_VERSION)),
        "timeUnit" to jStr("microseconds"),
        "exportedAt" to jNum(System.currentTimeMillis()),
        "meta" to jObj("title" to jStr(project.meta.title), "artist" to jStr(project.meta.artist),
            "album" to jStr(project.meta.album), "language" to jStr(project.meta.language)),
        "durationUs" to jNum(project.audio?.durationUs ?: 0L),
        "sections" to jArr(project.sections.map { jObj("id" to jStr(it.id), "kind" to jStr(it.kind.wire),
            "label" to jStr(it.label), "occurrence" to jNum(it.occurrence)) }),
        "instrumentalRegions" to jArr(instrumentals.map { jObj("start" to jNum(it.start), "end" to jNum(it.end)) }),
        "lines" to jArr(lines.map { line ->
            jObj("text" to jStr(line.text), "start" to jNum(line.start), "end" to jNum(line.end),
                "sectionId" to (line.sectionId?.let(::jStr) ?: jNull()),
                "speaker" to (line.speaker?.let(::jStr) ?: jNull()),
                "translation" to (line.translation?.let(::jStr) ?: jNull()),
                "timingSource" to jStr(line.source.wire), "confidence" to jNum(line.confidence),
                "words" to jArr(line.words.map { w -> jObj("text" to jStr(w.text),
                    "start" to jNum(maxOf(0, w.start + options.offsetUs)),
                    "end" to jNum(maxOf(0, w.end + options.offsetUs)), "confidence" to jNum(w.confidence)) }))
        })
    )
}

fun serialiseSubtitle(project: Project, format: SubtitleFormat, options: SubtitleOptions = SubtitleOptions()): String = when (format) {
    SubtitleFormat.LRC -> toLrc(project, options)
    SubtitleFormat.ENHANCED_LRC -> toEnhancedLrc(project, options)
    SubtitleFormat.SRT -> toSrt(project, options)
    SubtitleFormat.VTT -> toVtt(project, options)
    SubtitleFormat.ASS -> toAss(project, options)
    SubtitleFormat.TXT -> toPlainText(project)
    SubtitleFormat.JSON -> Json.stringify(toTimedJson(project, options))
}

fun buildProjectFile(project: Project, assets: List<AssetRecord> = emptyList()): ProjectFile =
    ProjectFile(exportedAt = System.currentTimeMillis(), project = project, assets = assets)

fun serialiseProjectFile(file: ProjectFile): String = Json.stringify(encodeProjectFile(file))

fun suggestedFileName(project: Project, extension: String): String {
    val base = listOf(project.meta.artist, project.meta.title).filter { it.isNotBlank() }.joinToString(" - ")
        .ifEmpty { "lyric-video" }
    val safe = java.text.Normalizer.normalize(base, java.text.Normalizer.Form.NFKD)
        .replace(Regex("""[^\w\s-]"""), "").trim().replace(Regex("""\s+"""), "-").take(80)
        .ifEmpty { "lyric-video" }
    return "$safe$extension"
}
