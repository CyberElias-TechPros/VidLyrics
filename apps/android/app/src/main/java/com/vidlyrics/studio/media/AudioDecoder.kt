package com.vidlyrics.studio.media

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.vidlyrics.core.AppError
import com.vidlyrics.core.RecoveryRoute
import com.vidlyrics.core.Resampler
import com.vidlyrics.core.Time
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

/**
 * Real PCM decoding through the device's MediaCodec decoders.
 *
 * The stream is consumed in small chunks: a 10-minute song never sits in RAM as
 * one FloatArray. Downmixing happens here so every downstream consumer
 * (waveform, FFT, auto-sync, AAC re-encode) sees mono float samples in [-1,1].
 * Container sniffing is done by MediaExtractor rather than trusting the file
 * extension, which is how a mislabelled .mp3 still opens correctly.
 *
 * Supported formats are exactly the formats the DEVICE can decode: MP3,
 * M4A/AAC/ALAC, FLAC, Ogg Vorbis, Opus, WAV, AMR, AC-3/E-AC-3 where licensed.
 * Unknown/corrupt/unsupported files produce a designed error with a route
 * forward instead of a silent empty waveform.
 */
data class AudioInfo(
    val sampleRate: Int, val channels: Int, val durationUs: Long,
    val mimeType: String, val framesDecoded: Long
)

class AudioDecodeException(val error: AppError, cause: Throwable? = null) : Exception(error.title, cause)

private const val TIMEOUT_US = 10_000L

fun File.isWavLike(): Boolean = try {
    FileInputStream(this).use { f ->
        val head = ByteArray(12)
        if (f.read(head) != 12) false
        else String(head, 0, 4, Charsets.US_ASCII) == "RIFF" &&
            String(head, 8, 4, Charsets.US_ASCII) == "WAVE"
    }
} catch (_: Exception) { false }

/** Decode a source file to mono float PCM and hand chunks to `onChunk`. */
fun decodeMono(
    file: File,
    onChunk: (samples: FloatArray, length: Int) -> Unit,
    shouldCancel: () -> Boolean = { false },
    targetRate: Int = 0,
    rangeStartUs: Long = 0,
    rangeEndUs: Long = Long.MAX_VALUE,
    gain: Float = 1f
): AudioInfo {
    if (!file.exists()) throw AudioDecodeException(AppError(
        code = "AUDIO_MISSING", title = "Audio file is missing",
        detail = "The audio for this project is no longer on this device. Re-import it to continue.",
        recovery = listOf(RecoveryRoute.REIMPORT_AUDIO)))
    return try {
        if (file.isWavLike()) decodeWav(file, onChunk, shouldCancel, targetRate, rangeStartUs, rangeEndUs, gain)
        else decodeWithMediaCodec(file, onChunk, shouldCancel, targetRate, rangeStartUs, rangeEndUs, gain)
    } catch (e: AudioDecodeException) { throw e }
    catch (e: Exception) { throw AudioDecodeException(AppError.unsupportedAudio(e.message), e) }
}

