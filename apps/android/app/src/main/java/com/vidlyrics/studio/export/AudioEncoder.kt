package com.vidlyrics.studio.export

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

/**
 * A small thread-safe wrapper around MediaMuxer. MediaCodec output callbacks
 * arrive on two different threads (video loop + audio thread), and the muxer
 * must not be written before BOTH track formats have been added and start()
 * has been called. A latch plus synchronized writes makes that deterministic.
 */
class MuxerController(path: String, private var expectedTracks: Int) {
    private val muxer = MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val lock = Any()
    private val startedLatch = CountDownLatch(1)
    private var added = 0
    private var started = false
    private var stopped = false

    fun addTrack(format: MediaFormat): Int = synchronized(lock) {
        // MediaMuxer forbids addTrack() after start(). If a slow audio encoder
        // produced its format too late, degrade to video-only instead of
        // aborting the whole render.
        if (started) return@synchronized -1
        val index = muxer.addTrack(format)
        added++
        maybeStartLocked()
        index
    }

    /** Called when the audio track fails; the video must still be deliverable. */
    fun expectFewerTracks() = synchronized(lock) {
        expectedTracks = min(expectedTracks, 1)
        maybeStartLocked()
    }

    fun forceStart() = synchronized(lock) { maybeStartLocked(force = true) }

    private fun maybeStartLocked(force: Boolean = false) {
        if (!started && added > 0 && (force || added >= expectedTracks)) {
            muxer.start()
            started = true
            startedLatch.countDown()
        }
    }

    private fun awaitStart() {
        if (!startedLatch.await(30, TimeUnit.SECONDS)) {
            synchronized(lock) { if (!started && added > 0) maybeStartLocked(force = true) }
        }
    }

    fun write(trackIndex: Int, buffer: ByteBuffer, info: MediaCodec.BufferInfo) {
        awaitStart()
        synchronized(lock) {
            if (stopped || trackIndex < 0) return
            val dup = buffer.duplicate()
            dup.position(info.offset)
            dup.limit(info.offset + info.size)
            muxer.writeSampleData(trackIndex, dup, info)
        }
    }

    fun release() {
        synchronized(lock) {
            if (stopped) return
            stopped = true
            try { if (started) muxer.stop() } catch (_: Exception) { Unit }
            try { muxer.release() } catch (_: Exception) { Unit }
            startedLatch.countDown()
        }
    }
}

/**
 * AAC audio track encoder. Consumes mono float PCM at the chosen sample rate,
 * converts to interleaved 16-bit stereo, and writes packets to the shared
 * muxer. Timestamps are derived from the sample count, never from wall time —
 * that is what keeps a 3-minute render in sync with a 3-minute song.
 */
