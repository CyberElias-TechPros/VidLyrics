package com.vidlyrics.studio.speech

import android.content.Context
import android.net.Uri
import com.vidlyrics.core.*
import com.vidlyrics.studio.media.decodeMono
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.lang.reflect.Method
import java.nio.FloatBuffer
import kotlin.math.max

/**
 * Optional, fully on-device speech alignment.
 *
 * The app ships a real DSP aligner and manual tap-sync, both of which need no
 * model. For users who want word-level accuracy, a bring-your-own CTC model
 * pack (wav2vec2-class ONNX export + its vocab.json) can be imported through
 * the Storage Access Framework. Nothing is downloaded: the app has NO INTERNET
 * permission. ONNX Runtime is accessed reflectively so the base app has no
 * hard dependency on a ~15 MB native library; if the library is not on the
 * classpath the UI says so and offers the model-free routes.
 */
interface SpeechEngine {
    val available: Boolean
    val label: String
    suspend fun transcribe(
        audio: File,
        durationUs: Microseconds,
        onProgress: (Float) -> Unit = {},
        shouldCancel: () -> Boolean = { false }
    ): SpeechResult
}

data class SpeechResult(
    val words: List<TranscriptWord> = emptyList(),
    val language: String? = null,
    val error: AppError? = null
) { val ok: Boolean get() = error == null && words.isNotEmpty() }

object NoModelSpeechEngine : SpeechEngine {
    override val available = false
    override val label = "No local speech pack"
    override suspend fun transcribe(audio: File, durationUs: Microseconds,
                                    onProgress: (Float) -> Unit, shouldCancel: () -> Boolean) = SpeechResult(
        error = AppError(
            code = "NO_SPEECH_PACK", title = "No speech model pack installed",
            detail = "Auto-sync already works from the audio signal, and tap-sync is exact. To add word-level machine alignment, import an ONNX CTC model and its vocab.json in Settings.",
            recovery = listOf(RecoveryRoute.MANUAL_TAP_SYNC, RecoveryRoute.SMALLER_MODEL, RecoveryRoute.DOCUMENTATION)))
}

/** Manages the two files that make up a model pack. */
object SpeechModelPack {
    private const val DIR = "modelpack"
    const val MODEL_FILE = "ctc.onnx"
    const val VOCAB_FILE = "vocab.json"

    fun dir(context: Context): File = File(context.filesDir, DIR).apply { mkdirs() }
    fun model(context: Context): File = File(dir(context), MODEL_FILE)
    fun vocab(context: Context): File = File(dir(context), VOCAB_FILE)

    data class Status(val installed: Boolean, val modelBytes: Long, val vocabSize: Int, val message: String)

    fun status(context: Context): Status {
        val m = model(context); val v = vocab(context)
        val vocab = readVocab(context)
        return when {
            !m.exists() -> Status(false, 0, 0, "No CTC model imported.")
            !v.exists() -> Status(false, m.length(), 0, "Model present, vocab.json missing.")
            vocab.isEmpty() -> Status(false, m.length(), 0, "vocab.json is empty or invalid.")
            else -> Status(true, m.length(), vocab.size,
                "CTC model ready (${Time.formatBytes(m.length())}, ${vocab.size} tokens).")
        }
    }

    fun readVocab(context: Context): List<String> {
        val f = vocab(context)
        if (!f.exists()) return emptyList()
        return try {
            val root = Json.parse(f.readText(Charsets.UTF_8))
            when {
                root.asArray != null -> root.asArray!!.map { it.asString ?: "" }
                root.asObject != null -> {
                    val map = root.asObject!!
                    val size = map.values.mapNotNull { it.asInt }.maxOrNull()?.plus(1) ?: 0
                    val out = MutableList(max(0, size)) { "" }
                    for ((token, indexValue) in map) {
                        val i = indexValue.asInt ?: continue
                        if (i in out.indices) out[i] = token
                    }
                    out
                }
                else -> emptyList()
            }
        } catch (_: Exception) { emptyList() }
    }

    suspend fun install(context: Context, uri: Uri, isVocab: Boolean): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val target = if (isVocab) vocab(context) else model(context)
            val tmp = File(target.parentFile, "${target.name}.tmp")
            context.contentResolver.openInputStream(uri)?.use { input ->
                tmp.outputStream().buffered().use { out -> input.copyTo(out, 64 * 1024) }
            } ?: return@withContext Result.failure(IllegalArgumentException("Cannot read the selected file"))
            tmp.renameTo(target) || tmp.copyTo(target, overwrite = true).let { tmp.delete(); true }
            if (isVocab && readVocab(context).isEmpty()) throw IllegalArgumentException("That file is not a valid vocab.json map or array.")
            Result.success(Unit)
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun remove(context: Context) = withContext(Dispatchers.IO) {
        model(context).delete(); vocab(context).delete()
    }
}

