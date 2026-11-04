package com.vidlyrics.studio.export

import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.StatFs
import com.vidlyrics.core.*
import com.vidlyrics.studio.media.AudioDecodeException
import com.vidlyrics.studio.media.decodeMono
import com.vidlyrics.studio.render.AndroidTextMeasurer
import com.vidlyrics.studio.render.FramePainter
import java.io.File
import kotlin.math.ceil
import kotlin.math.min

data class RenderOutcome(val file: File? = null, val error: AppError? = null,
                         val cancelled: Boolean = false, val warning: AppError? = null) {
    val ok: Boolean get() = file != null && error == null
}

typealias RenderProgress = (framesDone: Long, framesTotal: Long, etaSeconds: Long, phase: RenderPhase) -> Unit

/**
 * The offline encoder. Frames are computed by the EXACT same pure core used by
 * the Compose preview, rasterised by the SAME FramePainter, uploaded through
 * EGL to the MediaCodec input Surface, and muxed with AAC audio into an MP4.
 *
 * Every failure is typed and carries a recovery route. A cancellation stops
 * cleanly and deletes the partial file. Nothing here touches the network.
 */
class VideoExporter {

    fun render(
        project: Project,
        audioFile: File?,
        analysis: AudioAnalysis?,
        voiceoverFile: File?,
        output: File,
        painter: FramePainter,
        onProgress: RenderProgress = { _, _, _, _ -> },
        shouldCancel: () -> Boolean = { false }
    ): RenderOutcome {
        val settings = project.export
        val problems = validateExportSettings(settings)
        if (problems.isNotEmpty()) return RenderOutcome(error = AppError(
            code = "EXPORT_SETTINGS", title = "Export settings need attention",
            detail = problems.joinToString(" "), recovery = listOf(RecoveryRoute.LOWER_RESOLUTION)))

        val width = evenize(settings.width)
        val height = evenize(settings.height)
        val fps = settings.fps
        val introUs = if (project.design.intro.enabled) project.design.intro.durationUs else 0
        val outroUs = if (project.design.outro.enabled) project.design.outro.durationUs else 0
        val rangeLen = settings.rangeEndUs - settings.rangeStartUs
        val totalFrames = ceil((rangeLen + introUs + outroUs) / 1_000_000.0 * fps).toLong()
        val estimate = estimateRender(settings)

        // Pre-flight: free space and encoder capability, BEFORE a 20-minute job.
        try {
            val stat = StatFs(output.parentFile?.absolutePath ?: "/")
            val free = stat.availableBlocksLong * stat.blockSizeLong
            if (free < estimate.outputBytes + 32L * 1024 * 1024) return RenderOutcome(error = AppError.storageFull())
        } catch (_: Exception) { Unit }

        val mime = chooseEncoderMime(settings.codec)
            ?: return RenderOutcome(error = AppError.encoderUnavailable("No hardware encoder for ${settings.codec.wire}"))

        val scene = buildScene(project, BuildSceneOptions(
            durationUs = rangeLen,
            // The trim is implemented by shifting the SCENE clock, never by
            // rewriting the project's stored timings.
            offsetUs = settings.globalOffsetUs - settings.rangeStartUs,
            width = width, height = height, fps = fps,
            spectrum = analysis?.spectrum, beatGrid = analysis?.beatGrid))
        val measure = AndroidTextMeasurer.factory(project.design.typography.fontStack)

        val audioEnabled = settings.includeAudio && audioFile != null && audioFile.exists()
        val muxer = MuxerController(output.absolutePath, if (audioEnabled) 2 else 1)
        val videoFormat = MediaFormat.createVideoFormat(mime, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, settings.videoBitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                setInteger(MediaFormat.KEY_LATENCY, 0)
            }
        }
        val videoCodec = try { MediaCodec.createEncoderByType(mime) }
        catch (e: Exception) { muxer.release(); return RenderOutcome(error = AppError.encoderUnavailable(e.message)) }
        var inputSurface: android.view.Surface? = null
        var egl: EglBridge? = null
        var bitmap: Bitmap? = null
        var audioEncoder: AudioTrackEncoder? = null
        var audioThread: Thread? = null
        val audioError = java.util.concurrent.atomic.AtomicReference<AppError?>(null)
        var videoTrackIndex = -1
        val info = MediaCodec.BufferInfo()
        val startedAt = System.nanoTime()