private fun decodeWithMediaCodec(
    file: File,
    onChunk: (FloatArray, Int) -> Unit,
    shouldCancel: () -> Boolean,
    targetRate: Int,
    rangeStartUs: Long,
    rangeEndUs: Long,
    gain: Float
): AudioInfo {
    val extractor = MediaExtractor()
    extractor.setDataSource(file.absolutePath)
    var audioTrack = -1
    var mime = ""
    var sampleRate = 44100
    var channels = 2
    var durationUs = 0L
    for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val trackMime = format.getString(MediaFormat.KEY_MIME) ?: ""
        if (!trackMime.startsWith("audio/")) continue
        audioTrack = i; mime = trackMime
        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        if (format.containsKey(MediaFormat.KEY_DURATION)) durationUs = format.getLong(MediaFormat.KEY_DURATION)
        break
    }
    if (audioTrack < 0) {
        extractor.release()
        throw AudioDecodeException(AppError.unsupportedAudio("No audio track was found in this container."))
    }
    val format = extractor.getTrackFormat(audioTrack)
    extractor.selectTrack(audioTrack)
    if (rangeStartUs > 0) extractor.seekTo(rangeStartUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)

    val decoder = try { MediaCodec.createDecoderByType(mime) }
    catch (e: Exception) {
        extractor.release()
        throw AudioDecodeException(AppError.unsupportedAudio("No decoder for $mime"), e)
    }
    decoder.configure(format, null, null, 0)
    decoder.start()

    val bufferInfo = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    var outputRate = sampleRate
    var outputChannels = channels
    var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
    var resampler: Resampler? = null
    var framesDecoded = 0L
    val chunk = FloatArray(8192)

    try {
        while (!outputDone) {
            if (shouldCancel()) break
            if (!inputDone) {
                val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
                if (inIndex >= 0) {
                    val inputBuffer = decoder.getInputBuffer(inIndex)
                    val sampleSize = extractor.readSampleData(inputBuffer!!, 0)
                    if (sampleSize < 0) {
                        decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        val pts = extractor.sampleTime
                        if (pts > rangeEndUs) {
                            decoder.queueInputBuffer(inIndex, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, pts, 0)
                            extractor.advance()
                        }
                    }
                }
            }
            when (val outIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)) {
                MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val outFormat = decoder.outputFormat
                    if (outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) outputRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    if (outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) outputChannels = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    if (outFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) pcmEncoding = outFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    val rate = if (targetRate > 0) targetRate else outputRate
                    resampler = if (rate != outputRate) Resampler(outputRate, rate) else null
                }
                MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                else -> if (outIndex >= 0) {
                    val outputBuffer = decoder.getOutputBuffer(outIndex)
                    if (outputBuffer != null && bufferInfo.size > 0) {
                        val mono = pcmToMono(outputBuffer, bufferInfo, outputChannels, pcmEncoding, gain)
                        val resampled = resampler?.push(mono) ?: mono
                        var offset = 0
                        while (offset < resampled.size && !shouldCancel()) {
                            val n = min(chunk.size, resampled.size - offset)
                            System.arraycopy(resampled, offset, chunk, 0, n)
                            onChunk(chunk, n)
                            offset += n
                        }
                        framesDecoded += mono.size.toLong()
                    }
                    decoder.releaseOutputBuffer(outIndex, false)
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        }
    } finally {
        try { decoder.stop() } catch (_: Exception) { Unit }
        decoder.release()
        extractor.release()
    }
    return AudioInfo(if (targetRate > 0) targetRate else outputRate, outputChannels, durationUs, mime, framesDecoded)
}

/** Interleaved PCM (16/24/32-bit int or 32-bit float) → mono float. */
private fun pcmToMono(buffer: ByteBuffer, info: MediaCodec.BufferInfo, channels: Int,
                      encoding: Int, gain: Float): FloatArray {
    buffer.position(info.offset)
    buffer.limit(info.offset + info.size)
    val view = buffer.slice().order(ByteOrder.LITTLE_ENDIAN)
    val bytesPerSample = when (encoding) {
        AudioFormat.ENCODING_PCM_FLOAT -> 4
        AudioFormat.ENCODING_PCM_8BIT -> 1
        AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
        AudioFormat.ENCODING_PCM_32BIT -> 4
        else -> 2
    }
    val ch = maxOf(1, channels)
    val frameCount = info.size / (bytesPerSample * ch)
    val out = FloatArray(frameCount)
    for (f in 0 until frameCount) {
        var sum = 0f
        for (c in 0 until ch) {
            sum += when (bytesPerSample) {
                4 -> if (encoding == AudioFormat.ENCODING_PCM_FLOAT) view.getFloat()
                     else view.getInt() / 2147483648f
                3 -> ((view.get().toInt() and 0xFF) or
                      ((view.get().toInt() and 0xFF) shl 8) or
                      (view.get().toByte().toInt() shl 16)) / 8388608f
                2 -> view.getShort() / 32768f
                else -> ((view.get().toInt() and 0xFF) - 128) / 128f
            }
        }
        out[f] = (sum / ch) * gain
    }
    return out
}

/** RIFF/WAVE chunk scanner: real files often carry LIST/fact chunks before data. */
private data class WavHeader(val format: Int, val channels: Int, val sampleRate: Int,
                             val bits: Int, val dataOffset: Long, val dataBytes: Long)

