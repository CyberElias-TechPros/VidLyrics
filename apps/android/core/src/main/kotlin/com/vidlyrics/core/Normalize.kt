package com.vidlyrics.core

import java.text.Normalizer
import java.util.Locale

/**
 * Two forms are kept for every string:
 *  - display text: the original characters, never rewritten destructively
 *  - norm: a matching-only form used by alignment/search, never displayed
 *
 * Users paste typographic quotes, RTL marks, combining accents and emoji.
 * "Normalising" by overwriting their text silently corrupts their file.
 */
fun normalizeDisplay(input: String): String {
    val nfc = try { Normalizer.normalize(input, Normalizer.Form.NFC) } catch (_: Exception) { input }
    return nfc
        .replace(Regex("[\u200B-\u200D\uFEFF]"), "")
        .replace(Regex("\r\n?"), "\n")
        .replace("\t", "    ")
        .replace(Regex("[ ]{2,}"), " ")
        .split('\n').joinToString("\n") { it.trim() }
        .trim()
}

fun normalizeForMatch(input: String): String {
    val nfkc = try { Normalizer.normalize(input, Normalizer.Form.NFKC) } catch (_: Exception) { input }
    val folded = nfkc.lowercase(Locale.ROOT)
    val decomposed = try { Normalizer.normalize(folded, Normalizer.Form.NFD) } catch (_: Exception) { folded }
    val sb = StringBuilder()
    var i = 0
    while (i < decomposed.length) {
        val cp = decomposed.codePointAt(i)
        i += java.lang.Character.charCount(cp)
        when {
            cp == 0x2019 || cp == 0x27 || cp == 0x60 -> Unit // apostrophes vanish: "don't" == "dont"
            cp in 0x0300..0x036F -> Unit                       // combining marks
            cp in 0x200B..0x200D || cp == 0xFEFF -> Unit      // zero-width / bidi
            java.lang.Character.isLetterOrDigit(cp) -> sb.appendCodePoint(cp)
            java.lang.Character.isWhitespace(cp) -> sb.append(' ')
            else -> sb.append(' ')
        }
    }
    return sb.toString().replace(Regex("""\s+"""), " ").trim()
}

private val STRUCTURAL_TAG = Regex("""^\s*[\[(#]+\s*([A-Za-z][A-Za-z0-9 _'-]{0,24})\s*[\])]*\s*$""")

fun extractStructuralTag(line: String): String? =
    STRUCTURAL_TAG.matchEntire(line)?.groupValues?.get(1)?.trim()?.uppercase(Locale.ROOT)

private val INSTRUMENTAL = Regex("""^(instrumental|interlude|break|breakdown|solo|drop|ad lib|adlibs|ad libitum|music|repeat|hook|\(?music[^)]*\)?|\(?instrumental[^)]*\)?)$""")

fun isInstrumentalMarker(line: String): Boolean = INSTRUMENTAL.matches(normalizeForMatch(line))

private val AD_LIB = Regex("""^(.*?)\s*\(([^()]{1,60})\)\s*$""")

fun splitAdLib(line: String): Pair<String, String?> {
    val m = AD_LIB.matchEntire(line) ?: return Pair(line, null)
    val main = m.groupValues[1].trim()
    return if (main.isEmpty()) Pair(line, null) else Pair(main, m.groupValues[2].trim())
}

/** Strip subtitle residue a user may have pasted by accident. */
fun stripTimingResidue(input: String): String = input
    .replace(Regex("""^\s*(WEBVTT.*)$""", RegexOption.MULTILINE), "")
    .replace(Regex("""^\s*NOTE\s.*$""", RegexOption.MULTILINE), "")
    .replace(Regex("""^\s*-->\s*.*$""", RegexOption.MULTILINE), "")
    .replace(Regex("""^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*$""", RegexOption.MULTILINE), "")
    .replace(Regex("""^\s*(\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+""", RegexOption.MULTILINE), "")