        fun drainVideo(endOfStream: Boolean): Boolean {
            var eos = false
            while (true) {
                val index = videoCodec.dequeueOutputBuffer(info, if (endOfStream) 10_000L else 0L)
                if (index == MediaCodec.INFO_TRY_AGAIN_LATER) break
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    videoTrackIndex = muxer.addTrack(videoCodec.outputFormat)
                    continue
                }
                if (index < 0) break
                val buffer = videoCodec.getOutputBuffer(index)
                if (buffer != null && info.size > 0 && videoTrackIndex >= 0) {
                    muxer.write(videoTrackIndex, buffer, info)
                }
                videoCodec.releaseOutputBuffer(index, false)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) { eos = true; break }
            }
            return eos
        }

        try {
            videoCodec.configure(videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            inputSurface = videoCodec.createInputSurface()
            videoCodec.start()
            egl = EglBridge(inputSurface, width, height)
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)

            // Audio runs on its own thread; the muxer synchronises the two.
            if (audioEnabled) {
                val encoder = AudioTrackEncoder(muxer, 44100, settings.audioBitrate)
                audioEncoder = encoder
                val voiceoverPcm = loadVoiceover(voiceoverFile)
                val musicGain = project.voiceover?.musicGain?.toFloat() ?: 1f
                val speechGain = project.voiceover?.speechGain?.toFloat() ?: 1f
                val mixer = ExportAudioMixer(44100, voiceoverPcm, musicGain, speechGain)
                audioThread = Thread {
                    try {
                        if (introUs > 0) encoder.feedSilence((introUs * 44100L / 1_000_000L).toInt())
                        decodeMono(audioFile!!, onChunk = { chunk, length ->
                            val (mixed, n) = mixer.mix(chunk, length)
                            encoder.feed(mixed, n)
                        }, shouldCancel = shouldCancel, targetRate = 44100,
                            rangeStartUs = settings.rangeStartUs, rangeEndUs = settings.rangeEndUs)
                        // Keep the audio track as long as the composition's
                        // outro card, so the MP4 has no abrupt A/V tail.
                        if (outroUs > 0) encoder.feedSilence((outroUs * 44100L / 1_000_000L).toInt())
                        encoder.finish()
                    } catch (e: AudioDecodeException) {
                        audioError.set(e.error)
                        muxer.expectFewerTracks()
                    } catch (e: Exception) {
                        audioError.set(AppError(code = "AUDIO_ENCODE_FAILED", title = "Audio could not be encoded",
                            detail = "The video was rendered without sound. Re-import the audio, or export again with sound off.",
                            technical = e.message, recovery = listOf(RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.RETRY)))
                        muxer.expectFewerTracks()
                    }
                }.also { it.start() }
            }

            onProgress(0, totalFrames, estimate.etaSeconds, RenderPhase.RENDERING)
            for (frame in 0 until totalFrames) {
                if (shouldCancel()) return RenderOutcome(cancelled = true)
                val timeUs = Time.frameToUs(frame, fps)
                val state = computeFrameState(scene, timeUs, measure,
                    ComputeOptions(showGuides = false, showHeat = false))
                painter.draw(canvas, state, scene, project)
                egl.render(bitmap, timeUs * 1_000L) // microseconds → nanoseconds
                drainVideo(false)
                if (frame % 10L == 0L || frame == totalFrames - 1) {
                    val elapsedSeconds = (System.nanoTime() - startedAt) / 1_000_000_000.0
                    val eta = if (frame > 0 && elapsedSeconds > 0.05)
                        ((elapsedSeconds / frame) * (totalFrames - frame)).toLong() else estimate.etaSeconds
                    onProgress(frame + 1, totalFrames, eta, RenderPhase.RENDERING)
                }
            }

            videoCodec.signalEndOfInputStream()
            var guard = 0
            while (guard++ < 500) {
                if (drainVideo(true)) break
                if (shouldCancel()) return RenderOutcome(cancelled = true)
            }
            onProgress(totalFrames, totalFrames, 0, RenderPhase.MUXING)
            audioThread?.join(20_000)
            muxer.forceStart()
            if (shouldCancel()) return RenderOutcome(cancelled = true)
            return RenderOutcome(file = output, warning = audioError.get())
        } catch (oom: OutOfMemoryError) {
            return RenderOutcome(error = AppError(
                code = "RENDER_OOM", title = "This device ran out of memory",
                detail = "The frame buffer is too large for this phone. Export at 720p, or render a shorter range.",
                technical = oom.message,
                recovery = listOf(RecoveryRoute.LOWER_RESOLUTION, RecoveryRoute.SHORTER_RANGE)))
        } catch (e: Exception) {
            return RenderOutcome(error = AppError(
                code = "RENDER_FAILED", title = "The render failed",
                detail = "Something went wrong while encoding. Try a lower resolution or a shorter range; your project is safe.",
                technical = e.message,
                recovery = listOf(RecoveryRoute.LOWER_RESOLUTION, RecoveryRoute.SHORTER_RANGE, RecoveryRoute.RETRY)))
        } finally {
            try { audioEncoder?.release() } catch (_: Exception) { Unit }
            try { videoCodec.stop() } catch (_: Exception) { Unit }
            try { videoCodec.release() } catch (_: Exception) { Unit }
            try { egl?.release() } catch (_: Exception) { Unit }
            try { inputSurface?.release() } catch (_: Exception) { Unit }
            try { bitmap?.recycle() } catch (_: Exception) { Unit }
            muxer.release()
            if (shouldCancel()) output.delete()
        }
    }

    private fun chooseEncoderMime(requested: CodecId): String? {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        fun available(mime: String) = list.codecInfos.any { info ->
            info.isEncoder && info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
        }
        val primary = codecMime(requested)
        if (available(primary)) return primary
        return listOf(CodecId.H264, CodecId.HEVC, CodecId.VP9, CodecId.AV1)
            .map(::codecMime).firstOrNull(::available)
    }

    /** Voiceover is short by design; collecting it into RAM keeps mixing simple. */
    private fun loadVoiceover(file: File?): FloatArray? {
        if (file == null || !file.exists()) return null
        return try {
            val out = ArrayList<Float>(44100 * 10)
            decodeMono(file, onChunk = { chunk, length ->
                for (i in 0 until length) out += chunk[i]
            }, targetRate = 44100)
            out.toFloatArray().takeIf { it.isNotEmpty() }
        } catch (_: Exception) { null }
    }
}
