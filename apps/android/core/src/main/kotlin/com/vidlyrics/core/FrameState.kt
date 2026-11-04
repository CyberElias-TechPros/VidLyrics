package com.vidlyrics.core

import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Frame computation — PURE.
 *
 * computeFrameState(scene, timeUs, measure) produces every number that decides
 * what appears on screen. The Android FramePainter does nothing but paint this
 * state with Canvas. Preview and offline export call the SAME function, so
 * WYSIWYG is structural, and the whole visual result is unit-testable on a JVM.
 *
 * Determinism contract: no wall clock, no random, no platform text metrics
 * beyond the injected Measurer. A frame is a pure function of (scene, timeUs).
 */
enum class WordFillState { UPCOMING, ACTIVE, DONE }

data class WordFrame(
    val text: String, val fill: Float, val state: WordFillState,
    val widthPx: Float, val glow: Float, val scale: Float
)

data class RowFrame(val tokens: List<WordFrame>, val widthPx: Float, val originX: Float, val baselineY: Float)

data class TranslationFrame(val text: String, val opacity: Float, val fontSizePx: Float)

data class LineFrame(
    val id: String, val rows: List<RowFrame>, val opacity: Float,
    val translateX: Float, val translateY: Float, val scale: Float,
    val blurPx: Float, val clipWipe: Float, val isCurrent: Boolean,
    val fontSizePx: Float, val lineHeightPx: Float, val letterSpacingPx: Float,
    val weight: Int, val color: String, val activeColor: String, val uppercase: Boolean,
    val align: TextAlign, val outlineWidth: Float, val outlineColor: String,
    val shadowBlur: Float, val shadowColor: String, val shadowOffsetY: Float,
    val glow: Float, val translation: TranslationFrame?, val minConfidence: Double
)

data class GradientStop(val offset: Float, val color: String)
data class MeshBlob(val x: Float, val y: Float, val radius: Float, val color: String)
data class ImageFrame(val assetId: String?, val scale: Float, val translateX: Float, val translateY: Float)

data class BackgroundFrame(
    val kind: BackgroundKind, val stops: List<GradientStop>, val angle: Float,
    val blobs: List<MeshBlob>, val scrim: Float, val image: ImageFrame,
    val bands: List<Float>, val pulse: Float
)

data class CardFrame(val title: String, val subtitle: String, val opacity: Float, val scale: Float, val isIntro: Boolean)
data class BrandFrame(val text: String, val opacity: Float, val position: BrandPosition)
data class GuidesFrame(val x: Float, val y: Float, val width: Float, val height: Float)

data class FrameState(
    val timeUs: Microseconds, val musicTimeUs: Microseconds,
    val width: Int, val height: Int, val progress: Float,
    val background: BackgroundFrame, val lines: List<LineFrame>,
    val card: CardFrame?, val brand: BrandFrame?, val guides: GuidesFrame,
    val showGuides: Boolean, val showHeat: Boolean
)

data class ComputeOptions(val showGuides: Boolean = false, val showHeat: Boolean = false)

private const val MIN_WORD_DURATION_US = 120_000L

private fun wordFill(mode: KaraokeMode, timeUs: Microseconds, wordStart: Microseconds,
                     wordEnd: Microseconds, lineStart: Microseconds, lineEnd: Microseconds,
                     lineProgress: Float): Pair<Float, WordFillState> = when (mode) {
    KaraokeMode.NONE -> Pair(1f, WordFillState.ACTIVE)
    KaraokeMode.LINE -> Pair(lineProgress, if (timeUs >= lineEnd) WordFillState.DONE
        else if (timeUs >= lineStart) WordFillState.ACTIVE else WordFillState.UPCOMING)
    KaraokeMode.WORD -> when {
        timeUs >= wordEnd -> Pair(1f, WordFillState.DONE)
        timeUs >= wordStart -> Pair(1f, WordFillState.ACTIVE)
        else -> Pair(0f, WordFillState.UPCOMING)
    }
    KaraokeMode.PROGRESSIVE -> {
        val duration = max(MIN_WORD_DURATION_US, wordEnd - wordStart)
        val fill = clamp01((timeUs - wordStart).toFloat() / duration)
        Pair(fill, if (fill >= 1f) WordFillState.DONE else if (fill > 0f) WordFillState.ACTIVE else WordFillState.UPCOMING)
    }
}

