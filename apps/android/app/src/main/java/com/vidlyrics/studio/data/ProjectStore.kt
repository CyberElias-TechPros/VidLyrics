package com.vidlyrics.studio.data

import android.content.Context
import android.net.Uri
import com.vidlyrics.core.*
import com.vidlyrics.studio.util.displayName
import com.vidlyrics.studio.util.mimeFor
import com.vidlyrics.studio.util.sha256Hex
import com.vidlyrics.studio.util.sizeBytes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

data class ProjectSummary(
    val id: String, val title: String, val artist: String, val updatedAt: Long,
    val durationUs: Microseconds, val lineCount: Int, val hasAudio: Boolean,
    val themeId: String, val aspectId: String
)

data class ImportedAsset(
    val assetId: String, val fileName: String, val mimeType: String,
    val bytes: Long, val contentHash: String, val file: File
)

/**
 * Local-first project storage. No server, no database engine, no ORM: one JSON
 * file per project plus content-addressed assets. Atomic replace prevents a
 * half-written autosave from destroying a project, and a separate recovery
 * snapshot restores the exact editor state after a crash or process kill.
 *
 * Why files rather than Room? A single-user local editor needs ACID writes, not
 * relational queries. A hand-written store has no schema migrations, survives
 * app updates, and is trivially inspectable/exportable. Every read validates
 * through the strict core codec.
 */
class ProjectStore(private val context: Context) {
    private val projectDir = File(context.filesDir, "projects")
    private val assetDir = File(context.filesDir, "assets")
    private val analysisDir = File(context.cacheDir, "analysis")
    private val recoveryFile = File(projectDir, "recovery.json")
    private val mutex = Mutex()

    init {
        projectDir.mkdirs(); assetDir.mkdirs(); analysisDir.mkdirs()
    }

    private fun projectFile(id: String) = File(projectDir, "$id.json")
    fun assetFile(assetId: String) = File(assetDir, assetId)
    fun audioFile(project: Project): File? = project.audio?.let { assetFile(it.assetId) }
    fun voiceoverFile(project: Project): File? = project.voiceover?.let { assetFile(it.assetId) }

