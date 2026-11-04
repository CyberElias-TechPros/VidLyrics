package com.vidlyrics.studio.ui.editor.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.vidlyrics.core.AudioAnalysis
import com.vidlyrics.core.Line
import com.vidlyrics.core.TapSession
import com.vidlyrics.core.TimingSource
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The editing surface: waveform + lyric blocks + beat grid + confidence heat +
 * tap markers + playhead. Drawn directly on a Compose Canvas, no third-party
 * chart library. Gestures: tap = seek, drag = scrub, long press = select line.
 */
@Composable
fun WaveformTimeline(
    analysis: AudioAnalysis?,
    lines: List<Line>,
    taps: TapSession,
    positionUs: Long,
    durationUs: Long,
    viewStartUs: Long,
    viewDurationUs: Long,
    loop: Pair<Long, Long>?,
    selectedLineId: String?,
    showHeat: Boolean,
    onSeek: (Long) -> Unit,
    onSelectLine: (String?) -> Unit,
    onPan: (Long) -> Unit,
    modifier: Modifier = Modifier
) {
    val primary = MaterialTheme.colorScheme.primary
    val secondary = MaterialTheme.colorScheme.secondary
    val surface = MaterialTheme.colorScheme.surfaceVariant
    val onSurface = MaterialTheme.colorScheme.onSurface
    val error = MaterialTheme.colorScheme.error
    val total = max(1L, durationUs)
    val window = viewDurationUs.coerceIn(2_000_000L, total)
    val start = viewStartUs.coerceIn(0L, max(0L, total - window))

    Canvas(modifier.fillMaxSize().semantics { contentDescription = "Waveform and lyric timeline" }
        .pointerInput(start, window, total, lines) {
            // One gesture detector handles both scrub and seek, avoiding the
            // consumed-down conflict between two nested detectors.
            awaitEachGesture {
                val down = awaitFirstDown()
                val originX = down.position.x
                var moved = false
                var previousX = originX
                var event = awaitPointerEvent()
                while (event.changes.any { it.pressed }) {
                    event.changes.forEach { change ->
                        val dx = change.position.x - previousX
                        previousX = change.position.x
                        if (abs(change.position.x - originX) > 8f) moved = true
                        if (moved && dx != 0f) {
                            onPan((-dx / size.width.toDouble() * window).toLong())
                            change.consume()
                        }
                    }
                    event = awaitPointerEvent()
                }
                if (!moved) {
                    val us = (start + (originX / size.width) * window).toLong().coerceIn(0, total)
                    onSelectLine(lines.firstOrNull { us >= it.start && us <= it.end }?.id)
                    onSeek(us)
                }
            }
        }) {

        val w = size.width; val h = size.height
        fun x(us: Long): Float = ((us - start).toFloat() / window) * w
        drawRect(color = surface.copy(alpha = 0.35f))

        // Time ruler every 5/10/30 seconds depending on zoom.
        val rulerStep = when {
            window <= 20_000_000L -> 2_000_000L
            window <= 90_000_000L -> 10_000_000L
            else -> 30_000_000L
        }
        var tick = (start / rulerStep) * rulerStep
        while (tick <= start + window) {
            val px = x(tick)
            drawLine(onSurface.copy(alpha = 0.12f), Offset(px, 0f), Offset(px, h))
            tick += rulerStep
        }

        // Waveform envelope (min/max buckets), decimated to one bar per pixel.
        val peaks = analysis?.peaks
        val waveTop = h * 0.18f; val waveBottom = h * 0.62f
        val waveMid = (waveTop + waveBottom) / 2f
        drawLine(onSurface.copy(alpha = 0.18f), Offset(0f, waveMid), Offset(w, waveMid))
        if (peaks != null && peaks.buckets > 0) {
            val bars = max(1, w.toInt())
            val bucketPerBar = max(1.0, peaks.buckets.toDouble() / bars)
            val amp = (waveBottom - waveTop) / 2f * 0.92f
            for (bar in 0 until bars) {
                val first = (bar * bucketPerBar).toInt()
                val last = min(peaks.buckets - 1, max(first, ((bar + 1) * bucketPerBar).toInt() - 1))
                var lo = 0f; var hi = 0f
                for (b in first..last) {
                    val idx = b * 3
                    if (idx + 1 >= peaks.data.size) break
                    lo = min(lo, peaks.data[idx]); hi = max(hi, peaks.data[idx + 1])
                }
                val px = bar.toFloat()
                drawLine(primary.copy(alpha = 0.75f),
                    Offset(px, waveMid - hi * amp), Offset(px, waveMid - lo * amp))
            }
        } else {
            // Honest placeholder: no fake waveform before analysis completes.
            drawLine(onSurface.copy(alpha = 0.25f), Offset(0f, waveMid), Offset(w, waveMid),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 8f)))
        }

        // Beat grid
        analysis?.beatGrid?.beats?.forEach { beat ->
            val px = x(beat)
            if (px in 0f..w) drawLine(secondary.copy(alpha = 0.22f),
                Offset(px, waveTop), Offset(px, waveBottom))
        }

        // Lyric blocks with confidence heat
        val blockTop = h * 0.68f; val blockBottom = h * 0.92f
        lines.forEach { line ->
            val left = x(line.start); val right = x(line.end)
            if (right < 0 || left > w) return@forEach
            val selected = line.id == selectedLineId
            val heat = showHeat && (line.source == TimingSource.ALIGN || line.source == TimingSource.ASR)
                && line.confidence < 0.5
            val color = when {
                selected -> primary
                heat -> error.copy(alpha = 0.75f)
                line.locked -> onSurface.copy(alpha = 0.55f)
                else -> secondary.copy(alpha = 0.65f)
            }
            drawRect(color = color.copy(alpha = if (selected) 0.9f else 0.55f),
                topLeft = Offset(left, blockTop),
                size = Size(max(3f, right - left), blockBottom - blockTop))
            if (line.words.isNotEmpty()) {
                line.words.forEach { word ->
                    val wx = x(word.start)
                    if (wx in 0f..w) drawLine(Color.White.copy(alpha = 0.35f),
                        Offset(wx, blockTop + 2f), Offset(wx, blockBottom - 2f))
                }
            }
        }

        // Tap markers
        taps.taps.forEach { tap ->
            val px = x(tap.timeUs)
            if (px in 0f..w) drawLine(Color(0xFF4DD0C1), Offset(px, 0f), Offset(px, h),
                strokeWidth = 3f)
        }

        // Loop region
        if (loop != null) {
            val a = x(loop.first); val b = x(loop.second)
            drawRect(primary.copy(alpha = 0.12f), topLeft = Offset(a, 0f),
                size = Size(abs(b - a), h))
            drawLine(primary, Offset(a, 0f), Offset(a, h), strokeWidth = 2f)
            drawLine(primary, Offset(b, 0f), Offset(b, h), strokeWidth = 2f)
        }

        // Playhead
        val px = x(positionUs)
        if (px in 0f..w) {
            drawLine(Color.White, Offset(px, 0f), Offset(px, h), strokeWidth = 2f)
            drawRect(Color.White, topLeft = Offset(px - 5f, 0f), size = Size(10f, 8f))
        }
    }
}