/**
 * Reflective ONNX Runtime adapter. Supports both the modern `ai.onnxruntime`
 * and the older `com.microsoft.onnxruntime` package names. The model is run on
 * overlapping 8-second windows of 16 kHz mono PCM; greedy CTC decoding happens
 * in the pure-Kotlin core (and is unit-tested there).
 */
class OnnxCtcEngine(private val context: Context) : SpeechEngine {
    private val pack = SpeechModelPack.status(context)
    override val available: Boolean get() = pack.installed && ortAvailable()
    override val label: String = if (available) "Local CTC pack (${pack.vocabSize} tokens)" else pack.message

    private var ortClasses: OrtClasses? = null

    private data class OrtClasses(
        val env: Any, val envClass: Class<*>, val sessionClass: Class<*>,
        val tensorClass: Class<*>, val optionsClass: Class<*>,
        val createSession: Method, val createFloatTensor: Method
    )

    private fun ortAvailable(): Boolean = try { loadClasses() != null } catch (_: Throwable) { false }

    private fun loadClasses(): OrtClasses? {
        ortClasses?.let { return it }
        val prefix = listOf("ai.onnxruntime", "com.microsoft.onnxruntime")
            .firstOrNull { try { Class.forName("$it.OrtEnvironment"); true } catch (_: Throwable) { false } }
            ?: return null
        val envClass = Class.forName("$prefix.OrtEnvironment")
        val optionsClass = Class.forName("$prefix.SessionOptions")
        val tensorClass = Class.forName("$prefix.OnnxTensor")
        val env = envClass.getMethod("getEnvironment").invoke(null)
        val createSession = envClass.methods.firstOrNull {
            it.name == "createSession" && it.parameterTypes.size == 2 &&
                it.parameterTypes[0] == ByteArray::class.java
        } ?: return null
        val createFloatTensor = tensorClass.methods.firstOrNull {
            it.name == "createFloatTensor" && it.parameterTypes.size == 3
        } ?: return null
        val sessionClass = Class.forName("$prefix.OrtSession")
        return OrtClasses(env, envClass, sessionClass, tensorClass, optionsClass,
            createSession, createFloatTensor).also { ortClasses = it }
    }

