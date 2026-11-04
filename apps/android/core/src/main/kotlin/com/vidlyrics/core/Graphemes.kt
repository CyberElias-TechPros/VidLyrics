@file:Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")

package com.vidlyrics.core

import java.lang.Character as JChar

/**
 * Grapheme-safe text handling.
 *
 * Karaoke fill, word timing and line wrapping must never split a user-perceived
 * character. Splitting by UTF-16 code unit breaks emoji, combining accents,
 * Indic viramas and ZWJ sequences — all common in the lyrics this app is used
 * for (gospel, Afrobeats, K-pop, Arabic, Hindi).
 *
 * The JVM's BreakIterator is locale/version dependent and Android ships a
 * different ICU from desktop JVMs, which would make preview and export wrap
 * differently. This hand-written clusterer is deterministic on both.
 */
private const val ZWJ = 0x200D

private fun isMark(cp: Int): Boolean = when (JChar.getType(cp)) {
    JChar.NON_SPACING_MARK.toInt(),
    JChar.COMBINING_SPACING_MARK.toInt(),
    JChar.ENCLOSING_MARK.toInt() -> true
    else -> false
}

private fun isVariationSelector(cp: Int): Boolean =
    cp in 0xFE00..0xFE0F || cp in 0xE0100..0xE01EF

private fun isEmojiModifier(cp: Int): Boolean = cp in 0x1F3FB..0x1F3FF

private fun isRegionalIndicator(cp: Int): Boolean = cp in 0x1F1E6..0x1F1FF

fun graphemes(text: String): List<String> {
    if (text.isEmpty()) return emptyList()
    val out = ArrayList<String>(text.length)
    val sb = StringBuilder()
    var i = 0
    var zwjPending = false
    var riCount = 0

    fun flush() {
        if (sb.isNotEmpty()) { out.add(sb.toString()); sb.setLength(0) }
        riCount = 0
    }

    while (i < text.length) {
        val cp = text.codePointAt(i)
        val width = JChar.charCount(cp)
        val piece = text.substring(i, i + width)
        i += width

        when {
            isMark(cp) || isVariationSelector(cp) || isEmojiModifier(cp) -> {
                if (sb.isEmpty()) sb.append(piece) else sb.append(piece)
            }
            cp == ZWJ -> { sb.append(piece); zwjPending = true }
            isRegionalIndicator(cp) -> {
                if (riCount == 1 && !zwjPending) { sb.append(piece); flush(); zwjPending = false }
                else { if (sb.isNotEmpty() && !zwjPending) flush(); sb.append(piece); riCount = 1; zwjPending = false }
            }
            zwjPending -> { sb.append(piece); zwjPending = false }
            else -> { flush(); sb.append(piece) }
        }
    }
    flush()
    return out
}

/** Scripts that do not use spaces between words. */
private fun noSpaceScript(cp: Int): Boolean = when (cp) {
    in 0x0E00..0x0E7F,   // Thai
    in 0x1780..0x17FF,   // Khmer
    in 0x1000..0x109F,   // Myanmar
    in 0x4E00..0x9FFF,   // CJK unified
    in 0x3040..0x30FF,   // Hiragana / Katakana
    in 0xAC00..0xD7AF,   // Hangul
    in 0x3400..0x4DBF    // CJK extension A
    -> true
    else -> false
}

fun needsGraphemeTokenisation(text: String): Boolean {
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        if (noSpaceScript(cp)) return true
        i += JChar.charCount(cp)
    }
    return false
}

data class Token(val text: String, val offset: Int, val isSpace: Boolean)

private val WORD_OR_SPACE = Regex("""\s+|\S+""")

/**
 * Split a line into highlightable tokens. Whitespace runs are emitted as space
 * tokens so interpolation spreads evenly across the whole line. A run that
 * contains a no-space script is further split into grapheme clusters (a mixed
 * English/CJK line therefore gets useful karaoke steps in the CJK part).
 */
fun tokenize(line: String): List<Token> {
    if (line.isEmpty()) return emptyList()
    val out = ArrayList<Token>()
    for (m in WORD_OR_SPACE.findAll(line)) {
        val part = m.value
        val isSpace = part.isBlank()
        if (!isSpace && needsGraphemeTokenisation(part)) {
            var offset = m.range.first
            for (g in graphemes(part)) {
                out.add(Token(g, offset, g.isBlank()))
                offset += g.length
            }
        } else {
            out.add(Token(part, m.range.first, isSpace))
        }
    }
    return out
}

fun highlightTokens(line: String): List<Token> =
    tokenize(line).filter { !it.isSpace && it.text.trim().isNotEmpty() }
