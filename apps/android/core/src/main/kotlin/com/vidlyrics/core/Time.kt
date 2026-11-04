package com.vidlyrics.core

/**
 * Time is a first-class domain type.
 *
 * Every timestamp in VidLyrics is an integer number of MICROSECONDS stored in a
 * Long. Floating point seconds only exist at platform boundaries (MediaCodec
 * presentation times, ExoPlayer positions, UI sliders) and are converted once.
 *
 * This is deliberate: the web codebase used JS numbers and had to guard against
 * drift by rounding at every step. Long arithmetic makes frame/preview/export
 * agreement structural instead of conventional, and 9.2e12 seconds of range is
 * more than any song needs.
 */
typealias Microseconds = Long

object Time {
    const val US_PER_SECOND: Long = 1_000_000L
    const val US_PER_MS: Long = 1_000L
    const val DEFAULT_FPS: Int = 30

    fun fromMs(ms: Double): Microseconds = Math.round(ms * US_PER_MS)
    fun fromMs(ms: Long): Microseconds = ms * US_PER_MS
    fun fromSeconds(seconds: Double): Microseconds = Math.round(seconds * US_PER_SECOND)
    fun toMs(us: Microseconds): Double = us.toDouble() / US_PER_MS
    fun toSeconds(us: Microseconds): Double = us.toDouble() / US_PER_SECOND

    fun clamp(us: Microseconds, min: Microseconds, max: Microseconds): Microseconds =
        minOf(maxOf(us, min), max)

    /** Snap to the centre of the frame the timestamp lands in (deterministic). */
    fun snapToFrame(us: Microseconds, fps: Int = DEFAULT_FPS): Microseconds {
        val frameUs = Math.round(US_PER_SECOND.toDouble() / fps)
        return Math.round(us.toDouble() / frameUs) * frameUs
    }

    fun frameIndex(us: Microseconds, fps: Int = DEFAULT_FPS): Long {
        val frameUs = US_PER_SECOND.toDouble() / fps
        return maxOf(0L, Math.floor(us / frameUs).toLong())
    }

    fun frameToUs(frame: Long, fps: Int = DEFAULT_FPS): Microseconds =
        Math.round(frame * US_PER_SECOND.toDouble() / fps)

    fun formatClock(us: Microseconds): String {
        val total = Math.floor(toSeconds(maxOf(0L, us))).toLong()
        return "%02d:%02d".format(total / 60, total % 60)
    }

    /** mm:ss.cc — playhead readout. */
    fun formatTimecode(us: Microseconds): String {
        val clamped = maxOf(0L, us)
        val totalSeconds = clamped / US_PER_SECOND
        val m = totalSeconds / 60
        val s = totalSeconds % 60
        val cs = (clamped % US_PER_SECOND) / 10_000
        return "%02d:%02d.%02d".format(m, s, cs)
    }

    /** hh:mm:ss,mmm — SRT. */
    fun formatSrtTimestamp(us: Microseconds): String {
        val c = maxOf(0L, us)
        val h = c / 3_600_000_000L
        val m = (c / 60_000_000L) % 60
        val s = (c / US_PER_SECOND) % 60
        val ms = (c / US_PER_MS) % 1_000
        return "%02d:%02d:%02d,%03d".format(h, m, s, ms)
    }

    fun formatVttTimestamp(us: Microseconds): String = formatSrtTimestamp(us).replace(',', '.')

    /** [mm:ss.xx] — LRC, hundredths. */
    fun formatLrcTimestamp(us: Microseconds): String {
        val c = maxOf(0L, us)
        val m = c / 60_000_000L
        val s = (c / US_PER_SECOND) % 60
        val hs = (c / 10_000L) % 100
        return "[%02d:%02d.%02d]".format(m, s, hs)
    }

    /** h:mm:ss.cc — ASS. */
    fun formatAssTimestamp(us: Microseconds): String {
        val c = maxOf(0L, us)
        val h = c / 3_600_000_000L
        val m = (c / 60_000_000L) % 60
        val s = (c / US_PER_SECOND) % 60
        val cs = (c / 10_000L) % 100
        return "%d:%02d:%02d.%02d".format(h, m, s, cs)
    }

    private val CLOCK = Regex("""^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$""")

    /** Accepts mm:ss, hh:mm:ss and fractional parts of 1-3 digits. */
    fun parseClock(text: String): Microseconds? {
        val m = CLOCK.matchEntire(text.trim()) ?: return null
        val h = m.groupValues[1].toLongOrNull() ?: 0L
        val min = m.groupValues[2].toLongOrNull() ?: return null
        val sec = m.groupValues[3].toLongOrNull() ?: return null
        if (min > 59 || sec > 59) return null
        val fracRaw = m.groupValues[4]
        val frac = (fracRaw + "000".take(3 - fracRaw.length)).take(3).toLongOrNull() ?: 0L
        return (h * 3600 + min * 60 + sec) * US_PER_SECOND + frac * US_PER_MS
    }

    fun formatDuration(us: Microseconds): String {
        val total = Math.round(toSeconds(maxOf(0L, us)))
        val m = total / 60
        val s = total % 60
        return if (m > 0) "${m}m ${s}s" else "${s}s"
    }

    fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB")
        var value = bytes.toDouble()
        var i = 0
        while (value >= 1024 && i < units.size - 1) { value /= 1024; i++ }
        return if (i == 0 || value >= 10) "%.0f %s".format(value, units[i])
        else "%.1f %s".format(value, units[i])
    }
}
