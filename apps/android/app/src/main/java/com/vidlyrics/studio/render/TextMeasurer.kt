package com.vidlyrics.studio.render

import android.graphics.Paint
import android.graphics.Typeface
import android.util.LruCache
import com.vidlyrics.core.Measurer
import com.vidlyrics.core.MeasureFn

/**
 * Android Paint-based text measurement.
 *
 * The same factory is injected into computeFrameState() in the Compose preview
 * and in the MediaCodec export loop. This is what makes line wrapping identical
 * in both: layout never depends on which Surface happened to be drawing.
 */
object AndroidTextMeasurer {
    private data class Key(val size: Float, val weight: Int, val spacing: Float, val font: String)

    private val cache = object : LruCache<Key, Paint>(64) {
        override fun create(key: Key): Paint = buildPaint(key)
    }

    private fun buildPaint(key: Key): Paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        textSize = key.size
        typeface = typefaceFor(key.font, key.weight)
        letterSpacing = if (key.size > 0) key.spacing / key.size else 0f
    }

    fun typefaceFor(fontStack: String, weight: Int): Typeface {
        val first = fontStack.split(',').firstOrNull()?.trim()?.replace(Regex("""["']"""), "")?.lowercase() ?: ""
        val base = when {
            first.contains("serif") && !first.contains("sans") -> Typeface.SERIF
            first.contains("mono") -> Typeface.MONOSPACE
            else -> Typeface.DEFAULT
        }
        val style = if (weight >= 700) Typeface.BOLD else if (weight <= 300) Typeface.ITALIC else Typeface.NORMAL
        return try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P)
                Typeface.create(base, weight.coerceIn(100, 900), style == Typeface.ITALIC)
            else Typeface.create(base, style)
        } catch (_: Exception) { Typeface.create(base, style) }
    }

    /** Default factory; themes may override the font stack via `withFont`. */
    fun factory(fontStack: String = "sans-serif"): MeasureFn = { size, weight, spacing ->
        val paint = cache.get(Key(size, weight, spacing, fontStack))
        Measurer { text -> paint.measureText(text) }
    }
}