private fun readWavHeader(input: FileInputStream): WavHeader {
    val riff = ByteArray(12)
    if (input.read(riff) != 12) throw AudioDecodeException(AppError.unsupportedAudio("Truncated WAV header."))
    var format = 1; var channels = 2; var sampleRate = 44100; var bits = 16
    var dataOffset = -1L; var dataBytes = 0L
    while (true) {
        val chunk = ByteArray(8)
        if (input.read(chunk) != 8) break
        val id = String(chunk, 0, 4, Charsets.US_ASCII)
        val size = ByteBuffer.wrap(chunk, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xFFFFFFFFL
        if (id == "data") {
            dataOffset = input.channel.position()
            dataBytes = size
            break
        }
        if (id == "fmt " && size >= 16) {
            val fmt = ByteArray(16)
            if (input.read(fmt) != 16) break
            val b = ByteBuffer.wrap(fmt).order(ByteOrder.LITTLE_ENDIAN)
            format = b.getShort(0).toInt()
            channels = b.getShort(2).toInt().coerceAtLeast(1)
            sampleRate = b.getInt(4)
            bits = b.getShort(14).toInt()
            if (size > 16) skipFully(input, size - 16)
        } else skipFully(input, size)
        if (size % 2L == 1L) skipFully(input, 1)
    }
    if (dataOffset < 0) throw AudioDecodeException(AppError.unsupportedAudio("WAV has no data chunk."))
    return WavHeader(format, channels, sampleRate, bits, dataOffset, dataBytes)
}

private fun skipFully(input: InputStream, count: Long) {
    var remaining = count
    val buf = ByteArray(8192)
    while (remaining > 0) {
        val n = input.read(buf, 0, min(buf.size.toLong(), remaining).toInt())
        if (n <= 0) break
        remaining -= n
    }
}

private fun decodeWav(
    file: File,
    onChunk: (FloatArray, Int) -> Unit,
    shouldCancel: () -> Boolean,
    targetRate: Int,
    rangeStartUs: Long,
    rangeEndUs: Long,
    gain: Float
): AudioInfo {
    FileInputStream(file).use { input ->
        val h = readWavHeader(input)
        if (h.format != 1 && h.format != 3)
            throw AudioDecodeException(AppError.unsupportedAudio("Only uncompressed PCM WAV is supported by the local decoder."))
        if (h.bits !in setOf(8, 16, 24, 32))
            throw AudioDecodeException(AppError.unsupportedAudio("Unsupported WAV bit depth ${h.bits}."))
        val bytesPerSample = h.bits / 8
        val frameBytes = bytesPerSample * h.channels
        val totalFrames = h.dataBytes / frameBytes
        val durationUs = Time.fromSeconds(totalFrames.toDouble() / h.sampleRate)
        val skipFrames = (rangeStartUs / 1_000_000.0 * h.sampleRate).toLong().coerceIn(0, totalFrames)
        val endFrames = if (rangeEndUs == Long.MAX_VALUE) totalFrames
        else min(totalFrames, (rangeEndUs / 1_000_000.0 * h.sampleRate).toLong())
        input.channel.position(h.dataOffset + skipFrames * frameBytes)
        val rate = if (targetRate > 0) targetRate else h.sampleRate
        val resampler = if (rate != h.sampleRate) Resampler(h.sampleRate, rate) else null
        val rawFrames = 4096
        val raw = ByteArray(rawFrames * frameBytes)
        var remaining = endFrames - skipFrames
        var framesDecoded = 0L
        val chunk = FloatArray(8192)
        while (remaining > 0 && !shouldCancel()) {
            val want = min(rawFrames.toLong(), remaining).toInt() * frameBytes
            val n = input.read(raw, 0, want)
            if (n <= 0) break
            val frames = n / frameBytes
            val mono = FloatArray(frames)
            val view = ByteBuffer.wrap(raw, 0, n).order(ByteOrder.LITTLE_ENDIAN)
            for (f in 0 until frames) {
                var sum = 0f
                for (c in 0 until h.channels) {
                    sum += when {
                        h.format == 3 && h.bits == 32 -> view.getFloat()
                        h.bits == 16 -> view.getShort() / 32768f
                        h.bits == 24 -> ((view.get().toInt() and 0xFF) or
                            ((view.get().toInt() and 0xFF) shl 8) or
                            (view.get().toByte().toInt() shl 16)) / 8388608f
                        h.bits == 32 -> view.getInt() / 2147483648f
                        else -> ((view.get().toInt() and 0xFF) - 128) / 128f
                    }
                }
                mono[f] = (sum / h.channels) * gain
            }
            val resampled = resampler?.push(mono) ?: mono
            var offset = 0
            while (offset < resampled.size && !shouldCancel()) {
                val take = min(chunk.size, resampled.size - offset)
                System.arraycopy(resampled, offset, chunk, 0, take)
                onChunk(chunk, take)
                offset += take
            }
            framesDecoded += frames
            remaining -= frames
        }
        return AudioInfo(rate, h.channels, durationUs, "audio/wav", framesDecoded)
    }
}
