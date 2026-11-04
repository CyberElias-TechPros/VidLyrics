package com.vidlyrics.studio.media

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.vidlyrics.core.AppError
import com.vidlyrics.core.VoiceoverMeta
import com.vidlyrics.studio.util.sha256Hex
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Optional native voiceover: Android's on-device TextToSpeech engine renders a
 * spoken guide track (useful for accessibility, devotionals and spoken-word
 * intros) into a WAV file, which the export audio pipeline mixes with the song.
 *
 * This is a real platform capability, not a placeholder: no model download, no
 * network, no account. If no offline voice is installed the UI reports that and
 * the ordinary mix continues with music only.
 */
class TextToSpeechVoiceover(private val context: Context) {

    sealed interface Result {
        data class Success(val file: File, val meta: VoiceoverMeta) : Result
        data class Failure(val error: AppError) : Result
    }

    suspend fun synthesize(text: String, languageTag: String, fileName: String,
                           musicGain: Float = 1f, speechGain: Float = 1f): Result {
        if (text.isBlank()) return Result.Failure(AppError(
            code = "VOICEOVER_EMPTY", title = "Nothing to speak",
            detail = "Add an intro card or a lyric line before generating a voiceover."))
        var engine: TextToSpeech? = null
        try {
            val ready = suspendCancellableCoroutine<Boolean> { cont ->
                engine = TextToSpeech(context) { status ->
                    if (cont.isActive) cont.resume(status == TextToSpeech.SUCCESS)
                }
            }
            if (!ready) return Result.Failure(AppError(
                code = "TTS_UNAVAILABLE", title = "No offline speech engine",
                detail = "This device has no working text-to-speech engine. Install an offline voice in Android settings, or export without voiceover."))
            val tts = engine ?: return Result.Failure(AppError(
                code = "TTS_UNAVAILABLE", title = "No offline speech engine",
                detail = "Text-to-speech could not be started."))
            val locale = Locale.forLanguageTag(languageTag.ifBlank { "en" })
            val langResult = tts.setLanguage(locale)
            if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                return Result.Failure(AppError(
                    code = "TTS_LANG", title = "Voice for this language is missing",
                    detail = "Android has no offline voice for ${locale.displayLanguage}. Choose another language or export without voiceover."))
            }
            val temp = File(context.cacheDir, "tts-${System.currentTimeMillis()}.wav")
            val out = temp
            val done = suspendCancellableCoroutine<Boolean> { cont ->
                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit
                    override fun onDone(utteranceId: String?) { if (cont.isActive) cont.resume(true) }
                    @Deprecated("Legacy callback")
                    override fun onError(utteranceId: String?) { if (cont.isActive) cont.resume(false) }
                    override fun onError(utteranceId: String?, errorCode: Int) { if (cont.isActive) cont.resume(false) }
                })
                val params = Bundle().apply { putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, 3) }
                val status = tts.synthesizeToFile(text, params, out, "vidlyrics-voiceover")
                if (status != TextToSpeech.SUCCESS && cont.isActive) cont.resume(false)
            }
            if (!done || !out.exists() || out.length() < 44L) return Result.Failure(AppError(
                code = "TTS_FAILED", title = "Voiceover could not be generated",
                detail = "The speech engine returned no audio. Export without voiceover, or try again."))
            val bytes = out.readBytes()
            val hash = sha256Hex(bytes)
            val stored = File(context.filesDir, "assets/$hash")
            stored.parentFile?.mkdirs()
            out.copyTo(stored, overwrite = true)
            out.delete()
            val durationUs = try { probeAudio(stored, "audio/wav").durationUs } catch (_: Exception) { 0L }
            val meta = VoiceoverMeta(
                assetId = hash, fileName = fileName, mimeType = "audio/wav",
                bytes = bytes.size.toLong(), contentHash = hash,
                sampleRate = 24000, durationUs = durationUs, voiceId = "android-tts:${locale.toLanguageTag()}",
                sourceSignature = sha256Hex(text.toByteArray()), enabled = true,
                musicGain = musicGain.toDouble(), speechGain = speechGain.toDouble(),
                createdAt = System.currentTimeMillis())
            return Result.Success(stored, meta)
        } catch (e: Exception) {
            return Result.Failure(AppError(code = "TTS_FAILED", title = "Voiceover failed",
                detail = e.message ?: "Unknown text-to-speech error."))
        } finally {
            try { engine?.shutdown() } catch (_: Exception) { Unit }
        }
    }
}