private data class Transition(
    val opacity: Float, val translateX: Float, val translateY: Float,
    val blurPx: Float, val clipWipe: Float
)

private fun transition(enter: MotionEnter, exit: MotionExit, enterProgress: Float,
                       exitProgress: Float, fontSizePx: Float, intensity: Double): Transition {
    val e = easeOutCubic(enterProgress.toDouble()).toFloat()
    val x = easeInOutCubic(exitProgress.toDouble()).toFloat()
    var opacity = e * (1 - x)
    var translateY = 0f
    var blur = 0f
    var clipWipe = 1f
    when (enter) {
        MotionEnter.FADE -> Unit
        MotionEnter.RISE, MotionEnter.WORD_CASCADE ->
            translateY += (1 - e) * fontSizePx * (if (enter == MotionEnter.RISE) 0.55f else 0.3f) * intensity.toFloat()
        MotionEnter.CLIP -> { clipWipe = e; opacity = min(1f, e * 2) }
        MotionEnter.BLUR -> blur += (1 - e) * fontSizePx * 0.28f * intensity.toFloat()
        MotionEnter.NONE -> opacity = if (enterProgress >= 1f) 1f else 0f
    }
    when (exit) {
        MotionExit.FADE, MotionExit.NONE -> if (exit == MotionExit.NONE) opacity = if (exitProgress > 0) 0f else opacity
        MotionExit.SINK -> translateY += x * fontSizePx * 0.45f * intensity.toFloat()
        MotionExit.BLUR -> blur += x * fontSizePx * 0.3f * intensity.toFloat()
    }
    return Transition(clamp01(opacity), 0f, translateY, blur, clipWipe)
}

private fun computeBackground(scene: Scene, musicTimeUs: Microseconds): BackgroundFrame {
    val bg = scene.design.background
    val seconds = musicTimeUs / 1_000_000.0
    val bands = ArrayList<Float>(BAND_COUNT)
    var pulse = 0f
    if (scene.spectrum != null && (bg.kind == BackgroundKind.VISUALIZER || bg.visualizerGain > 0)) {
        for (v in bandsAt(scene.spectrum, musicTimeUs)) bands += min(1f, v / 255f)
        pulse = min(1f, energyAt(scene.spectrum, musicTimeUs, bg.visualizerBand).toFloat())
    }
    val drift = bg.motion * seconds
    val stops = bg.colors.mapIndexed { i, c -> GradientStop(clamp01(i.toFloat() / max(1, bg.colors.size - 1)), c) }
    val blobs = if (bg.kind == BackgroundKind.MESH) bg.colors.mapIndexed { i, c ->
        MeshBlob(
            (0.25 + 0.5 * smoothNoise(drift * 0.35 + i * 3.1, i)).toFloat(),
            (0.3 + 0.4 * smoothNoise(drift * 0.28 + i * 7.7, i + 10)).toFloat(),
            (0.35 + 0.2 * (0.5 + 0.5 * smoothNoise(drift * 0.2 + i * 5.3, i + 20)) + pulse * 0.08).toFloat(), c)
    } else emptyList()
    return BackgroundFrame(
        kind = bg.kind, stops = stops,
        angle = (PI * 0.5 + 0.25 * sin(drift * 0.12)).toFloat(),
        blobs = blobs, scrim = bg.scrim.toFloat(),
        image = ImageFrame(bg.assetId, (1 + bg.motion * 0.12 + pulse * 0.03).toFloat(),
            (bg.motion * 0.04 * smoothNoise(drift * 0.2, 1)).toFloat(),
            (bg.motion * 0.04 * smoothNoise(drift * 0.17, 2)).toFloat()),
        bands = bands, pulse = pulse)
}

