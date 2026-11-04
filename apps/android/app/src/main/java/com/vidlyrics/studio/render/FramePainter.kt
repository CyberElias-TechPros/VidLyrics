package com.vidlyrics.studio.render

import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import com.vidlyrics.core.*
import kotlin.math.max
import kotlin.math.min

/**
 * The ONE rasteriser in the app. Compose preview and MediaCodec export both
 * call draw() with the same FrameState produced by computeFrameState(). There
 * is intentionally no second "fast preview" renderer: a second renderer always
 * diverges, and the user notices it only after a 20-minute export.
 */
class FramePainter(private val assets: AssetProvider) {

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = Color.argb(150, 255, 209, 102)
        pathEffect = DashPathEffect(floatArrayOf(14f, 10f), 0f)
    }
    private val imageMatrix = Matrix()

    fun draw(canvas: Canvas, state: FrameState, scene: Scene, project: Project) {
        canvas.drawColor(Color.BLACK)
        paintBackground(canvas, state, scene, project)
        for (line in state.lines) paintLine(canvas, line, state, scene)
        state.card?.let { paintCard(canvas, it, state, scene) }
        state.brand?.let { paintBrand(canvas, it, state) }
        if (state.showGuides) paintGuides(canvas, state)
    }

    /* ---------------------------- background ---------------------------- */

    private fun paintBackground(canvas: Canvas, state: FrameState, scene: Scene, project: Project) {
        val w = scene.width.toFloat(); val h = scene.height.toFloat()
        val bg = state.background
        val stops = bg.stops
        val colors = if (stops.isEmpty()) intArrayOf(Color.BLACK) else stops.map { color(it.color) }.toIntArray()
        val positions = if (stops.isEmpty()) floatArrayOf(0f, 1f) else stops.map { it.offset }.toFloatArray()

        when {
            bg.kind == BackgroundKind.IMAGE && assets.background(project) != null -> {
                paintImage(canvas, state, scene, project, w, h)
            }
            bg.kind == BackgroundKind.MESH -> {
                fillPaint.reset(); fillPaint.color = colors.firstOrNull() ?: Color.BLACK
                canvas.drawRect(0f, 0f, w, h, fillPaint)
                for (blob in bg.blobs) {
                    val radius = max(1f, blob.radius * max(w, h))
                    val cx = blob.x * w; val cy = blob.y * h
                    val c = color(blob.color)
                    fillPaint.reset()
                    // Single-centre constructor with int[] colours: available on
                    // every supported API (the two-centre variant needs 31+).
                    fillPaint.shader = RadialGradient(cx, cy, radius,
                        intArrayOf(withAlpha(c, 0.72f), withAlpha(c, 0f)),
                        floatArrayOf(0f, 1f), Shader.TileMode.CLAMP)
                    canvas.drawRect(0f, 0f, w, h, fillPaint)
                }
                fillPaint.shader = null
            }
            bg.kind == BackgroundKind.SOLID || colors.size == 1 -> {
                fillPaint.reset(); fillPaint.color = colors.firstOrNull() ?: Color.BLACK
                canvas.drawRect(0f, 0f, w, h, fillPaint)
            }
            else -> {
                val cx = w / 2; val cy = h / 2; val len = max(w, h)
                val dx = kotlin.math.cos(bg.angle) * len / 2
                val dy = kotlin.math.sin(bg.angle) * len / 2
                fillPaint.reset()
                fillPaint.shader = LinearGradient(cx - dx, cy - dy, cx + dx, cy + dy,
                    colors, positions, Shader.TileMode.CLAMP)
                canvas.drawRect(0f, 0f, w, h, fillPaint)
                fillPaint.shader = null
            }
        }

        if (bg.bands.isNotEmpty() && scene.design.background.visualizerGain > 0) {
            paintVisualizer(canvas, bg, scene, w, h)
        }
        if (bg.scrim > 0f) {
            fillPaint.reset()
            fillPaint.shader = LinearGradient(0f, 0f, 0f, h,
                intArrayOf(Color.argb((bg.scrim * 0.5f * 255).toInt().coerceIn(0, 255), 0, 0, 0),
                    Color.argb((bg.scrim * 255).toInt().coerceIn(0, 255), 0, 0, 0)),
                floatArrayOf(0f, 1f), Shader.TileMode.CLAMP)
            canvas.drawRect(0f, 0f, w, h, fillPaint)
            fillPaint.shader = null
        }
    }

    private fun paintImage(canvas: Canvas, state: FrameState, scene: Scene, project: Project, w: Float, h: Float) {
        val bitmap = assets.background(project) ?: return
        val image = state.background.image
        val base = max(w / bitmap.width, h / bitmap.height)
        val scale = base * image.scale
        imageMatrix.reset()
        imageMatrix.setScale(scale, scale)
        val dx = (w - bitmap.width * scale) / 2 + image.translateX * w
        val dy = (h - bitmap.height * scale) / 2 + image.translateY * h
        imageMatrix.postTranslate(dx, dy)
        fillPaint.reset(); fillPaint.isAntiAlias = true; fillPaint.isFilterBitmap = true
        canvas.drawBitmap(bitmap, imageMatrix, fillPaint)
    }

    private fun paintVisualizer(canvas: Canvas, bg: BackgroundFrame, scene: Scene, w: Float, h: Float) {
        val gain = scene.design.background.visualizerGain.toFloat()
        val count = bg.bands.size
        val barWidth = w / count
        val accent = color(scene.design.typography.activeColor)
        barPaint.reset(); barPaint.isAntiAlias = true
        for (i in 0 until count) {
            val value = min(1f, bg.bands[i] * gain)
            val barHeight = value * h * 0.32f
            barPaint.color = withAlpha(accent, 0.25f + 0.45f * value)
            canvas.drawRect(i * barWidth + barWidth * 0.15f, h - barHeight,
                (i + 1) * barWidth - barWidth * 0.15f, h, barPaint)
        }
    }

    /* ------------------------------- lines ------------------------------- */

    private fun paintLine(canvas: Canvas, line: LineFrame, state: FrameState, scene: Scene) {
        if (line.opacity <= 0.001f || line.rows.isEmpty()) return
        canvas.save()
        canvas.translate(line.translateX, line.translateY)
        if (line.clipWipe < 0.999f) {
            val firstY = (line.rows.firstOrNull()?.baselineY ?: 0f) - line.fontSizePx * 1.3f
            val lastY = (line.rows.lastOrNull()?.baselineY ?: 0f) + line.fontSizePx * 0.6f
            canvas.clipRect(0f, firstY, state.width * line.clipWipe, lastY)
        }

        val alpha = (line.opacity * 255).toInt().coerceIn(0, 255)
        val baseColor = color(line.color)
        val activeColor = color(line.activeColor)
        val outlineColor = color(line.outlineColor)
        val shadowColor = color(line.shadowColor)

        for (row in line.rows) {
            var x = row.originX
            for (token in row.tokens) {
                canvas.save()
                canvas.translate(x, row.baselineY)
                if (token.scale != 1f) {
                    canvas.scale(token.scale, token.scale, token.widthPx / 2, -line.fontSizePx / 2)
                }
                // Base glyph.
                configureText(line, baseColor, alpha, outline = false,
                    shadowColor = shadowColor)
                if (line.outlineWidth > 0f) {
                    configureText(line, outlineColor, alpha, outline = true, shadowColor = shadowColor)
                    textPaint.strokeWidth = line.outlineWidth * 2f
                    canvas.drawText(token.text, 0f, 0f, textPaint)
                }
                configureText(line, baseColor, alpha, outline = false, shadowColor = shadowColor)
                canvas.drawText(token.text, 0f, 0f, textPaint)

                // Karaoke fill: clip a horizontal sweep inside the word box.
                if (token.fill > 0f) {
                    canvas.save()
                    val fillWidth = token.widthPx * when (scene.design.karaoke.fillEase) {
                        FillEase.SMOOTH -> easeInOutCubic(token.fill.toDouble()).toFloat()
                        FillEase.LINEAR -> token.fill
                    }
                    canvas.clipRect(0f, -line.fontSizePx * 1.3f, fillWidth, line.fontSizePx * 0.6f)
                    configureText(line, activeColor, alpha, outline = false, shadowColor = shadowColor,
                        glow = token.glow)
                    canvas.drawText(token.text, 0f, 0f, textPaint)
                    if (line.outlineWidth > 0f) {
                        configureText(line, outlineColor, alpha, outline = true, shadowColor = shadowColor)
                        textPaint.strokeWidth = line.outlineWidth * 2f
                        canvas.drawText(token.text, 0f, 0f, textPaint)
                    }
                    canvas.restore()
                }
                canvas.restore()
                x += token.widthPx
            }
        }

        // Confidence heat: a discreet marker, editor-only, never in the video.
        if (state.showHeat && line.minConfidence < 0.55) {
            val y = (line.rows.firstOrNull()?.baselineY ?: 0f) - line.fontSizePx
            fillPaint.reset()
            fillPaint.color = Color.argb(190, 255, 138, 92)
            canvas.drawRect(max(0f, scene.box.left - 12f), y, max(0f, scene.box.left - 6f),
                y + line.fontSizePx * 0.8f, fillPaint)
        }

        // Translation / romanisation companion line beneath the lyrics.
        line.translation?.let { tr ->
            val bottom = (line.rows.lastOrNull()?.baselineY ?: 0f) + line.fontSizePx * 0.95f
            configureText(line, baseColor, (tr.opacity * 255).toInt().coerceIn(0, 255),
                outline = false, shadowColor = shadowColor)
            textPaint.textSize = tr.fontSizePx
            textPaint.isFakeBoldText = false
            val width = textPaint.measureText(tr.text)
            val x = when (line.align) {
                TextAlign.LEFT -> scene.box.left
                TextAlign.RIGHT -> scene.box.right - width
                TextAlign.CENTER -> scene.box.left + (scene.box.width - width) / 2
            }
            canvas.drawText(tr.text, x, bottom, textPaint)
        }
        canvas.restore()
    }

    private fun configureText(line: LineFrame, color: Int, alpha: Int, outline: Boolean,
                              shadowColor: Int, glow: Float = 0f) {
        textPaint.reset()
        textPaint.isAntiAlias = true
        textPaint.isSubpixelText = true
        textPaint.textSize = line.fontSizePx
        textPaint.typeface = AndroidTextMeasurer.typefaceFor("sans-serif", line.weight)
        textPaint.letterSpacing = if (line.fontSizePx > 0) line.letterSpacingPx / line.fontSizePx else 0f
        textPaint.style = if (outline) Paint.Style.STROKE else Paint.Style.FILL
        textPaint.strokeWidth = if (outline) max(1f, line.outlineWidth) else 0f
        textPaint.color = color
        textPaint.alpha = alpha
        if (!outline && (line.shadowBlur > 0f || glow > 0f)) {
            val radius = line.shadowBlur * 0.5f + glow * line.fontSizePx * 0.22f
            textPaint.setShadowLayer(radius, 0f, line.shadowOffsetY,
                if (glow > 0f) Color.argb((min(1f, 0.35f + glow * 0.3f) * 255).toInt(),
                    Color.red(color), Color.green(color), Color.blue(color)) else shadowColor)
        }
        if (!outline && glow > 0.6f) {
            textPaint.maskFilter = BlurMaskFilter(glow * line.fontSizePx * 0.06f, BlurMaskFilter.Blur.NORMAL)
        } else textPaint.maskFilter = null
    }

    /* --------------------------- cards / brand --------------------------- */

    private fun paintCard(canvas: Canvas, card: CardFrame, state: FrameState, scene: Scene) {
        val w = state.width.toFloat(); val h = state.height.toFloat()
        val alpha = (card.opacity * 255).toInt().coerceIn(0, 255)
        canvas.save()
        canvas.scale(card.scale, card.scale, w / 2, h / 2)
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = h * 0.062f
            typeface = AndroidTextMeasurer.typefaceFor("sans-serif", 800)
            color = color(scene.design.typography.activeColor)
            this.alpha = alpha
            textAlign = Paint.Align.CENTER
        }
        val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = h * 0.028f
            typeface = AndroidTextMeasurer.typefaceFor("sans-serif", 400)
            color = color(scene.design.typography.color)
            this.alpha = alpha
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText(card.title, w / 2, h * 0.46f, titlePaint)
        if (card.subtitle.isNotEmpty()) canvas.drawText(card.subtitle, w / 2, h * 0.53f, subPaint)
        canvas.restore()
    }

    private fun paintBrand(canvas: Canvas, brand: BrandFrame, state: FrameState) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = state.height * 0.022f
            color = Color.WHITE
            alpha = (brand.opacity * 255).toInt().coerceIn(0, 255)
        }
        val margin = state.width * 0.025f
        val y = when (brand.position) {
            BrandPosition.TOP_LEFT, BrandPosition.TOP_RIGHT -> state.height * 0.055f
            else -> state.height * 0.955f
        }
        paint.textAlign = when (brand.position) {
            BrandPosition.TOP_RIGHT, BrandPosition.BOTTOM_RIGHT -> Paint.Align.RIGHT
            else -> Paint.Align.LEFT
        }
        val x = when (paint.textAlign) { Paint.Align.RIGHT -> state.width - margin else -> margin }
        canvas.drawText(brand.text, x, y, paint)
    }

    private fun paintGuides(canvas: Canvas, state: FrameState) {
        val g = state.guides
        canvas.drawRect(g.x, g.y, g.x + g.width, g.y + g.height, guidePaint)
    }

    /* ------------------------------ helpers ------------------------------ */

    private fun color(hex: String): Int = try {
        Color.parseColor(hex)
    } catch (_: Exception) { Color.WHITE }

    private fun withAlpha(color: Int, alpha: Float): Int = Color.argb(
        (alpha.coerceIn(0f, 1f) * 255).toInt().coerceIn(0, 255),
        Color.red(color), Color.green(color), Color.blue(color))
}
