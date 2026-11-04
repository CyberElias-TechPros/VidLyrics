package com.vidlyrics.core

/**
 * The render scene: an immutable, platform-independent description of ONE
 * composition. Built once per preview/export from a Project. The global offset
 * is applied here, at render time, and NEVER written back into stored timings —
 * moving the slider stays reversible.
 */
data class SceneWord(val text: String, val start: Microseconds, val end: Microseconds)

data class SceneLine(
    val id: String, val text: String, val words: List<SceneWord>,
    val start: Microseconds, val end: Microseconds,
    val speaker: String?, val translation: String?, val locked: Boolean,
    val minConfidence: Double, val style: LineStyle
)

data class Scene(
    val width: Int, val height: Int, val fps: Int,
    val durationUs: Microseconds, val box: CompositionBox, val design: Design,
    val lines: List<SceneLine>, val offsetUs: Microseconds,
    val spectrum: SpectrumEnvelope?, val beatGrid: BeatGrid?,
    val introUs: Microseconds, val outroUs: Microseconds
)

data class BuildSceneOptions(
    val durationUs: Microseconds? = null,
    val offsetUs: Microseconds? = null,
    val width: Int? = null, val height: Int? = null,
    val fps: Int? = null,
    val spectrum: SpectrumEnvelope? = null,
    val beatGrid: BeatGrid? = null
)

private fun usableWords(line: Line): List<SceneWord> {
    if (line.words.isNotEmpty()) return line.words.map { SceneWord(it.text, it.start, it.end) }
    val tokens = highlightTokens(line.text)
    val span = maxOf(1L, line.end - line.start)
    return tokens.mapIndexed { i, t ->
        SceneWord(t.text, line.start + Math.round(span * i.toDouble() / tokens.size),
            line.start + Math.round(span * (i + 1).toDouble() / tokens.size))
    }
}

fun buildScene(project: Project, options: BuildSceneOptions = BuildSceneOptions()): Scene {
    val (defaultW, defaultH) = compositionSize(project.design)
    val width = options.width ?: defaultW
    val height = options.height ?: defaultH
    val box = contentBox(width, height, project.design)
    val audioDuration = project.audio?.durationUs ?: 0
    val lastLineEnd = project.lyrics.lines.maxOfOrNull { it.end } ?: 0
    val tail = maxOf(audioDuration, lastLineEnd)
    val introUs = if (project.design.intro.enabled) project.design.intro.durationUs else 0
    val outroUs = if (project.design.outro.enabled) project.design.outro.durationUs else 0
    val durationUs = options.durationUs ?: maxOf(tail, introUs + outroUs)
    val offsetUs = options.offsetUs ?: project.export.globalOffsetUs
    val lines = project.lyrics.lines
        .filter { it.text.trim().isNotEmpty() }
        .map { l ->
            SceneLine(
                id = l.id, text = l.text, words = usableWords(l),
                // Intro/outro cards extend the COMPOSITION timeline, they do not
                // move the lyrics. `toMusicTime()` removes introUs from the frame
                // clock; adding it to line starts as well would double-shift every
                // line and desynchronise karaoke (a bug in the original web build).
                start = maxOf(0, l.start + offsetUs),
                end = maxOf(0, l.end + offsetUs),
                speaker = l.speaker, translation = l.translation, locked = l.locked,
                minConfidence = if (l.words.isNotEmpty()) l.words.minOf { it.confidence }
                else if (l.source == TimingSource.HUMAN || l.source == TimingSource.TAP) 1.0 else 0.3,
                style = l.style)
        }
        .sortedWith(compareBy<SceneLine> { it.start }.thenBy { it.id })
    return Scene(evenize(width), evenize(height), options.fps ?: project.export.fps,
        durationUs, box, project.design, lines, offsetUs,
        options.spectrum, options.beatGrid, introUs, outroUs)
}

fun toMusicTime(scene: Scene, timeUs: Microseconds): Microseconds = maxOf(0, timeUs - scene.introUs)

fun totalDuration(scene: Scene): Microseconds = scene.durationUs + scene.introUs + scene.outroUs

/** Binary search: timelines can hold thousands of lines. */
fun activeLineIndex(scene: Scene, musicTimeUs: Microseconds): Int {
    val lines = scene.lines
    if (lines.isEmpty()) return -1
    var low = 0; var high = lines.lastIndex; var candidate = -1
    while (low <= high) {
        val mid = (low + high) ushr 1
        if (lines[mid].start <= musicTimeUs) { candidate = mid; low = mid + 1 }
        else high = mid - 1
    }
    return candidate
}