class AudioTrackEncoder(private val muxer: MuxerController,
                        private val sampleRate: Int = 44100,
                        bitrate: Int = 192_000) {
    private val codec: MediaCodec = MediaCodec.createEncoderByType("audio/mp4a-latm")
    private val format = MediaFormat.createAudioFormat("audio/mp4a-latm", sampleRate, 2).apply {
        setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        setInteger(MediaFormat.KEY_AAC_PROFILE, android.media.MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
    }
    private var trackIndex = -1
    private var pending = FloatArray(16 * 1024)
    private var pendingSize = 0
    private var presentationTimeUs = 0L
    private var inputDone = false
    private val info = MediaCodec.BufferInfo()

    init {
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
    }

    fun feed(samples: FloatArray, length: Int) {
        if (length <= 0 || inputDone) return
        ensureCapacity(pendingSize + length)
        System.arraycopy(samples, 0, pending, pendingSize, length)
        pendingSize += length
        while (pendingSize > 0) {
            val index = codec.dequeueInputBuffer(1_000L)
            if (index < 0) break
            val buffer = codec.getInputBuffer(index) ?: break
            buffer.clear()
            val capacityFrames = buffer.capacity() / 4
            val frames = min(capacityFrames, pendingSize)
            for (i in 0 until frames) {
                val s = (pending[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort()
                buffer.putShort(s) // L
                buffer.putShort(s) // R (mono source duplicated)
            }
            codec.queueInputBuffer(index, 0, frames * 4, presentationTimeUs, 0)
            presentationTimeUs += frames * 1_000_000L / sampleRate
            if (frames < pendingSize) System.arraycopy(pending, frames, pending, 0, pendingSize - frames)
            pendingSize -= frames
            drain(false)
        }
    }

    /** Zero samples for an intro card before the music begins. */
    fun feedSilence(frames: Int) {
        val silence = FloatArray(4096)
        var remaining = frames
        while (remaining > 0) {
            val n = min(silence.size, remaining)
            feed(silence, n)
            remaining -= n
        }
    }

    fun finish() {
        if (inputDone) return
        flushPending()
        val index = codec.dequeueInputBuffer(2_000L)
        if (index >= 0) {
            codec.queueInputBuffer(index, 0, 0, presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
        }
        var guard = 0
        while (guard++ < 400) {
            if (drain(true)) break
            Thread.sleep(5)
        }
    }

    fun release() {
        try { codec.stop() } catch (_: Exception) { Unit }
        try { codec.release() } catch (_: Exception) { Unit }
    }

    /** Queues any samples left over when the last PCM chunk was shorter than an AAC frame. */
    private fun flushPending() {
        var guard = 0
        while (pendingSize > 0 && guard++ < 200) {
            val index = codec.dequeueInputBuffer(2_000L)
            if (index < 0) { drain(false); continue }
            val buffer = codec.getInputBuffer(index) ?: break
            buffer.clear()
            val frames = min(buffer.capacity() / 4, pendingSize)
            for (i in 0 until frames) {
                val s = (pending[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort()
                buffer.putShort(s); buffer.putShort(s)
            }
            codec.queueInputBuffer(index, 0, frames * 4, presentationTimeUs, 0)
            presentationTimeUs += frames * 1_000_000L / sampleRate
            pendingSize -= frames
            if (pendingSize > 0) System.arraycopy(pending, frames, pending, 0, pendingSize)
            drain(false)
        }
    }

    private fun ensureCapacity(needed: Int) {
        if (needed <= pending.size) return
        pending = pending.copyOf(max(needed, pending.size * 2))
    }

    /** Returns true when the encoder signalled end-of-stream. */
    private fun drain(endOfStream: Boolean): Boolean {
        var eos = false
        while (true) {
            val index = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000L else 0L)
            if (index == MediaCodec.INFO_TRY_AGAIN_LATER) break
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                trackIndex = muxer.addTrack(codec.outputFormat)
                continue
            }
            if (index < 0) break
            val buffer = codec.getOutputBuffer(index)
            if (buffer != null && info.size > 0 && trackIndex >= 0) {
                muxer.write(trackIndex, buffer, info)
            }
            codec.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) { eos = true; break }
        }
        return eos
    }
}

/** Mixes an optional on-device TTS voiceover into the music PCM. */
class ExportAudioMixer(
    private val sampleRate: Int,
    private val voiceover: FloatArray?,
    private val musicGain: Float,
    private val speechGain: Float
) {
    private var absoluteFrame = 0L
    private val out = FloatArray(16 * 1024)

    fun mix(chunk: FloatArray, length: Int): Pair<FloatArray, Int> {
        if (length > out.size) return Pair(chunk, length)
        val voiceStart = 0L // voiceover is aligned to the start of the export range
        for (i in 0 until length) {
            val frame = absoluteFrame + i
            val vIndex = (frame - voiceStart).toInt()
            val speech = if (voiceover != null && vIndex in voiceover.indices) voiceover[vIndex] * speechGain else 0f
            out[i] = (chunk[i] * musicGain + speech).coerceIn(-1f, 1f)
        }
        absoluteFrame += length
        return Pair(out, length)
    }
}