private fun computeCard(scene: Scene, timeUs: Microseconds): CardFrame? {
    val design = scene.design
    if (design.intro.enabled && timeUs < scene.introUs) {
        val t = clamp01(timeUs.toFloat() / max(1f, scene.introUs.toFloat()))
        val fade = if (t < 0.15f) t / 0.15f else if (t > 0.85f) (1 - t) / 0.15f else 1f
        return CardFrame(design.intro.title, design.intro.subtitle, clamp01(fade),
            (1 + (1 - easeOutCubic(min(1.0, t * 4.0))) * 0.04).toFloat(), true)
    }
    val outroStart = scene.introUs + scene.durationUs
    if (design.outro.enabled && timeUs >= outroStart) {
        val t = clamp01((timeUs - outroStart).toFloat() / max(1f, scene.outroUs.toFloat()))
        val fade = if (t < 0.15f) t / 0.15f else if (t > 0.85f) (1 - t) / 0.15f else 1f
        return CardFrame(design.outro.title, design.outro.subtitle, clamp01(fade), 1f, false)
    }
    return null
}

private fun buildLineFrame(scene: Scene, index: Int, musicTimeUs: Microseconds,
                           measure: MeasureFn, box: CompositionBox, isCurrent: Boolean): LineFrame {
    val line = scene.lines[index]
    val t = scene.design.typography
    val karaoke = scene.design.karaoke
    val motion = scene.design.motion
    val style = line.style
    val fontSizePx = Math.round((style.sizeRatio ?: t.sizeRatio) * scene.height).toFloat()
    val lineHeightPx = fontSizePx * t.lineHeight.toFloat()
    val letterSpacingPx = (t.letterSpacing * fontSizePx).toFloat()
    val weight = style.weight ?: t.weight
    val uppercase = style.uppercase ?: t.uppercase
    val align = style.align ?: t.align

    val enterProgress = if (motion.enterUs > 0)
        clamp01((musicTimeUs - (line.start - motion.enterUs)).toFloat() / motion.enterUs) else 1f
    val exitProgress = if (motion.exitUs > 0)
        clamp01((musicTimeUs - line.end).toFloat() / motion.exitUs) else 0f
    val trans = transition(motion.enter, motion.exit, enterProgress, exitProgress, fontSizePx, motion.intensity)

    val rawWords = line.words
    val tokens = tokensFromWords(rawWords.map { it.text })
    val measurer = measure(fontSizePx, weight, letterSpacingPx)
    val layout = layoutWords(tokens, measurer,
        LayoutOptions(fontSizePx, lineHeightPx, box.width, letterSpacingPx, uppercase))
    val lineProgress = clamp01((musicTimeUs - line.start).toFloat() / max(1f, (line.end - line.start).toFloat()))
    val beatTolerance = Math.round((scene.beatGrid?.intervalUs ?: 500_000L) * 0.18)

    val rows = layout.rows.mapIndexed { rowIndex, row ->
        val wordFrames = row.tokens.map { token ->
            val source = rawWords.getOrNull(token.wordIndex)
            val wStart = source?.start ?: line.start
            val wEnd = source?.end ?: line.end
            val (fill, state) = wordFill(karaoke.mode, musicTimeUs, wStart, wEnd, line.start, line.end, lineProgress)
            var glow = 0f
            var scale = 1f
            if (karaoke.glow > 0 && state != WordFillState.UPCOMING) {
                val base = karaoke.glow * (if (state == WordFillState.ACTIVE) 1.0 else 0.45)
                val beat = if (karaoke.beatAware) beatStrength(scene.beatGrid, musicTimeUs, beatTolerance) else 0.0
                glow = min(2f, (base * (1 + beat * 0.6)).toFloat())
            }
            if (karaoke.scale != 1.0 && state == WordFillState.ACTIVE) {
                val activate = clamp01((musicTimeUs - wStart).toDouble() / max(1L, min(160_000, wEnd - wStart)))
                scale = (1 + (karaoke.scale - 1) * easeOutBack(activate) * (1 - activate * 0.6)).toFloat()
            }
            WordFrame(token.text, if (karaoke.fillEase == FillEase.SMOOTH && karaoke.mode == KaraokeMode.PROGRESSIVE)
                easeInOutCubic(fill.toDouble()).toFloat() else fill, state, token.widthPx, glow, scale)
        }
        RowFrame(wordFrames, row.widthPx, rowOriginX(row, box.left, box.width, align), 0f)
    }
    val blockTop = blockAnchorY(layout.heightPx, box.top, box.height, t.anchor)
    val withBaselines = rows.mapIndexed { i, row ->
        row.copy(baselineY = blockTop + i * lineHeightPx + fontSizePx * 0.82f)
    }
    val translationText = line.translation?.trim()?.takeIf { it.isNotEmpty() }
    return LineFrame(
        id = line.id, rows = withBaselines, opacity = trans.opacity,
        translateX = trans.translateX + if (line.speaker == "B") fontSizePx * 0.6f else 0f,
        translateY = trans.translateY, scale = 1f, blurPx = trans.blurPx,
        clipWipe = trans.clipWipe, isCurrent = isCurrent,
        fontSizePx = fontSizePx, lineHeightPx = lineHeightPx, letterSpacingPx = letterSpacingPx,
        weight = weight, color = style.color ?: t.color, activeColor = t.activeColor,
        uppercase = uppercase, align = align,
        outlineWidth = (t.outlineWidth * scene.height / 1080.0).toFloat(),
        outlineColor = t.outlineColor,
        shadowBlur = (t.shadowBlur * scene.height / 1080.0).toFloat(),
        shadowColor = t.shadowColor,
        shadowOffsetY = (t.shadowOffsetY * scene.height / 1080.0).toFloat(),
        glow = karaoke.glow.toFloat(),
        translation = translationText?.let { TranslationFrame(it, trans.opacity * 0.85f, Math.round(fontSizePx * 0.42f).toFloat()) },
        minConfidence = line.minConfidence)
}

