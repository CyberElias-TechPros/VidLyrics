package com.vidlyrics.core

/**
 * Manual tap-sync: the guaranteed recovery path. It needs no model, no GPU,
 * no download, no network and works on every device. Tap times come from the
 * audio clock (ExoPlayer.currentPosition converted to microseconds), NEVER
 * from wall-clock time.
 */
data class Tap(val lineIndex: Int, val timeUs: Microseconds, val seq: Int)

data class TapSession(
    val taps: List<Tap> = emptyList(),
    val nextLineIndex: Int = 0,
    /** Subtracted from a raw tap to correct consistent late tapping. */
    val compensationUs: Microseconds = 0,
    /** Silence preserved between consecutive lines. */
    val gapUs: Microseconds = 150_000,
    val seq: Int = 0
)

sealed interface TapCommand {
    data class TapAt(val timeUs: Microseconds) : TapCommand
    data class Retap(val timeUs: Microseconds) : TapCommand
    data object Undo : TapCommand
    data object Reset : TapCommand
    data class SetCompensation(val value: Microseconds) : TapCommand
    data class SetGap(val value: Microseconds) : TapCommand
    data class Nudge(val lineIndex: Int, val deltaUs: Microseconds) : TapCommand
}

fun reduceTap(state: TapSession, command: TapCommand, lineCount: Int): TapSession = when (command) {
    is TapCommand.TapAt -> {
        if (state.nextLineIndex >= lineCount) state
        else {
            val timeUs = maxOf(0, command.timeUs - state.compensationUs)
            val previous = state.taps.lastOrNull()
            if (previous != null && timeUs - previous.timeUs < 40_000) state
            else {
                val tap = Tap(state.nextLineIndex, timeUs, state.seq + 1)
                val taps = (state.taps.filter { it.lineIndex != tap.lineIndex } + tap).sortedBy { it.lineIndex }
                state.copy(taps = taps, nextLineIndex = state.nextLineIndex + 1, seq = state.seq + 1)
            }
        }
    }
    is TapCommand.Retap -> {
        val previous = state.taps.lastOrNull()
        if (previous == null) state
        else {
            val timeUs = maxOf(0, command.timeUs - state.compensationUs)
            state.copy(taps = state.taps.dropLast(1) + previous.copy(timeUs = timeUs, seq = state.seq + 1), seq = state.seq + 1)
        }
    }
    TapCommand.Undo -> if (state.taps.isEmpty()) state else state.copy(
        taps = state.taps.dropLast(1), nextLineIndex = maxOf(0, state.nextLineIndex - 1))
    TapCommand.Reset -> TapSession(compensationUs = state.compensationUs, gapUs = state.gapUs)
    is TapCommand.SetCompensation -> state.copy(compensationUs = command.value)
    is TapCommand.SetGap -> state.copy(gapUs = maxOf(0, command.value))
    is TapCommand.Nudge -> state.copy(taps = state.taps.map {
        if (it.lineIndex == command.lineIndex) it.copy(timeUs = maxOf(0, it.timeUs + command.deltaUs)) else it
    })
}

fun tapProgress(state: TapSession, lineCount: Int): Double =
    if (lineCount == 0) 1.0 else minOf(1.0, state.taps.size.toDouble() / lineCount)

private fun estimatedDuration(text: String): Microseconds {
    val words = text.trim().split(Regex("""\s+""")).count { it.isNotEmpty() }
    return 600_000L + words * 260_000L
}

/** Materialise taps into line timings; untapped lines are left untouched. */
fun applyTaps(lines: List<Line>, session: TapSession, durationUs: Microseconds? = null,
              maxLineUs: Microseconds = 6_000_000): List<Line> {
    if (session.taps.isEmpty()) return lines
    val byIndex = session.taps.associate { it.lineIndex to it.timeUs }
    val starts = lines.indices.map { byIndex[it] }
    return lines.mapIndexed { i, line ->
        val start = starts[i] ?: return@mapIndexed line
        var nextStart: Microseconds? = null
        for (j in i + 1 until starts.size) if (starts[j] != null) { nextStart = starts[j]; break }
        var end = if (nextStart != null) nextStart - session.gapUs else start + estimatedDuration(line.text)
        end = minOf(end, start + maxLineUs)
        if (durationUs != null) end = minOf(end, durationUs)
        end = maxOf(end, start + 400_000)
        val updated = line.copy(start = start, end = end, source = TimingSource.TAP,
            confidence = 1.0, words = emptyList())
        updated.copy(words = interpolateWords(updated, start, end))
    }
}

/** Median signed distance from each tap to the nearest beat: a SUGGESTION. */
fun suggestCompensation(session: TapSession, beats: List<Microseconds>, maxSearchUs: Microseconds = 400_000): Microseconds? {
    if (beats.isEmpty() || session.taps.size < 3) return null
    val deltas = mutableListOf<Long>()
    for (tap in session.taps) {
        var best = Double.POSITIVE_INFINITY
        var signed = 0L
        for (b in beats) {
            val d = tap.timeUs - b
            if (kotlin.math.abs(d) < kotlin.math.abs(best)) { best = d.toDouble(); signed = d }
            if (b > tap.timeUs + maxSearchUs) break
        }
        if (kotlin.math.abs(best) <= maxSearchUs) deltas += signed
    }
    if (deltas.size < 3) return null
    deltas.sort()
    return deltas[deltas.size / 2]
}
