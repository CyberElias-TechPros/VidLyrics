package com.vidlyrics.core

/**
 * Render planning: compatibility checks BEFORE a long job starts, honest size
 * and ETA estimates, and the frame↔time arithmetic shared by preview/export.
 */
data class RenderEstimate(val frames: Long, val etaSeconds: Long, val outputBytes: Long, val warnings: List<String>)

fun validateExportSettings(s: ExportSettings): List<String> {
    val errors = mutableListOf<String>()
    if (s.width < 128 || s.height < 128) errors += "Resolution must be at least 128 px on both axes."
    if (s.width > 7680 || s.height > 4320) errors += "Resolution above 8K is not supported by device encoders."
    if (s.width % 2 != 0 || s.height % 2 != 0) errors += "Width and height must both be even for H.264/HEVC."
    if (s.fps < 12 || s.fps > 60) errors += "Frame rate must be between 12 and 60 fps."
    if (s.videoBitrate < 500_000) errors += "Video bitrate below 500 kbps will look heavily compressed."
    if (s.videoBitrate > 60_000_000) errors += "Video bitrate above 60 Mbps is unlikely to encode in real time."
    if (s.rangeEndUs <= s.rangeStartUs) errors += "The export range is empty or inverted."
    if (s.audioBitrate < 48_000) errors += "Audio bitrate below 48 kbps will sound badly degraded."
    return errors
}

fun estimateOutputBytes(s: ExportSettings): Long {
    val seconds = maxOf(0.0, (s.rangeEndUs - s.rangeStartUs) / 1_000_000.0)
    return Math.round(seconds * (s.videoBitrate + if (s.includeAudio) s.audioBitrate else 0) / 8.0)
}

fun estimateRender(s: ExportSettings, realtimeFactor: Double = 2.6): RenderEstimate {
    val seconds = maxOf(0.0, (s.rangeEndUs - s.rangeStartUs) / 1_000_000.0)
    val frames = Math.round(seconds * s.fps)
    val bytes = estimateOutputBytes(s)
    val warnings = mutableListOf<String>()
    if (s.width * s.height >= 3840 * 2160) warnings += "4K rendering needs a fast device and plenty of free storage."
    if (seconds > 600) warnings += "This is a long render. Keep the app in the foreground or plug in the device."
    if (s.width * s.height * 4 > 64 * 1024 * 1024) warnings += "Frame buffers are large; consider 720p if the render fails."
    return RenderEstimate(frames, Math.round(seconds * realtimeFactor), bytes, warnings)
}

fun frameCount(s: ExportSettings): Long =
    Math.round(maxOf(0.0, (s.rangeEndUs - s.rangeStartUs) / 1_000_000.0) * s.fps)

fun frameTimeUs(frame: Long, fps: Int): Microseconds = Time.frameToUs(frame, fps)

/** Codec → Android MediaCodec MIME. Capability probing happens on the device. */
fun codecMime(codec: CodecId): String = when (codec) {
    CodecId.H264 -> "video/avc"
    CodecId.HEVC -> "video/hevc"
    CodecId.VP9 -> "video/x-vnd.on2.vp9"
    CodecId.AV1 -> "video/av01"
}

fun codecLabel(codec: CodecId): String = when (codec) {
    CodecId.H264 -> "H.264 (most compatible)"
    CodecId.HEVC -> "HEVC / H.265"
    CodecId.VP9 -> "VP9"
    CodecId.AV1 -> "AV1"
}
