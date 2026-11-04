package com.vidlyrics.core

import java.util.Locale

/**
 * Section inference and lyric-line construction.
 *
 * Structural tags ([Chorus], (Verse 2), ## Bridge) are headers, not sung text.
 * They are removed from the lines and converted into sections, which drive
 * palette/scene variation and the editor's navigation. Instrumental markers
 * are retained as UNKNOWN lines but never used as timing anchors.
 */
private fun kindFromTag(tag: String): SectionKind {
    val t = tag.uppercase(Locale.ROOT)
    return when {
        t.contains("PRE") && t.contains("CHORUS") -> SectionKind.PRE_CHORUS
        t.contains("CHORUS") -> SectionKind.CHORUS
        t.contains("VERSE") -> SectionKind.VERSE
        t.contains("BRIDGE") -> SectionKind.BRIDGE
        t.contains("INTRO") -> SectionKind.INTRO
        t.contains("OUTRO") || t.contains("ENDING") -> SectionKind.OUTRO
        t.contains("HOOK") -> SectionKind.HOOK
        t.contains("REFRAIN") -> SectionKind.REFRAIN
        t.contains("BREAKDOWN") || t.contains("BREAK") -> SectionKind.BREAKDOWN
        t.contains("SOLO") || t.contains("INSTRUMENTAL") || t.contains("INTERLUDE") -> SectionKind.INSTRUMENTAL
        else -> SectionKind.UNKNOWN
    }
}

data class SectionInference(val sections: List<Section>, val assignment: Map<String, String?>)

fun inferSections(lines: List<Line>): SectionInference {
    val sections = mutableListOf<Section>()
    val assignment = LinkedHashMap<String, String?>()
    val occurrence = mutableMapOf<SectionKind, Int>()
    var current: Section? = null

    for (line in lines) {
        val tag = extractStructuralTag(line.text)
        if (tag != null) {
            val kind = kindFromTag(tag)
            val n = occurrence[kind] ?: 0
            occurrence[kind] = n + 1
            val label = tag.split(Regex("""\s+""")).joinToString(" ") { w ->
                w.lowercase(Locale.ROOT).replaceFirstChar { it.uppercaseChar() }
            }
            current = Section(newId("sec"), kind, label, n + 1)
            sections += current
            assignment[line.id] = current.id
            continue
        }
        if (current == null) {
            current = Section(newId("sec"), SectionKind.UNKNOWN, "Lyrics", 1)
            occurrence[SectionKind.UNKNOWN] = 1
            sections += current
        }
        assignment[line.id] = current.id
    }
    return SectionInference(sections, assignment)
}
