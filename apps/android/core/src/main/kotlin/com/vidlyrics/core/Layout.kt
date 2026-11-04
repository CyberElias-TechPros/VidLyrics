package com.vidlyrics.core

/** Text measurer supplied by the platform (Android Paint). */
fun interface Measurer { fun width(text: String): Float }

/** A measurer factory: each line may have its own size/weight/spacing. */
typealias MeasureFn = (fontSizePx: Float, weight: Int, letterSpacingPx: Float) -> Measurer

/** Approximate measurer for pre-flight checks and JVM tests. */
fun approximateMeasurer(fontSizePx: Float, ratio: Float = 0.52f): Measurer =
    Measurer { text -> graphemes(text).size * fontSizePx * ratio }

data class LayoutToken(val text: String, val wordIndex: Int, val widthPx: Float, val isSpace: Boolean)
data class LayoutRow(val tokens: List<LayoutToken>, val widthPx: Float)
data class LineLayout(val rows: List<LayoutRow>, val heightPx: Float, val maxWidthPx: Float)
data class LayoutOptions(
    val fontSizePx: Float, val lineHeightPx: Float, val maxWidthPx: Float,
    val letterSpacingPx: Float = 0f, val uppercase: Boolean = false
)

/**
 * Greedy word wrap with grapheme-level breaking for over-wide tokens.
 *
 * Layout is deliberately separated from painting and uses the EXACT same
 * measurer in preview and export. If layout lived inside the draw call, a font
 * difference between the two paths would silently rewrap a line in the video.
 */
fun layoutWords(words: List<Pair<String, Int>>, measurer: Measurer, options: LayoutOptions): LineLayout {
    val maxWidth = maxOf(1f, options.maxWidthPx)
    val rows = ArrayList<LayoutRow>()
    var current = ArrayList<LayoutToken>()
    var currentWidth = 0f

    fun width(text: String): Float =
        measurer.width(text) + options.letterSpacingPx * maxOf(0, graphemes(text).size - 1)

    fun flush() {
        if (current.isEmpty()) return
        rows += LayoutRow(current.toList(), currentWidth)
        current = ArrayList(); currentWidth = 0f
    }

    for ((text, wordIndex) in words) {
        val display = if (options.uppercase) text.uppercase() else text
        val w = width(display)
        val isSpace = text.isBlank()
        if (w > maxWidth) {
            flush()
            var chunk = ""; var chunkWidth = 0f
            for (g in graphemes(display)) {
                val gw = width(g)
                if (chunkWidth + gw > maxWidth && chunk.isNotEmpty()) {
                    rows += LayoutRow(listOf(LayoutToken(chunk, wordIndex, chunkWidth, isSpace)), chunkWidth)
                    chunk = ""; chunkWidth = 0f
                }
                chunk += g; chunkWidth += gw
            }
            if (chunk.isNotEmpty()) {
                current.add(LayoutToken(chunk, wordIndex, chunkWidth, isSpace)); currentWidth = chunkWidth
            }
            continue
        }
        if (!isSpace && currentWidth + w > maxWidth && current.isNotEmpty()) flush()
        current += LayoutToken(display, wordIndex, w, isSpace)
        currentWidth += w
    }
    flush()
    val filtered = rows.filter { row -> row.tokens.any { !it.isSpace } }
    return LineLayout(filtered, filtered.size * options.lineHeightPx,
        filtered.maxOfOrNull { it.widthPx } ?: 0f)
}

/** Insert measured space tokens so wrapping stays honest. */
fun tokensFromWords(words: List<String>): List<Pair<String, Int>> {
    val out = ArrayList<Pair<String, Int>>(words.size * 2)
    words.forEachIndexed { i, w ->
        out += Pair(w, i)
        if (i < words.size - 1) out += Pair(" ", i)
    }
    return out
}

fun rowOriginX(row: LayoutRow, contentLeft: Float, contentWidth: Float, align: TextAlign): Float = when (align) {
    TextAlign.LEFT -> contentLeft
    TextAlign.RIGHT -> contentLeft + contentWidth - row.widthPx
    TextAlign.CENTER -> contentLeft + (contentWidth - row.widthPx) / 2f
}

fun blockAnchorY(blockHeight: Float, contentTop: Float, contentHeight: Float, anchor: VerticalAnchor): Float {
    val free = maxOf(0f, contentHeight - blockHeight)
    return when (anchor) {
        VerticalAnchor.TOP -> contentTop + free * 0.12f
        VerticalAnchor.BOTTOM -> contentTop + free * 0.88f
        VerticalAnchor.CENTER -> contentTop + free * 0.5f
    }
}

fun overflowWarning(layout: LineLayout, contentWidth: Float): String? =
    if (layout.maxWidthPx > contentWidth * 1.02f) "Text is wider than the safe area." else null
