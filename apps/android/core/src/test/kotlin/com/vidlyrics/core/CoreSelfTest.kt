package com.vidlyrics.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * Dependency-free verification suite for the pure-Kotlin domain layer.
 * Runs as a plain JVM main so it can be executed with kotlinc alone (no Android
 * SDK, no JUnit, no Gradle plugin) — see apps/android/core/verify.sh and the
 * :core:verifyCore Gradle task.
 */
private var checks = 0
private var failures = 0
private var group = ""

private fun section(name: String) { group = name; println("\n== $name ==") }

private fun check(label: String, condition: Boolean, detail: () -> String = { "" }) {
    checks++
    if (condition) println("  PASS  $label")
    else { failures++; println("  FAIL  $label ${detail()}") }
}

private fun eq(label: String, expected: Any?, actual: Any?) =
    check(label, expected == actual, { "expected=$expected actual=$actual" })

private fun near(label: String, expected: Double, actual: Double, tolerance: Double) =
    check(label, abs(expected - actual) <= tolerance, { "expected=$expected actual=$actual tol=$tolerance" })

fun main() {
    println("VidLyrics core verification — ${APP_NAME} $APP_VERSION")

    section("Time: integer microseconds and exports")
    eq("ms→us", 1_500_000L, Time.fromMs(1500.0))
    eq("s→us", 2_500_000L, Time.fromSeconds(2.5))
    eq("clock", "01:05", Time.formatClock(65_000_000L))
    eq("timecode", "00:02.35", Time.formatTimecode(2_350_000L))
    eq("SRT", "00:01:02,345", Time.formatSrtTimestamp(62_345_000L))
    eq("VTT", "00:01:02.345", Time.formatVttTimestamp(62_345_000L))
    eq("LRC", "[01:02.34]", Time.formatLrcTimestamp(62_340_000L))
    eq("ASS", "0:01:02.34", Time.formatAssTimestamp(62_340_000L))
    eq("parse mm:ss.cs", 62_340_000L, Time.parseClock("01:02.34"))
    eq("parse hh:mm:ss,mmm", 3_723_456_000L, Time.parseClock("1:02:03.456"))
    check("parse rejects nonsense", Time.parseClock("nope") == null)
    eq("frame 45 at 30fps", 1_500_000L, Time.frameToUs(45, 30))
    eq("frame index", 45L, Time.frameIndex(1_510_000L, 30))

    section("Strict JSON")
    val jsonText = """{"a":1,"b":[true,null,{"c":"héllo\n"}],"n":-2.5e2}"""
    val parsed = Json.parse(jsonText)
    eq("number", 1L, parsed.long("a"))
    eq("nested string", "héllo\n", parsed.array("b")[2].string("c"))
    eq("scientific", -250.0, parsed.double("n"))
    val roundtrip = Json.parse(Json.stringify(parsed, pretty = false))
    eq("roundtrip", Json.stringify(parsed, pretty = false), Json.stringify(roundtrip, pretty = false))
    check("trailing content rejected", run { try { Json.parse("{} garbage"); false } catch (_: JsonException) { true } })
    check("bad escape rejected", run { try { Json.parse("""{"a":"\q"}"""); false } catch (_: JsonException) { true } })

    section("Graphemes & normalisation (Unicode safety)")
    eq("combining accent is one cluster", 1, graphemes("e\u0301").size)
    eq("ZWJ family is one cluster", 1, graphemes("\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67").size)
    eq("flag is one cluster", 1, graphemes("\uD83C\uDDEF\uD83C\uDDF5").size)
    check("CJK detected", needsGraphemeTokenisation("東京の夜"))
    check("CJK split into clusters", highlightTokens("東京の夜").size >= 4)
    eq("punctuation stripped", "dont stop", normalizeForMatch("Don't — stop!"))
    eq("accents fold", "cafe", normalizeForMatch("Café"))
    eq("apostrophe variants match", normalizeForMatch("don’t"), normalizeForMatch("dont"))
    eq("display keeps original", "Café", normalizeDisplay("  Café  "))
    eq("structural tag", "CHORUS", extractStructuralTag("[Chorus]"))
    check("instrumental marker", isInstrumentalMarker("(Instrumental)"))
    eq("ad lib split", "Hello", splitAdLib("Hello (hello!)").first)

    section("Subtitle / lyrics import")
    val lrc = """[ti:Test Song]
[ar:An Artist]
[offset:500]
[00:01.00]First line
[00:03.50]<00:03.50>Second <00:04.00>line
"""
    val lrcParsed = parseLyrics("song.lrc", lrc)
    eq("lrc format", LyricFormat.LRC, lrcParsed.format)
    eq("lrc title", "Test Song", lrcParsed.meta.title)
    eq("lrc offset sign", -500_000L, lrcParsed.meta.offsetUs)
    eq("lrc lines", 2, lrcParsed.lines.size)
    eq("lrc start with offset", 500_000L, lrcParsed.lines[0].start)
    eq("enhanced lrc words", 2, lrcParsed.lines[1].words.size)

    val srt = """1
00:00:01,000 --> 00:00:03,000
Hello world, again

2
00:00:04,500 --> 00:00:06,000
Second cue
"""
    val srtParsed = parseLyrics("a.srt", srt)
    eq("srt lines", 2, srtParsed.lines.size)
    eq("srt start", 1_000_000L, srtParsed.lines[0].start)
    eq("srt text kept commas", "Hello world, again", srtParsed.lines[0].text)

    val vtt = """WEBVTT

cue-1
00:00:01.000 --> 00:00:03.000
<00:00:01.000>Hello <00:00:02.000>world
"""
    val vttParsed = parseLyrics("a.vtt", vtt)
    eq("vtt format", LyricFormat.VTT, vttParsed.format)
    eq("vtt word tags", 2, vttParsed.lines[0].words.size)

    val ass = """[Script Info]
Title: ASS test
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\kf30}Sing {\kf30}along, with me
"""
    val assParsed = parseLyrics("k.ass", ass)
    eq("ass lines", 1, assParsed.lines.size)
    eq("ass commas preserved", "Sing along, with me", assParsed.lines[0].text)
    eq("ass karaoke words", 2, assParsed.lines[0].words.size)
    eq("ass second word start", 1_300_000L, assParsed.lines[0].words[1].start)

    val txt = "[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\nSing it loud\n"
    val (builtLines, builtSections) = linesFromText(txt, 30_000_000)
    eq("headers removed from lines", 3, builtLines.size)
    check("sections inferred", builtSections.any { it.kind == SectionKind.VERSE } && builtSections.any { it.kind == SectionKind.CHORUS })
    check("all lines timed", builtLines.all { it.end > it.start })
    check("words generated", builtLines.all { it.words.isNotEmpty() })
    check("lines sorted non-overlapping", builtLines.zipWithNext().all { (a, b) -> a.end <= b.start })

    val foreignJson = """{"lines":[{"text":"one","start":1.5,"end":3.0},{"text":"two","start":4.0,"end":6.0}]}"""
    val foreign = parseLyrics("x.json", foreignJson)
    eq("json unit inferred seconds", 1_500_000L, foreign.lines[0].start)
    check("undeclared unit warned", foreign.warnings.any { it.contains("time unit") })

    section("Timing distribution & post-processing")
    val manual = createLine("Human line").copy(start = 9_000_000, end = 10_000_000, source = TimingSource.HUMAN)
    val timed = estimateLineTimings(listOf(createLine("short"), manual, createLine("a much longer lyric line")))
    eq("human timing preserved", 9_000_000L, timed[1].start)
    check("estimates marked low confidence", timed[0].confidence <= 0.3)
    val minDuration = enforceMinimumDuration(listOf(createLine("flash").copy(start = 1_000_000, end = 1_100_000)), 600_000)
    eq("min display duration", 1_600_000L, minDuration[0].end)
    val overlapping = listOf(
        createLine("a").copy(start = 0, end = 2_000_000),
        createLine("b").copy(start = 1_000_000, end = 3_000_000),
        createLine("c").copy(start = 2_500_000, end = 4_000_000))
    val resolved = postProcess(overlapping, PostProcessOptions(durationUs = 10_000_000))
    check("no overlaps after post-process", resolved.zipWithNext().all { (a, b) -> a.end <= b.start },
        { resolved.toString() })
    check("post-process is idempotent", postProcess(resolved, PostProcessOptions(durationUs = 10_000_000)).map { it.start } == resolved.map { it.start })
    val lead = applyLeadIn(listOf(createLine("x").copy(start = 1_000_000, end = 2_000_000)), 300_000)
    eq("lead-in pulls display earlier", 700_000L, lead[0].start)
    check("beat snap within tolerance", snapToBeatGrid(listOf(createLine("x").copy(
        start = 1_000_000, end = 2_000_000,
        words = listOf(Word("w", "x", "x", 1_020_000, 1_500_000, 0.5, TimingSource.ESTIMATE, false)))),
        listOf(1_000_000L), 90_000)[0].words[0].start == 1_000_000L)

    section("Tap-sync (audio-clock driven)")
    var tap = TapSession()
    tap = reduceTap(tap, TapCommand.TapAt(1_000_000L), 3)
    tap = reduceTap(tap, TapCommand.TapAt(1_010_000L), 3) // double-fire rejected
    tap = reduceTap(tap, TapCommand.TapAt(2_000_000L), 3)
    eq("double-fire rejected", 2, tap.taps.size)
    tap = reduceTap(tap, TapCommand.SetCompensation(50_000L), 3)
    tap = reduceTap(tap, TapCommand.TapAt(3_050_000L), 3)
    eq("compensation applied", 3_000_000L, tap.taps.last().timeUs)
    val tapped = applyTaps(listOf(createLine("a"), createLine("b"), createLine("c")), tap, 10_000_000)
    eq("tap start", 1_000_000L, tapped[0].start)
    check("tap confidence is certain", tapped[0].confidence == 1.0)
    check("tap end keeps gap", tapped[0].end == 2_000_000L - tap.gapUs)
    eq("tap progress", 1.0, tapProgress(tap, 3))
    eq("undo", 2, reduceTap(tap, TapCommand.Undo, 3).taps.size)
    check("compensation suggestion", suggestCompensation(
        TapSession(taps = listOf(Tap(0, 1_040_000, 1), Tap(1, 2_040_000, 2), Tap(2, 3_040_000, 3))),
        listOf(1_000_000, 2_000_000, 3_000_000)) == 40_000L)

    section("Sequence alignment (transcript reconciliation)")
    val pairs = alignSequences(listOf("hello", "darkness", "my", "old", "friend"),
        listOf("hello", "darknes", "my", "friend"), { it }, { it })
    check("identical words paired", pairs.count { it.a != null && it.b != null && it.score == 1.0 } >= 3)
    check("deletion represented", pairs.any { it.b == null })
    check("alignment score in range", alignmentScore(pairs) in 0.0..1.0)
    val transcript = listOf(
        TranscriptWord("Hello", 1_000_000, 1_400_000, 0.9),
        TranscriptWord("world", 1_500_000, 2_100_000, 0.8))
    val reconciled = reconcileTranscript(listOf(createLine("Hello world").copy(start = 0, end = 3_000_000)), transcript)
    check("timings transplanted", reconciled.lines[0].words[0].start == 1_000_000L)
    check("machine confidence < 1", reconciled.lines[0].words.all { it.confidence < 1.0 })
    check("method reported", reconciled.method == "ctc-nw")

    section("DSP: FFT, peaks, spectrum, beats")
    val sr = 44100
    val fftSize = 1024
    val sine = FloatArray(fftSize) { i -> (0.8 * sin(2 * PI * 440 * i / sr)).toFloat() }
    val mag = magnitudeSpectrum(sine, fftSize, FloatArray(fftSize / 2 + 1), FloatArray(fftSize * 2))
    val peakBin = mag.indices.maxByOrNull { mag[it] } ?: -1
    near("FFT finds 440 Hz", 440.0, peakBin * sr.toDouble() / fftSize, 60.0)

    // A 120 BPM click track: impulses every 0.5 s, 12 seconds long.
    val pcm = FloatArray(sr * 12)
    var t = 0
    while (t < pcm.size) {
        for (k in 0 until 900) if (t + k < pcm.size) pcm[t + k] = (0.9 * sin(2 * PI * 1000 * k / sr) * Math.exp(-k / 220.0)).toFloat()
        t += sr / 2
    }
    val analysis = analysePcm(pcm, sr)
    check("peaks extracted", analysis.peaks.buckets > 100)
    near("duration", 12.0, analysis.durationUs / 1_000_000.0, 0.2)
    check("spectrum frames", analysis.spectrum.frameCount > 100)
    check("beat grid found", analysis.beatGrid != null)
    near("tempo ~120 BPM", 120.0, analysis.beatGrid?.bpm ?: 0.0, 12.0)
    check("vocal activity computed", analysis.vocalActivity.isNotEmpty())
    check("peak amplitude", analysis.peaks.peakAmplitude > 0.5f)
    val decimated = decimate(analysis.peaks, 0, 12_000_000, 120)
    eq("decimation to pixels", 120, decimated.size)
    check("instrumental silence detected", instrumentalRegions(analysis, 400_000).isNotEmpty())

    section("Auto-alignment from audio features")
    val lyricLines = listOf("First line of the song", "Second line goes here", "Third line, a bit longer", "Fourth and final line")
    val aligned = alignLyricsToAudio(lyricLines.map { createLine(it) }, analysis, 12_000_000)
    check("method reported", aligned.method.isNotEmpty())
    check("all lines timed", aligned.lines.all { it.end > it.start })
    check("sorted non-overlapping", aligned.lines.zipWithNext().all { (a, b) -> a.end <= b.start })
    check("machine output never certain", aligned.lines.all { it.confidence <= 0.92 })
    check("confidence reported", aligned.confidence in 0.0..1.0)

    section("Subtitle export")
    val project = Project(
        meta = ProjectMeta(title = "Song", artist = "Artist", album = "Album"),
        audio = AudioMeta("a1", "song.m4a", "audio/mp4", 1234, 10_000_000, 44100, 2, "p1", "hash"),
        lyrics = LyricsState(source = LyricSource.USER, originalText = "Hello world\nSecond line",
            lines = listOf(
                createLine("Hello world").copy(start = 1_000_000, end = 3_000_000, words = listOf(
                    Word("w0", "Hello", "hello", 1_000_000, 1_600_000, 1.0, TimingSource.HUMAN, false),
                    Word("w1", "world", "world", 1_600_000, 2_400_000, 1.0, TimingSource.HUMAN, false))),
                createLine("Second line").copy(start = 4_000_000, end = 6_000_000))),
        sections = listOf(Section("s1", SectionKind.VERSE, "Verse 1", 1)),
        export = ExportSettings(rangeEndUs = 10_000_000))
    check("LRC header", toLrc(project).contains("[ti:Song]"))
    check("LRC timestamp", toLrc(project).contains("[00:01.00]Hello world"))
    check("enhanced LRC word tag", toEnhancedLrc(project).contains("<00:01.60>world"))
    check("SRT range", toSrt(project).contains("00:00:01,000 --> 00:00:03,000"))
    check("VTT header", toVtt(project).startsWith("WEBVTT"))
    check("VTT inline word tags", toVtt(project).contains("<00:00:01.600>world"))
    check("ASS karaoke", toAss(project).contains("{\\kf60}"))
    check("ASS event", toAss(project).contains("Dialogue: 0,0:00:01.00,0:00:03.00"))
    eq("plain text", "Hello world\nSecond line", toPlainText(project))
    check("timed JSON unit", Json.parse(serialiseSubtitle(project, SubtitleFormat.JSON)).string("timeUnit") == "microseconds")
    check("offset not baked in", toLrc(project, SubtitleOptions(offsetUs = 500_000)).contains("[00:01.50]") &&
        project.lyrics.lines[0].start == 1_000_000L)
    check("safe filename", suggestedFileName(project, ".mp4").endsWith(".mp4") && !suggestedFileName(project, ".mp4").contains("/"))

    section("Project codec: strict validation & roundtrip")
    val encoded = encodeProjectString(project)
    val decoded = parseProjectString(encoded)
    eq("id", project.id, decoded.id)
    eq("lines", project.lyrics.lines.size, decoded.lyrics.lines.size)
    eq("words", 2, decoded.lyrics.lines[0].words.size)
    eq("timing source", TimingSource.HUMAN, decoded.lyrics.lines[0].words[0].source)
    eq("theme", project.design.themeId, decoded.design.themeId)
    eq("aspect", project.design.aspectId, decoded.design.aspectId)
    val projectFile = buildProjectFile(project, listOf(AssetRecord("a1", "audio", "song.m4a", "audio/mp4", 1234, "hash", 1)))
    val fileText = serialiseProjectFile(projectFile)
    val restored = parseProjectFile(fileText)
    eq("project file kind", "vidlyrics.project", restored.kind)
    eq("asset manifest", 1, restored.assets.size)
    check("future format refused", run {
        try { parseProjectFile("""{"kind":"vidlyrics.project","formatVersion":999,"project":{"formatVersion":999}}"""); false }
        catch (_: ProjectValidationException) { true }
    })
    check("hostile values clamped", try {
        val hostile = Json.parse("""{"formatVersion":1,"id":"p","lyrics":{"lines":[{"text":"x","start":-5,"end":9,"confidence":99,"words":[]}]}}""")
        val p = decodeProject(hostile); p.lyrics.lines[0].start >= 0 && p.lyrics.lines[0].confidence <= 1.0
    } catch (_: ProjectValidationException) { true })
    check("unknown keys stripped", try {
        val withExtra = Json.parse("""{"formatVersion":1,"id":"p","evilCommand":"rm -rf /","lyrics":{"lines":[]}}""")
        decodeProject(withExtra).id == "p"
    } catch (_: ProjectValidationException) { false })
    check("web v2 project accepted", parseProjectString(encoded).formatVersion == 2)

    section("Render frame state: determinism & safe areas")
    val measure: MeasureFn = { size, _, _ -> approximateMeasurer(size) }
    val sceneProject = project.copy(lyrics = project.lyrics.copy(lines = listOf(
        createLine("A line of lyrics that is fairly long and must wrap safely inside the box").copy(
            start = 1_000_000, end = 4_000_000,
            words = highlightTokens("A line of lyrics that is fairly long").mapIndexed { i, tk ->
                Word("w$i", tk.text, tk.text, 1_000_000 + i * 100_000L, 1_100_000 + i * 100_000L, 0.8, TimingSource.ALIGN, false)
            }))))
    for (aspect in AspectId.entries) {
        val p = sceneProject.copy(design = sceneProject.design.copy(aspectId = aspect))
        val scene = buildScene(p)
        val state = computeFrameState(scene, 2_000_000, measure)
        check("$aspect frame has line", state.lines.isNotEmpty())
        val rows = state.lines.flatMap { it.rows }
        check("$aspect rows inside safe area", rows.all { r ->
            r.originX >= scene.box.left - 1 && r.originX + r.widthPx <= scene.box.right + 1
        })
    }
    val baseScene = buildScene(sceneProject)
    val a = computeFrameState(baseScene, 2_000_000, measure)
    val b = computeFrameState(baseScene, 2_000_000, measure)
    eq("deterministic state", Json.stringify(jObj("lines" to jNum(a.lines.size), "fill" to jNum(a.lines[0].rows[0].tokens[0].fill))),
        Json.stringify(jObj("lines" to jNum(b.lines.size), "fill" to jNum(b.lines[0].rows[0].tokens[0].fill))))
    check("progressive fill advances", computeFrameState(baseScene, 1_050_000, measure).lines[0].rows[0].tokens[0].fill <
        computeFrameState(baseScene, 1_150_000, measure).lines[0].rows[0].tokens[0].fill)
    val introProject = sceneProject.copy(design = sceneProject.design.copy(intro = CardSpec(true, "Title", "Artist", 3_000_000)))
    val introScene = buildScene(introProject)
    check("intro card present", computeFrameState(introScene, 1_000_000, measure).card?.isIntro == true)
    check("no lyric during intro", computeFrameState(introScene, 0, measure).lines.isEmpty())
    check("global offset not baked in", buildScene(sceneProject, BuildSceneOptions(offsetUs = 500_000)).lines[0].start ==
        baseScene.lines[0].start + 500_000)

    section("Resampling & CTC decoding")
    val short = FloatArray(100) { it.toFloat() }
    eq("resample same rate", 100, resampleLinear(short, 100, 16000, 16000).size)
    near("resample 44.1k→16k length", 36.0, resampleLinear(short, 100, 44100, 16000).size.toDouble(), 2.0)
    val streaming = Resampler(44100, 16000)
    var total = 0
    for (chunk in short.toList().chunked(16)) total += streaming.push(chunk.toFloatArray()).size
    check("streaming resampler produces output", total > 20)
    // vocab: blank=0, a=1, space=2, b=3. Frames: a, a(blank collapse), space, b.
    val frames = 6; val vocabSize = 4
    val logits = FloatArray(frames * vocabSize)
    fun set(f: Int, v: Int) { logits[f * vocabSize + v] = 5f }
    set(0, 1); set(1, 1); set(2, 0); set(3, 2); set(4, 3); set(5, 3)
    val tokens = ctcGreedyDecode(logits, frames, vocabSize, 0, listOf("", "a", " ", "b"))
    eq("CTC blank/repeat collapse", 3, tokens.size)
    val words = transcriptWords(tokens, 20_000)
    eq("CTC words", 2, words.size)
    eq("CTC first word", "a", words[0].text)
    eq("CTC word timing", 0L, words[0].start)
    check("CTC second word starts later", words[1].start > words[0].end)

    section("Export planner")
    val settings = ExportSettings(rangeEndUs = 180_000_000)
    check("valid settings", validateExportSettings(settings).isEmpty())
    check("odd dimensions rejected", validateExportSettings(settings.copy(width = 1921)).any { it.contains("even") })
    check("empty range rejected", validateExportSettings(settings.copy(rangeEndUs = 0)).any { it.contains("range") })
    eq("frames for 180s@30", 5400L, frameCount(settings))
    check("size estimate", estimateOutputBytes(settings) > 100_000_000)
    check("eta estimate", estimateRender(settings).etaSeconds > 0)
    eq("codec mime", "video/avc", codecMime(CodecId.H264))

    println("\n---------------------------------------------")
    println("RESULT: ${checks - failures}/$checks checks passed in group '$group'")
    if (failures > 0) {
        println("$failures FAILURE(S)")
        kotlin.system.exitProcess(1)
    } else println("ALL CORE CHECKS PASSED")
}
