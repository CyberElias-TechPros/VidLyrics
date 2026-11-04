package com.vidlyrics.studio.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import com.vidlyrics.core.AudioMeta
import com.vidlyrics.core.AppError
import com.vidlyrics.core.RecoveryRoute
import com.vidlyrics.core.Time
import com.vidlyrics.studio.data.ImportedAsset
import java.io.File
import kotlin.math.max
import kotlin.math.min

/** Probed metadata, kept separate from the decoded PCM. */
data class AudioProbe(
    val durationUs: Long, val sampleRate: Int, val channels: Int,
    val mimeType: String, val title: String?, val artist: String?,
    val album: String?, val embeddedArt: Bitmap?
)

fun probeAudio(file: File, fallbackMime: String): AudioProbe {
    var durationUs = 0L
    var sampleRate = 44100
    var channels = 2
    var mime = fallbackMime
    var title: String? = null; var artist: String? = null; var album: String? = null
    var art: Bitmap? = null

    val extractor = MediaExtractor()
    try {
        extractor.setDataSource(file.absolutePath)
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val m = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (!m.startsWith("audio/")) continue
            mime = m
            if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            if (f.containsKey(MediaFormat.KEY_DURATION)) durationUs = f.getLong(MediaFormat.KEY_DURATION)
        }
    } catch (e: Exception) {
        throw AudioDecodeException(AppError.unsupportedAudio(e.message), e)
    } finally { extractor.release() }

    val retriever = MediaMetadataRetriever()
    try {
        retriever.setDataSource(file.absolutePath)
        if (durationUs <= 0) {
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()?.let { durationUs = it * Time.US_PER_MS }
        }
        title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
        artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
        album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
        retriever.embeddedPicture?.let { bytes ->
            art = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
    } catch (_: Exception) { /* metadata is optional */ }
    finally { try { retriever.release() } catch (_: Exception) { Unit } }

    if (durationUs <= 0) throw AudioDecodeException(AppError.unsupportedAudio("The file has no playable audio duration."))
    return AudioProbe(durationUs, sampleRate, channels, mime, title, artist, album, art)
}

fun audioMetaFrom(imported: ImportedAsset, probe: AudioProbe): AudioMeta = AudioMeta(
    assetId = imported.assetId,
    fileName = imported.fileName,
    mimeType = probe.mimeType,
    bytes = imported.bytes,
    durationUs = probe.durationUs,
    sampleRate = probe.sampleRate,
    channels = probe.channels,
    peaksAssetId = imported.contentHash,
    contentHash = imported.contentHash
)

/**
 * A tiny median-cut style palette extraction from album art. No dependency and
 * no network: it samples the bitmap, buckets colours, and returns 4 colours
 * ordered by luminance for use as a background gradient.
 */
fun paletteFrom(bitmap: Bitmap?, count: Int = 4): List<String> {
    if (bitmap == null) return emptyList()
    val sample = Bitmap.createScaledBitmap(bitmap, 48, 48, true)
    val buckets = HashMap<Int, MutableList<Int>>()
    for (y in 0 until sample.height step 2) {
        for (x in 0 until sample.width step 2) {
            val c = sample.getPixel(x, y)
            if (Color.alpha(c) < 64) continue
            val key = ((Color.red(c) shr 4) shl 8) or ((Color.green(c) shr 4) shl 4) or (Color.blue(c) shr 4)
            buckets.getOrPut(key) { ArrayList() } += c
        }
    }
    val ranked = buckets.values
        .map { group ->
            var r = 0L; var g = 0L; var b = 0L
            for (c in group) { r += Color.red(c); g += Color.green(c); b += Color.blue(c) }
            val n = group.size
            Triple(Color.rgb((r / n).toInt(), (g / n).toInt(), (b / n).toInt()), n,
                0.2126 * r / n + 0.7152 * g / n + 0.0722 * b / n)
        }
        .sortedByDescending { it.second }
        .take(max(3, count))
        .sortedBy { it.third }
    if (ranked.isEmpty()) return emptyList()
    return ranked.map { "#%06X".format(0xFFFFFF and it.first) }
}

/** Friendly, actionable failure text for unsupported files. */
fun unsupportedAudioMessage(): String =
    "Use MP3, M4A/AAC, WAV, FLAC, OGG or Opus. DRM-protected, encrypted or " +
        "exotic codecs cannot be decoded on this device. Tap-sync and all editing " +
        "still work after choosing a supported file."

fun audioRecoveryRoutes(): List<RecoveryRoute> =
    listOf(RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.REIMPORT_AUDIO, RecoveryRoute.DOCUMENTATION)