    override suspend fun transcribe(audio: File, durationUs: Microseconds,
                                    onProgress: (Float) -> Unit,
                                    shouldCancel: () -> Boolean): SpeechResult = withContext(Dispatchers.Default) {
        if (!available) return@withContext NoModelSpeechEngine.transcribe(audio, durationUs, onProgress, shouldCancel)
        val classes = loadClasses() ?: return@withContext SpeechResult(error = AppError(
            code = "ORT_MISSING", title = "ONNX Runtime is not installed",
            detail = "Add onnxruntime-android to the build to use a speech pack. Auto-sync and tap-sync work without it.",
            recovery = listOf(RecoveryRoute.MANUAL_TAP_SYNC, RecoveryRoute.DOCUMENTATION)))
        val vocab = SpeechModelPack.readVocab(context)
        val blankId = vocab.indexOf("").takeIf { it >= 0 }
            ?: vocab.indexOf("<pad>").takeIf { it >= 0 }
            ?: 0
        val session = try {
            val options = classes.optionsClass.getDeclaredConstructor().newInstance()
            classes.createSession.invoke(classes.env, SpeechModelPack.model(context).readBytes(), options)
        } catch (e: Throwable) {
            return@withContext SpeechResult(error = AppError(
                code = "MODEL_LOAD_FAILED", title = "Speech model could not be loaded",
                detail = "The ONNX file is incompatible with this runtime or device. Auto-sync and tap-sync still work.",
                technical = e.message,
                recovery = listOf(RecoveryRoute.MANUAL_TAP_SYNC, RecoveryRoute.SMALLER_MODEL)))
        }
        val allWords = ArrayList<TranscriptWord>()
        val windowSamples = 16_000 * 8
        val overlapSamples = 16_000 * 1
        val hopSamples = windowSamples - overlapSamples
        val window = FloatArray(windowSamples)
        var filled = 0
        var windowStartUs = 0L
        var processedUs = 0L
        try {
            decodeMono(audio, onChunk = { chunk, length ->
                if (shouldCancel()) return@decodeMono
                var offset = 0
                while (offset < length) {
                    val take = minOf(windowSamples - filled, length - offset)
                    System.arraycopy(chunk, offset, window, filled, take)
                    filled += take; offset += take
                    if (filled == windowSamples) {
                        val tokens = runWindow(classes, session, vocab, blankId, window)
                        val words = transcriptWords(tokens, 20_000L)
                            .map { it.copy(start = it.start + windowStartUs, end = it.end + windowStartUs) }
                        // Drop words inside the overlap that the next window repeats.
                        val limit = windowStartUs + (hopSamples * 1_000_000L / 16_000)
                        allWords += words.filter { it.start < limit }
                        processedUs = limit
                        if (durationUs > 0) onProgress((processedUs.toDouble() / durationUs).toFloat().coerceIn(0f, 1f))
                        System.arraycopy(window, hopSamples, window, 0, overlapSamples)
                        filled = overlapSamples
                        windowStartUs += hopSamples * 1_000_000L / 16_000
                    }
                }
            }, shouldCancel = shouldCancel, targetRate = 16_000)
            if (filled > 16_000 * 2) {
                val tail = window.copyOf(filled)
                val words = transcriptWords(runWindow(classes, session, vocab, blankId, tail), 20_000L)
                    .map { it.copy(start = it.start + windowStartUs, end = it.end + windowStartUs) }
                allWords += words.filter { it.start >= processedUs }
            }
            onProgress(1f)
            val deduped = allWords.distinctBy { "${it.text.lowercase()}|${it.start / 40_000}" }
            if (deduped.isEmpty()) SpeechResult(error = AppError.lowConfidence())
            else SpeechResult(deduped, language = null)
        } catch (e: Exception) {
            SpeechResult(error = AppError(code = "ASR_FAILED", title = "Local transcription failed",
                detail = "The model could not process this audio. Tap-sync is always available.",
                technical = e.message, recovery = listOf(RecoveryRoute.MANUAL_TAP_SYNC, RecoveryRoute.RETRY)))
        } finally {
            try { session.javaClass.getMethod("close").invoke(session) } catch (_: Throwable) { Unit }
        }
    }

    private fun runWindow(classes: OrtClasses, session: Any, vocab: List<String>,
                          blankId: Int, samples: FloatArray): List<CtcToken> {
        val tensor = classes.createFloatTensor.invoke(null, classes.env, samples,
            longArrayOf(1L, samples.size.toLong())) ?: return emptyList()
        val result: Any?
        try {
            val runMethod = classes.sessionClass.methods.firstOrNull {
                it.name == "run" && it.parameterTypes.size == 1 && Map::class.java.isAssignableFrom(it.parameterTypes[0])
            } ?: return emptyList()
            val inputName = try {
                session.javaClass.getMethod("getInputNames").invoke(session) as? Set<*>
            } catch (_: Throwable) { null }
            val name = (inputName?.firstOrNull() as? String) ?: "input_values"
            result = try { runMethod.invoke(session, mapOf(name to tensor)) }
            catch (_: Throwable) { runMethod.invoke(session, mapOf("input" to tensor)) }
            if (result == null) return emptyList()
            val intGet = result.javaClass.methods.firstOrNull { m ->
                m.name == "get" && m.parameterTypes.size == 1 &&
                    (m.parameterTypes[0] == Int::class.javaPrimitiveType || m.parameterTypes[0] == java.lang.Integer::class.java)
            }
            val stringGet = result.javaClass.methods.firstOrNull { m ->
                m.name == "get" && m.parameterTypes.size == 1 && m.parameterTypes[0] == String::class.java
            }
            val output = when {
                intGet != null -> intGet.invoke(result, 0)
                stringGet != null -> {
                    val names = try { session.javaClass.getMethod("getOutputNames").invoke(session) as? Set<*> } catch (_: Throwable) { null }
                    val firstName = names?.firstOrNull() as? String ?: "logits"
                    stringGet.invoke(result, firstName)
                }
                else -> null
            } ?: return emptyList()
            val buffer = output.javaClass.getMethod("getFloatBuffer").invoke(output) as? FloatBuffer
                ?: return emptyList()
            val logits = FloatArray(buffer.remaining())
            buffer.get(logits)
            val frames = logits.size / vocab.size
            return ctcGreedyDecode(logits, frames, vocab.size, blankId, vocab)
        } finally {
            try { tensor.javaClass.getMethod("close").invoke(tensor) } catch (_: Throwable) { Unit }
            Unit
        }
    }
}