/** Resolve vertical collisions during cross-fades. */
private fun separateOverlapping(lines: List<LineFrame>): List<LineFrame> {
    val out = lines.toMutableList()
    for (i in 1 until out.size) {
        val previous = out[i - 1]
        val current = out[i]
        if (!previous.isCurrent && !current.isCurrent) continue
        val prevBottom = previous.rows.lastOrNull()?.baselineY ?: 0f
        val curTop = (current.rows.firstOrNull()?.baselineY ?: 0f) - current.fontSizePx
        if (curTop < prevBottom && previous.isCurrent != current.isCurrent) {
            val shift = if (current.isCurrent) prevBottom - curTop + current.fontSizePx * 0.3f else 0f
            out[i] = current.copy(translateY = current.translateY - shift)
        }
    }
    return out
}

fun computeFrameState(scene: Scene, timeUs: Microseconds, measure: MeasureFn,
                      options: ComputeOptions = ComputeOptions()): FrameState {
    val musicTimeUs = toMusicTime(scene, timeUs)
    val motion = scene.design.motion
    val total = max(1L, totalDuration(scene))
    val background = computeBackground(scene, musicTimeUs)
    val card = computeCard(scene, timeUs)
    val visible = ArrayList<Int>()
    for (i in scene.lines.indices) {
        val line = scene.lines[i]
        if (line.end + max(motion.overlapUs, motion.exitUs) < musicTimeUs) continue
        if (line.start - motion.enterUs > musicTimeUs) break
        visible += i
    }
    val currentIndex = activeLineIndex(scene, musicTimeUs)
    val lines = separateOverlapping(visible.map { i ->
        buildLineFrame(scene, i, musicTimeUs, measure, scene.box, currentIndex == i)
    })
    val brand = if (scene.design.brand.enabled && scene.design.brand.text.isNotEmpty())
        BrandFrame(scene.design.brand.text, scene.design.brand.opacity.toFloat(), scene.design.brand.position)
    else null
    return FrameState(
        timeUs = timeUs, musicTimeUs = musicTimeUs, width = scene.width, height = scene.height,
        progress = clamp01(timeUs.toFloat() / total), background = background, lines = lines,
        card = card, brand = brand,
        guides = GuidesFrame(scene.box.left, scene.box.top, scene.box.width, scene.box.height),
        showGuides = options.showGuides, showHeat = options.showHeat)
}