    private fun atomicWrite(target: File, text: String) {
        val tmp = File(target.parentFile, "${target.name}.tmp")
        FileOutputStream(tmp).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        try {
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE)
        } catch (_: Exception) {
            // ATOMIC_MOVE is not supported on every filesystem; a plain replace
            // is still safe because the temp file is already complete.
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    suspend fun list(): List<ProjectSummary> = withContext(Dispatchers.IO) {
        mutex.withLock {
            projectDir.listFiles { f -> f.isFile && f.name.endsWith(".json") && f.name != "recovery.json" }
                ?.mapNotNull { f ->
                    try {
                        val p = parseProjectString(f.readText(Charsets.UTF_8))
                        ProjectSummary(p.id, p.meta.title, p.meta.artist, p.updatedAt,
                            p.audio?.durationUs ?: 0, p.lyrics.lines.size, p.audio != null,
                            p.design.themeId, p.design.aspectId.wire)
                    } catch (_: Exception) { null }
                }
                ?.sortedByDescending { it.updatedAt }
                ?: emptyList()
        }
    }

    suspend fun load(id: String): Project? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val f = projectFile(id)
            if (!f.exists()) return@withLock null
            try { parseProjectString(f.readText(Charsets.UTF_8)) } catch (_: Exception) { null }
        }
    }

    /** Autosave. Also refreshes the crash-recovery snapshot. */
    suspend fun save(project: Project) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val now = System.currentTimeMillis()
            val stamped = project.copy(updatedAt = now, formatVersion = PROJECT_FORMAT_VERSION)
            val text = encodeProjectString(stamped)
            atomicWrite(projectFile(stamped.id), text)
            atomicWrite(recoveryFile, text)
        }
    }

    /** Writes ONLY the recovery snapshot (used on every keystroke-level edit). */
    suspend fun saveRecovery(project: Project) = withContext(Dispatchers.IO) {
        mutex.withLock { atomicWrite(recoveryFile, encodeProjectString(project)) }
    }

    suspend fun loadRecovery(): Project? = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (!recoveryFile.exists()) return@withLock null
            try { parseProjectString(recoveryFile.readText(Charsets.UTF_8)) } catch (_: Exception) { null }
        }
    }

    suspend fun clearRecovery() = withContext(Dispatchers.IO) {
        mutex.withLock { recoveryFile.delete() }
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            projectFile(id).delete()
            garbageCollect()
        }
    }

    suspend fun duplicate(id: String): Project? = withContext(Dispatchers.IO) {
        val original = load(id) ?: return@withContext null
        val copy = original.copy(
            id = newId("proj"), createdAt = System.currentTimeMillis(),
            meta = original.meta.copy(title = original.meta.title + " (copy)"))
        save(copy)
        copy
    }

    /** Unreferenced binaries are removed when a project is deleted. */
    private fun garbageCollect() {
        val referenced = mutableSetOf<String>()
        projectDir.listFiles { f -> f.isFile && f.name.endsWith(".json") && f.name != "recovery.json" }
            ?.forEach { f ->
                try {
                    val p = parseProjectString(f.readText(Charsets.UTF_8))
                    p.audio?.let { referenced += it.assetId }
                    p.voiceover?.let { referenced += it.assetId }
                    if (p.design.background.assetId != null) referenced += p.design.background.assetId!!
                    if (p.design.brand.logoAssetId != null) referenced += p.design.brand.logoAssetId!!
                } catch (_: Exception) { Unit }
            }
        assetDir.listFiles()?.forEach { if (it.name !in referenced) it.delete() }
        analysisDir.listFiles()?.forEach { f ->
            if (referenced.none { f.name.startsWith(it) }) f.delete()
        }
    }

    /** Copy a SAF document into content-addressed private storage. */
    suspend fun importAsset(uri: Uri): ImportedAsset = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val name = uri.displayName(resolver)
        val declaredSize = uri.sizeBytes(resolver)
        val mime = resolver.getType(uri) ?: mimeFor(name, "application/octet-stream")
        val digest = MessageDigest.getInstance("SHA-256")
        val tmp = File.createTempFile("import-", ".bin", context.cacheDir)
        var bytes = 0L
        BufferedInputStream(resolver.openInputStream(uri) ?: error("Cannot open the selected file")).use { input ->
            FileOutputStream(tmp).use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    digest.update(buf, 0, n)
                    bytes += n
                }
            }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        val target = assetFile(hash)
        if (!target.exists()) {
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        } else tmp.delete()
        // Persistable read permission is unnecessary: the bytes are now private
        // to the app, so a later process death cannot orphan the project.
        try { resolver.releasePersistableUriPermission(uri, 0) } catch (_: Exception) { Unit }
        ImportedAsset(hash, name, mime, if (bytes > 0) bytes else declaredSize.coerceAtLeast(0), hash, target)
    }

    fun assetRecord(imported: ImportedAsset, kind: String): AssetRecord =
        AssetRecord(imported.assetId, kind, imported.fileName, imported.mimeType,
            imported.bytes, imported.contentHash, System.currentTimeMillis())

    suspend fun audioMissing(project: Project): Boolean = withContext(Dispatchers.IO) {
        project.audio != null && !assetFile(project.audio.assetId).exists()
    }

    /** Project file import: binaries are re-linked by SHA-256, never embedded. */
    suspend fun importProjectFile(uri: Uri): Pair<Project, Boolean> = withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)
            ?.use { it.readText() } ?: error("Cannot read the project file")
        val file = parseProjectFile(text)
        var missing = false
        var project = file.project.copy(
            id = newId("proj"), createdAt = System.currentTimeMillis(), updatedAt = System.currentTimeMillis())
        val audio = project.audio
        if (audio != null && !assetFile(audio.assetId).exists()) {
            // Try to re-link by content hash from another local project.
            val match = file.assets.firstOrNull { it.contentHash == audio.contentHash && assetFile(it.id).exists() }
            project = if (match != null) project.copy(audio = audio.copy(assetId = match.id))
            else { missing = true; project }
        }
        save(project)
        Pair(project, missing)
    }

    suspend fun exportProjectFileText(project: Project): String = withContext(Dispatchers.IO) {
        val assets = mutableListOf<AssetRecord>()
        project.audio?.let { a ->
            val f = assetFile(a.assetId)
            if (f.exists()) assets += AssetRecord(a.assetId, "audio", a.fileName, a.mimeType,
                f.length(), a.contentHash, System.currentTimeMillis())
        }
        project.voiceover?.let { v ->
            val f = assetFile(v.assetId)
            if (f.exists()) assets += AssetRecord(v.assetId, "audio", v.fileName, v.mimeType,
                f.length(), v.contentHash, System.currentTimeMillis())
        }
        serialiseProjectFile(buildProjectFile(project, assets))
    }

    /* --------------------- analysis cache (binary) --------------------- */

    private fun analysisFile(hash: String) = File(analysisDir, "${hash.take(24)}.vla")

    suspend fun writeAnalysis(hash: String, analysis: AudioAnalysis) = withContext(Dispatchers.IO) {
        val f = analysisFile(hash)
        DataOutputStream(FileOutputStream(f).buffered()).use { o ->
            o.writeBytes("VLA1")
            val p = analysis.peaks
            o.writeLong(p.bucketUs); o.writeInt(p.buckets); o.writeInt(p.sampleRate)
            o.writeInt(p.channels); o.writeLong(p.durationUs); o.writeFloat(p.peakAmplitude)
            for (v in p.data) o.writeFloat(v)
            val s = analysis.spectrum
            o.writeInt(s.frameCount); o.writeLong(s.frameUs); o.writeInt(s.fftSize)
            o.writeInt(s.bandCount)
            o.write(s.bands)
            for (v in s.bandMeans) o.writeFloat(v)
            val b = analysis.beatGrid
            o.writeBoolean(b != null)
            if (b != null) {
                o.writeDouble(b.bpm); o.writeDouble(b.confidence); o.writeLong(b.intervalUs)
                o.writeInt(b.beats.size); for (v in b.beats) o.writeLong(v)
            }
            o.writeInt(analysis.vocalActivity.size)
            for (v in analysis.vocalActivity) o.writeFloat(v)
            o.writeLong(analysis.frameUs); o.writeLong(analysis.durationUs)
        }
    }

    suspend fun readAnalysis(hash: String): AudioAnalysis? = withContext(Dispatchers.IO) {
        val f = analysisFile(hash)
        if (!f.exists()) return@withContext null
        try {
            DataInputStream(FileInputStream(f).buffered()).use { i ->
                val magic = ByteArray(4).also { i.readFully(it) }
                if (String(magic) != "VLA1") return@withContext null
                val bucketUs = i.readLong(); val buckets = i.readInt()
                if (buckets !in 0..2_000_000) return@withContext null
                val sampleRate = i.readInt(); val channels = i.readInt()
                val durationUs = i.readLong(); val peakAmp = i.readFloat()
                val peaks = FloatArray(buckets * 3) { i.readFloat() }
                val peakData = PeakData(peaks, buckets, bucketUs, durationUs, sampleRate, channels, peakAmp)
                val frameCount = i.readInt()
                if (frameCount !in 0..500_000) return@withContext null
                val frameUs = i.readLong(); val fftSize = i.readInt(); val bandCount = i.readInt()
                val bands = ByteArray(frameCount * bandCount).also { i.readFully(it) }
                val means = FloatArray(bandCount) { i.readFloat() }
                val env = SpectrumEnvelope(bands, frameCount, frameUs, sampleRate, fftSize, bandCount, means)
                val grid = if (i.readBoolean()) {
                    val bpm = i.readDouble(); val conf = i.readDouble(); val interval = i.readLong()
                    val n = i.readInt().coerceAtMost(200_000)
                    BeatGrid(bpm, List(n) { i.readLong() }, conf, interval)
                } else null
                val vocalN = i.readInt().coerceAtMost(500_000)
                val vocal = FloatArray(vocalN) { i.readFloat() }
                val analysisFrameUs = i.readLong(); val analysisDuration = i.readLong()
                AudioAnalysis(peakData, env, grid, vocal, analysisFrameUs, analysisDuration, sampleRate)
            }
        } catch (_: Exception) { null }
    }

    suspend fun clearAnalysisCache() = withContext(Dispatchers.IO) {
        analysisDir.listFiles()?.forEach { it.delete() }
    }
}
