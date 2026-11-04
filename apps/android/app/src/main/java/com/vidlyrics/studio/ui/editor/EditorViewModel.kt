package com.vidlyrics.studio.ui.editor

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vidlyrics.core.*
import com.vidlyrics.studio.R
import com.vidlyrics.studio.VidLyricsApp
import com.vidlyrics.studio.data.AppSettings
import com.vidlyrics.studio.data.ProjectStore
import com.vidlyrics.studio.export.OutputDelivery
import com.vidlyrics.studio.export.RenderRepository
import com.vidlyrics.studio.export.RenderService
import com.vidlyrics.studio.export.RenderStatus
import com.vidlyrics.studio.media.AudioDecodeException
import com.vidlyrics.studio.media.AudioProbe
import com.vidlyrics.studio.media.PlaybackController
import com.vidlyrics.studio.media.PlaybackState
import com.vidlyrics.studio.media.TextToSpeechVoiceover
import com.vidlyrics.studio.media.audioMetaFrom
import com.vidlyrics.studio.media.decodeMono
import com.vidlyrics.studio.media.paletteFrom
import com.vidlyrics.studio.media.probeAudio
import com.vidlyrics.studio.render.AndroidTextMeasurer
import com.vidlyrics.studio.render.AssetProvider
import com.vidlyrics.studio.render.FramePainter
import com.vidlyrics.studio.render.PreviewRenderer
import com.vidlyrics.studio.speech.OnnxCtcEngine
import com.vidlyrics.studio.speech.SpeechModelPack
import com.vidlyrics.studio.util.displayName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

enum class Panel { LYRICS, DESIGN, EXPORT }
enum class MediaPhase { IDLE, IMPORTING, ANALYZING, READY, FAILED }

data class Notice(val id: String = newId("n"), val kind: String, val title: String, val detail: String? = null)

data class EditorState(
    val project: Project = Project(),
    val loading: Boolean = true,
    val dirty: Boolean = false,
    val lastSavedAt: Long? = null,
    val lastAction: String = "",
    val undoAvailable: Boolean = false,
    val redoAvailable: Boolean = false,
    val mediaPhase: MediaPhase = MediaPhase.IDLE,
    val mediaProgress: Float = 0f,
    val mediaMessage: String = "",
    val analysis: AudioAnalysis? = null,
    val audioMissing: Boolean = false,
    val playback: PlaybackState = PlaybackState(),
    val tapSession: TapSession = TapSession(),
    val tapActive: Boolean = false,
    val selectedLineId: String? = null,
    val loop: Pair<Microseconds, Microseconds>? = null,
    val panel: Panel = Panel.LYRICS,
    val showGuides: Boolean = false,
    val showHeat: Boolean = true,
    val simpleMode: Boolean = true,
    val syncMessage: String = "",
    val notices: List<Notice> = emptyList(),
    val error: AppError? = null,
    val renderStatus: RenderStatus = RenderStatus(),
    val requestPickAudio: Boolean = false,
    val requestPickLyrics: Boolean = false,
    val requestPickImage: Boolean = false,
    val speechPackStatus: SpeechModelPack.Status = SpeechModelPack.Status(false, 0, 0, "Checking…")
)

/**
 * The editor's single source of truth.
 *
 * Every mutation goes through commit(), so undo/redo, autosave and crash
 * recovery stay consistent. The decoded PCM and the ExoPlayer instance are
 * deliberately NOT in this state: they are large objects that must never
 * trigger a recomposition. Playback publishes only a tiny position snapshot.
 */
class EditorViewModel(application: Application) : AndroidViewModel(application) {
    private val context: Application = application
    private val vidApp = application as VidLyricsApp
    val store: ProjectStore = vidApp.projectStore
    val settings: AppSettings = vidApp.settings
    private val playbackController = PlaybackController(context)
    private val assetProvider = AssetProvider(store)
    val painter: FramePainter = FramePainter(assetProvider)
    val previewRenderer = PreviewRenderer(painter)
    val speechEngine = OnnxCtcEngine(context)
    private val tts = TextToSpeechVoiceover(context)

    private val undoStack = ArrayDeque<Project>()
    private val redoStack = ArrayDeque<Project>()
    private var saveJob: Job? = null
    private var analysisJob: Job? = null

    private val _state = MutableStateFlow(EditorState(
        showGuides = settings.showGuides.value, showHeat = settings.showHeat.value,
        simpleMode = settings.simpleMode.value))
    val state: StateFlow<EditorState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            playbackController.state.collect { ps -> _state.update { it.copy(playback = ps) } }
        }
        viewModelScope.launch {
            RenderRepository.status.collect { rs -> _state.update { it.copy(renderStatus = rs) } }
        }
        refreshSpeechPack()
    }

    fun measureFor(project: Project): MeasureFn = AndroidTextMeasurer.factory(project.design.typography.fontStack)

    fun sceneFor(project: Project): Scene = buildScene(project, BuildSceneOptions(
        spectrum = _state.value.analysis?.spectrum, beatGrid = _state.value.analysis?.beatGrid))

    fun refreshSpeechPack() {
        _state.update { it.copy(speechPackStatus = SpeechModelPack.status(context)) }
    }

    /* --------------------------- lifecycle --------------------------- */

    fun load(projectId: String) = viewModelScope.launch {
        _state.update { it.copy(loading = true) }
        val p = store.load(projectId) ?: Project(id = projectId, createdAt = System.currentTimeMillis())
        settings.lastProjectId = p.id
        val missing = store.audioMissing(p)
        val cached = p.audio?.let { store.readAnalysis(it.contentHash) }
        if (!missing) {
            p.audio?.let { a -> playbackController.prepare(store.assetFile(a.assetId)) }
        }
        _state.update { it.copy(project = p, loading = false, analysis = cached, audioMissing = missing,
            tapSession = TapSession(compensationUs = settings.tapCompensationMs * Time.US_PER_MS)) }
        if (!missing && cached == null && p.audio != null) reanalyse(p)
    }

    fun createNew() = viewModelScope.launch {
        val p = Project(createdAt = System.currentTimeMillis(),
            export = exportSettingsFromPreset(settings.defaultPreset, 0))
        store.save(p)
        settings.lastProjectId = p.id
        load(p.id)
    }

    fun importProject(uri: Uri) = viewModelScope.launch {
        try {
            val (p, missing) = store.importProjectFile(uri)
            _state.update { it.copy(error = null) }
            if (missing) notify("warning", "Audio needs re-linking",
                "The project file has no embedded audio. Choose the original song to restore playback.")
            load(p.id)
        } catch (e: ProjectValidationException) {
            _state.update { it.copy(error = AppError(code = "PROJECT_INVALID", title = "That project file can't be opened",
                detail = summariseIssues(e.issues),
                recovery = listOf(RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.DOCUMENTATION))) }
        } catch (e: Exception) {
            _state.update { it.copy(error = AppError(code = "PROJECT_INVALID", title = "That project file can't be opened",
                detail = e.message ?: "Unknown error.", recovery = listOf(RecoveryRoute.TRY_DIFFERENT_FILE))) }
        }
    }

    /* ------------------------- command stack ------------------------- */

    private fun commit(label: String, mutate: (Project) -> Project) {
        val before = _state.value.project
        undoStack.addLast(before)
        while (undoStack.size > 120) undoStack.removeFirst()
        redoStack.clear()
        val next = mutate(before).copy(updatedAt = System.currentTimeMillis())
        _state.update { it.copy(project = next, dirty = true, undoAvailable = true,
            redoAvailable = false, lastAction = label) }
        scheduleSave()
    }

    private fun scheduleSave() {
        val snapshot = _state.value.project
        viewModelScope.launch { store.saveRecovery(snapshot) }
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(900)
            store.save(snapshot)
            _state.update { it.copy(dirty = false, lastSavedAt = System.currentTimeMillis()) }
        }
    }

    fun undo() {
        val previous = undoStack.removeLastOrNull() ?: return
        redoStack.addLast(_state.value.project)
        _state.update { it.copy(project = previous, undoAvailable = undoStack.isNotEmpty(),
            redoAvailable = true, lastAction = "Undo", dirty = true) }
        scheduleSave()
    }

    fun redo() {
        val next = redoStack.removeLastOrNull() ?: return
        undoStack.addLast(_state.value.project)
        _state.update { it.copy(project = next, redoAvailable = redoStack.isNotEmpty(),
            undoAvailable = true, lastAction = "Redo", dirty = true) }
        scheduleSave()
    }

    fun saveNow() = viewModelScope.launch {
        store.save(_state.value.project)
        _state.update { it.copy(dirty = false, lastSavedAt = System.currentTimeMillis()) }
        notify("success", "Project saved", "Everything is stored on this device.")
    }

    /* --------------------------- playback --------------------------- */

    fun togglePlay() = playbackController.toggle()
    fun seek(us: Microseconds) = playbackController.seek(us)
    fun nudgePlayhead(deltaUs: Microseconds) = playbackController.nudge(deltaUs)
    fun setSpeed(speed: Float) = playbackController.setSpeed(speed)
    fun setLoop(range: Pair<Microseconds, Microseconds>?) {
        playbackController.setLoop(range?.first, range?.second)
        _state.update { it.copy(loop = range) }
    }

    /* ---------------------------- audio ---------------------------- */

    fun importAudio(uri: Uri) = viewModelScope.launch {
        _state.update { it.copy(mediaPhase = MediaPhase.IMPORTING, mediaProgress = 0f,
            mediaMessage = "Copying audio into private storage…", error = null, requestPickAudio = false) }
        try {
            val imported = store.importAsset(uri)
            val probe: AudioProbe = withContext(Dispatchers.IO) { probeAudio(imported.file, imported.mimeType) }
            val meta = audioMetaFrom(imported, probe)
            commit("Add audio") { p ->
                val title = if (p.meta.title.isBlank()) probe.title.orEmpty() else p.meta.title
                val artist = if (p.meta.artist.isBlank()) probe.artist.orEmpty() else p.meta.artist
                val album = if (p.meta.album.isBlank()) probe.album.orEmpty() else p.meta.album
                val palette = paletteFrom(probe.embeddedArt)
                p.copy(
                    meta = p.meta.copy(title = title, artist = artist, album = album),
                    audio = meta,
                    design = if (palette.size >= 2) p.design.copy(accent = palette.last()) else p.design,
                    export = p.export.copy(rangeStartUs = 0, rangeEndUs = meta.durationUs))
            }
            playbackController.prepare(imported.file)
            _state.update { it.copy(audioMissing = false, mediaPhase = MediaPhase.ANALYZING,
                mediaProgress = 0f, mediaMessage = "Reading waveform, spectrum and beat grid…") }
            analysisJob?.cancel()
            analysisJob = launch {
                val analysis = computeAnalysis(imported.file, probe)
                store.writeAnalysis(meta.contentHash, analysis)
                _state.update { it.copy(analysis = analysis, mediaPhase = MediaPhase.READY,
                    mediaProgress = 1f, mediaMessage = "Audio ready") }
                notify("success", "Audio analysed",
                    "Waveform ready${analysis.beatGrid?.let { " · ${it.bpm.toInt()} BPM detected" } ?: ""}.")
            }
        } catch (e: AudioDecodeException) {
            _state.update { it.copy(mediaPhase = MediaPhase.FAILED, error = e.error) }
        } catch (e: Exception) {
            _state.update { it.copy(mediaPhase = MediaPhase.FAILED,
                error = AppError.unsupportedAudio(e.message)) }
        }
    }

    private suspend fun computeAnalysis(file: File, probe: AudioProbe): AudioAnalysis = withContext(Dispatchers.IO) {
        val rate = 22050
        val sink = AudioAnalysisSink(rate, 1)
        val expected = (probe.durationUs / 1_000_000.0 * rate).toLong().coerceAtLeast(1)
        var seen = 0L
        decodeMono(file, onChunk = { chunk, length ->
            sink.push(chunk, length)
            seen += length
            if (seen % (rate * 2) < length) {
                _state.update { it.copy(mediaProgress = (seen.toFloat() / expected).coerceIn(0f, 0.99f)) }
            }
        }, targetRate = rate, shouldCancel = { false })
        sink.finish()
    }

    private suspend fun reanalyse(p: Project) {
        val a = p.audio ?: return
        val file = store.assetFile(a.assetId)
        if (!file.exists()) return
        _state.update { it.copy(mediaPhase = MediaPhase.ANALYZING, mediaMessage = "Rebuilding waveform cache…") }
        try {
            val probe = withContext(Dispatchers.IO) { probeAudio(file, a.mimeType) }
            val analysis = computeAnalysis(file, probe)
            store.writeAnalysis(a.contentHash, analysis)
            _state.update { it.copy(analysis = analysis, mediaPhase = MediaPhase.READY) }
        } catch (e: Exception) {
            _state.update { it.copy(mediaPhase = MediaPhase.FAILED, error = AppError.unsupportedAudio(e.message)) }
        }
    }

    /* ---------------------------- lyrics ---------------------------- */

    fun setLyricsFromText(text: String) {
        if (text.isBlank()) return
        val duration = _state.value.project.audio?.durationUs
        val (lines, sections) = linesFromText(text, duration)
        commit("Replace lyrics") { p ->
            p.copy(lyrics = LyricsState(LyricSource.USER, text, null, lines), sections = sections)
        }
        notify("success", "Lyrics added", "${lines.size} lines ready to sync.")
    }

    fun importLyrics(uri: Uri) = viewModelScope.launch {
        _state.update { it.copy(requestPickLyrics = false) }
        try {
            val name = uri.displayName(context.contentResolver)
            val text = context.contentResolver.openInputStream(uri)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: return@launch
            val parsed = withContext(Dispatchers.Default) { parseLyrics(name, text) }
            val duration = _state.value.project.audio?.durationUs
            val lines = if (parsed.lines.any { it.start != null }) {
                val base = linesFromText(parsed.lines.joinToString("\n") { it.text }, duration).first
                postProcess(mergeParsedTimings(base, parsed.lines),
                    PostProcessOptions(durationUs = duration, applyLeadIn = true))
            } else linesFromText(text, duration).first
            if (lines.isEmpty()) {
                notify("warning", "No lyrics found", "That file had no readable lyric lines.")
                return@launch
            }
            commit("Import lyrics") { p ->
                p.copy(
                    meta = p.meta.copy(
                        title = if (p.meta.title.isBlank()) parsed.meta.title ?: "" else p.meta.title,
                        artist = if (p.meta.artist.isBlank()) parsed.meta.artist ?: "" else p.meta.artist),
                    lyrics = LyricsState(LyricSource.FILE, text, name, lines))
            }
            parsed.warnings.forEach { notify("warning", "Import note", it) }
            notify("success", "Imported ${parsed.format.wire.uppercase()}",
                "${lines.size} lines${if (parsed.lines.any { it.words.isNotEmpty() }) " with word timings" else ""}.")
        } catch (e: Exception) {
            _state.update { it.copy(error = AppError(code = "LYRICS_IMPORT_FAILED",
                title = "Could not read that lyric file",
                detail = e.message ?: "Unknown error.",
                recovery = listOf(RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.MANUAL_TAP_SYNC))) }
        }
    }

    fun updateLineText(lineId: String, text: String) = commit("Edit line") { p ->
        p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.map {
            if (it.id == lineId) rebuildWordsForLine(it, text) else it
        }))
    }

    fun setLineTime(lineId: String, start: Microseconds? = null, end: Microseconds? = null) =
        commit("Set line timing") { p ->
            p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.map { line ->
                if (line.id != lineId) return@map line
                val s = start ?: line.start
                val e = maxOf(s, end ?: line.end)
                val updated = line.copy(start = s, end = e, source = TimingSource.HUMAN,
                    confidence = 1.0, words = emptyList())
                updated.copy(words = interpolateWords(updated, s, e).map { it.copy(source = TimingSource.HUMAN, confidence = 1.0) })
            }))
        }

    fun nudgeLine(lineId: String, deltaUs: Microseconds) = commit("Nudge line") { p ->
        p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.map { line ->
            if (line.id != lineId || line.locked) return@map line
            val s = maxOf(0, line.start + deltaUs)
            val e = maxOf(s + 100_000, line.end + deltaUs)
            line.copy(start = s, end = e, words = line.words.map {
                it.copy(start = it.start + deltaUs, end = it.end + deltaUs)
            }, source = TimingSource.HUMAN, confidence = 1.0)
        }))
    }

    fun setGlobalOffset(offsetUs: Microseconds) = commit("Global offset") { p ->
        p.copy(export = p.export.copy(globalOffsetUs = offsetUs))
    }

    fun setLocked(lineId: String, locked: Boolean) = commit("Lock line") { p ->
        p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.map {
            if (it.id == lineId) it.copy(locked = locked) else it
        }))
    }

    fun setTranslation(lineId: String, translation: String?) = commit("Translation") { p ->
        p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.map {
            if (it.id == lineId) it.copy(translation = translation?.takeIf { it.isNotBlank() }) else it
        }))
    }

    fun setSpeaker(lineId: String, speaker: String?) = commit("Speaker") { p ->
        p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.map {
            if (it.id == lineId) it.copy(speaker = speaker) else it
        }))
    }

    fun deleteLine(lineId: String) = commit("Delete line") { p ->
        p.copy(lyrics = p.lyrics.copy(lines = p.lyrics.lines.filter { it.id != lineId }))
    }

    fun duplicateLine(lineId: String) = commit("Duplicate line") { p ->
        val lines = p.lyrics.lines.toMutableList()
        val index = lines.indexOfFirst { it.id == lineId }
        if (index < 0) return@commit p
        val source = lines[index]
        val copy = source.copy(id = newId("ln"), start = source.end + 100_000,
            end = source.end + (source.end - source.start) + 100_000,
            words = source.words.map { it.copy(id = newId("w")) })
        lines.add(index + 1, copy)
        p.copy(lyrics = p.lyrics.copy(lines = postProcess(lines, PostProcessOptions(durationUs = p.audio?.durationUs))))
    }

    fun insertLine(afterLineId: String?, text: String = "New line") = commit("Insert line") { p ->
        val lines = p.lyrics.lines.toMutableList()
        val index = afterLineId?.let { id -> lines.indexOfFirst { it.id == id } } ?: lines.lastIndex
        val at = if (index < 0) lines.size else index + 1
        val start = if (index in lines.indices) lines[index].end + 100_000 else (p.audio?.durationUs ?: 0)
        val line = createLine(text).copy(start = start, end = start + 2_000_000,
            source = TimingSource.HUMAN, confidence = 1.0)
        val withWords = line.copy(words = interpolateWords(line, line.start, line.end))
        lines.add(at.coerceAtMost(lines.size), withWords)
        p.copy(lyrics = p.lyrics.copy(lines = lines))
    }

    fun splitLine(lineId: String, wordIndex: Int) = commit("Split line") { p ->
        val lines = p.lyrics.lines.toMutableList()
        val index = lines.indexOfFirst { it.id == lineId }
        if (index < 0) return@commit p
        val line = lines[index]
        val tokens = highlightTokens(line.text)
        if (wordIndex <= 0 || wordIndex >= tokens.size) return@commit p
        val firstText = tokens.take(wordIndex).joinToString(" ") { it.text }
        val secondText = tokens.drop(wordIndex).joinToString(" ") { it.text }
        val mid = line.start + (line.end - line.start) / 2
        val a = createLine(firstText).copy(start = line.start, end = mid,
            source = TimingSource.HUMAN, confidence = 1.0, sectionId = line.sectionId)
        val b = createLine(secondText).copy(start = mid, end = line.end,
            source = TimingSource.HUMAN, confidence = 1.0, sectionId = line.sectionId)
        lines[index] = a.copy(words = interpolateWords(a, a.start, a.end))
        lines.add(index + 1, b.copy(words = interpolateWords(b, b.start, b.end)))
        p.copy(lyrics = p.lyrics.copy(lines = lines))
    }

    fun mergeWithNext(lineId: String) = commit("Merge lines") { p ->
        val lines = p.lyrics.lines.toMutableList()
        val index = lines.indexOfFirst { it.id == lineId }
        if (index < 0 || index + 1 >= lines.size) return@commit p
        val a = lines[index]; val b = lines[index + 1]
        val merged = createLine("${a.text} ${b.text}").copy(start = a.start, end = b.end,
            source = TimingSource.HUMAN, confidence = 1.0, sectionId = a.sectionId)
        lines[index] = merged.copy(words = interpolateWords(merged, merged.start, merged.end))
        lines.removeAt(index + 1)
        p.copy(lyrics = p.lyrics.copy(lines = lines))
    }

    /* ----------------------------- sync ----------------------------- */

    fun autoSync() {
        val analysis = _state.value.analysis
        val p = _state.value.project
        if (analysis == null || p.audio == null) {
            notify("warning", "Add audio first", "Auto-sync reads the song's waveform. Tap-sync works without analysis.")
            _state.update { it.copy(requestPickAudio = true) }
            return
        }
        if (p.lyrics.lines.isEmpty()) { notify("warning", "Add lyrics first", "Paste or import the words to sync."); return }
        viewModelScope.launch {
            _state.update { it.copy(syncMessage = "Detecting vocal onsets…") }
            val result = withContext(Dispatchers.Default) {
                alignLyricsToAudio(p.lyrics.lines, analysis, p.audio.durationUs)
            }
            commit("Auto-sync") { project ->
                project.copy(lyrics = project.lyrics.copy(lines = result.lines))
            }
            _state.update { it.copy(syncMessage = result.message) }
            if (result.confidence < 0.45) {
                _state.update { it.copy(error = AppError.lowConfidence()) }
            } else notify("success", "Auto-sync complete", result.message)
        }
    }

    fun alignWithSpeechPack() = viewModelScope.launch {
        val p = _state.value.project
        val file = store.audioFile(p)
        if (file == null || p.lyrics.lines.isEmpty()) {
            notify("warning", "Add audio and lyrics first", "The speech pack aligns words against lyrics you already have.")
            return@launch
        }
        _state.update { it.copy(syncMessage = "Running the local speech model…") }
        val result = speechEngine.transcribe(file, p.audio?.durationUs ?: 0,
            onProgress = { f -> _state.update { it.copy(syncMessage = "Local transcription ${(f * 100).toInt()}%") } })
        if (!result.ok) {
            _state.update { it.copy(syncMessage = "", error = result.error) }
            return@launch
        }
        val aligned = withContext(Dispatchers.Default) { reconcileTranscript(p.lyrics.lines, result.words) }
        commit("Speech alignment") { project -> project.copy(lyrics = project.lyrics.copy(lines = aligned.lines)) }
        _state.update { it.copy(syncMessage = aligned.message) }
        notify("success", "Word timings added", aligned.message)
    }

    /* --------------------------- tap-sync --------------------------- */

    fun startTap() {
        _state.update { it.copy(tapActive = true, error = null) }
        playbackController.seek(0)
        playbackController.play()
    }
    fun stopTap() {
        playbackController.pause()
        _state.update { it.copy(tapActive = false) }
    }
    /** Uses the AUDIO CLOCK, never wall time. */
    fun tapAt(): Long {
        val timeUs = playbackController.state.value.positionUs
        val next = reduceTap(_state.value.tapSession, TapCommand.TapAt(timeUs),
            _state.value.project.lyrics.lines.size)
        _state.update { it.copy(tapSession = next) }
        return timeUs
    }
    fun tapUndo() = _state.update { it.copy(tapSession = reduceTap(it.tapSession, TapCommand.Undo,
        it.project.lyrics.lines.size)) }
    fun tapReset() = _state.update { it.copy(tapSession = reduceTap(it.tapSession, TapCommand.Reset,
        it.project.lyrics.lines.size)) }
    fun setTapCompensation(ms: Int) {
        settings.tapCompensationMs = ms
        _state.update { it.copy(tapSession = reduceTap(it.tapSession,
            TapCommand.SetCompensation(ms * Time.US_PER_MS), it.project.lyrics.lines.size)) }
    }
    fun applyTaps() {
        val lines = _state.value.project.lyrics.lines
        val tapped = applyTaps(lines, _state.value.tapSession,
            _state.value.project.audio?.durationUs)
        commit("Apply tap-sync") { p -> p.copy(lyrics = p.lyrics.copy(lines =
            postProcess(tapped, PostProcessOptions(durationUs = p.audio?.durationUs)))) }
        _state.update { it.copy(tapActive = false) }
        notify("success", "Timing applied", "${_state.value.tapSession.taps.size} taps became exact line starts.")
    }

    /* ---------------------------- design ---------------------------- */

    fun setTheme(themeId: String) = commit("Change theme") { p ->
        p.copy(design = designFromTheme(themeId, p.design.aspectId))
    }
    fun setAspect(aspect: AspectId) = commit("Aspect ratio") { p ->
        val preset = EXPORT_PRESETS.firstOrNull { it.aspectId == aspect } ?: getExportPreset(p.export.presetId)
        p.copy(design = p.design.copy(aspectId = aspect),
            export = p.export.copy(width = preset.width, height = preset.height, presetId = preset.id))
    }
    fun setDesign(patch: Design.() -> Design) = commit("Design") { p -> p.copy(design = patch(p.design)) }
    fun setExport(patch: ExportSettings.() -> ExportSettings) = commit("Export settings") { p ->
        p.copy(export = patch(p.export))
    }
    fun setMeta(patch: ProjectMeta.() -> ProjectMeta) = commit("Project details") { p -> p.copy(meta = patch(p.meta)) }
    fun setPanel(panel: Panel) = _state.update { it.copy(panel = panel) }
    fun selectLine(id: String?) = _state.update { it.copy(selectedLineId = id) }
    fun toggleGuides() {
        val value = !_state.value.showGuides
        settings.setShowGuides(value)
        _state.update { it.copy(showGuides = value) }
    }
    fun toggleHeat() {
        val value = !_state.value.showHeat
        settings.setShowHeat(value)
        _state.update { it.copy(showHeat = value) }
    }
    fun setSimpleMode(value: Boolean) {
        settings.setSimpleMode(value)
        _state.update { it.copy(simpleMode = value) }
    }

    fun importBackgroundImage(uri: Uri) = viewModelScope.launch {
        _state.update { it.copy(requestPickImage = false) }
        try {
            val imported = store.importAsset(uri)
            setDesign { copy(background = background.copy(kind = BackgroundKind.IMAGE, assetId = imported.assetId)) }
            notify("success", "Background added", "Ken Burns drift is applied automatically.")
        } catch (e: Exception) {
            notify("warning", "Image could not be imported", e.message)
        }
    }

    fun setAccentFromAlbumArt() = viewModelScope.launch {
        val p = _state.value.project
        val file = store.audioFile(p) ?: return@launch
        val probe = try { withContext(Dispatchers.IO) { probeAudio(file, "audio/mp4") } } catch (_: Exception) { return@launch }
        val palette = paletteFrom(probe.embeddedArt)
        if (palette.size >= 2) {
            setDesign { copy(background = background.copy(colors = palette), accent = palette.last()) }
            notify("success", "Palette extracted", "Album art colours applied to the background.")
        } else notify("warning", "No artwork found", "This audio file has no embedded cover image.")
    }

    fun synthesizeVoiceover() = viewModelScope.launch {
        val p = _state.value.project
        val text = listOf(p.design.intro.title, p.design.intro.subtitle)
            .filter { it.isNotBlank() }.joinToString(". ").ifBlank {
                p.lyrics.lines.take(4).joinToString(". ") { it.text }
            }
        notify("info", "Generating voiceover", "Using the device's offline speech engine…")
        when (val result = tts.synthesize(text, p.meta.language, "voiceover-${p.id}.wav")) {
            is TextToSpeechVoiceover.Result.Success -> {
                commit("Voiceover") { it.copy(voiceover = result.meta) }
                notify("success", "Voiceover ready", "It will be mixed into the exported audio.")
            }
            is TextToSpeechVoiceover.Result.Failure -> {
                _state.update { it.copy(error = result.error) }
            }
        }
    }

    fun disableVoiceover() = commit("Remove voiceover") { it.copy(voiceover = null) }

    /* ---------------------------- export ---------------------------- */

    fun exportVideo(outputUri: Uri?) = viewModelScope.launch {
        val p = _state.value.project
        val problems = validateExportSettings(p.export)
        if (problems.isNotEmpty()) {
            _state.update { it.copy(error = AppError(code = "EXPORT_SETTINGS",
                title = "Check the export settings", detail = problems.joinToString(" "),
                recovery = listOf(RecoveryRoute.LOWER_RESOLUTION, RecoveryRoute.SHORTER_RANGE))) }
            return@launch
        }
        store.save(p) // the service reloads the project from disk
        RenderService.start(context, p.id, outputUri, suggestedFileName(p, ".mp4"))
        setPanel(Panel.EXPORT)
    }

    fun exportSubtitle(format: SubtitleFormat, uri: Uri) = viewModelScope.launch {
        val text = withContext(Dispatchers.Default) {
            serialiseSubtitle(_state.value.project, format,
                SubtitleOptions(offsetUs = _state.value.project.export.globalOffsetUs))
        }
        val ok = OutputDelivery.writeTextToUri(context, uri, text)
        notify(if (ok) "success" else "warning", if (ok) "${format.label} exported" else "Export failed",
            if (ok) "Saved to your chosen location." else "Choose another folder and try again.")
    }

    fun exportProject(uri: Uri) = viewModelScope.launch {
        val text = store.exportProjectFileText(_state.value.project)
        val ok = OutputDelivery.writeTextToUri(context, uri, text)
        notify(if (ok) "success" else "warning", if (ok) "Project exported" else "Export failed",
            "The file has no audio inside it; assets are re-linked by hash on import.")
    }

    fun installSpeechFile(uri: Uri, isVocab: Boolean) = viewModelScope.launch {
        val result = SpeechModelPack.install(context, uri, isVocab)
        if (result.isSuccess) {
            refreshSpeechPack()
            notify("success", "Model pack updated", SpeechModelPack.status(context).message)
        } else notify("warning", "Could not install that file", result.exceptionOrNull()?.message)
    }

    /* --------------------------- notices --------------------------- */

    fun notify(kind: String, title: String, detail: String? = null) {
        _state.update { it.copy(notices = it.notices + Notice(kind = kind, title = title, detail = detail)) }
    }
    fun dismissNotice(id: String) = _state.update { it.copy(notices = it.notices.filterNot { n -> n.id == id }) }
    fun clearError() = _state.update { it.copy(error = null) }
    fun consumePickRequests() = _state.update { it.copy(requestPickAudio = false,
        requestPickLyrics = false, requestPickImage = false) }

    /** Every error route is actionable. */
    fun onRecovery(route: RecoveryRoute) {
        clearError()
        when (route) {
            RecoveryRoute.MANUAL_TAP_SYNC -> { startTap(); setPanel(Panel.LYRICS) }
            RecoveryRoute.LOWER_RESOLUTION -> setExport {
                copy(width = 1280, height = 720, fps = 30, videoBitrate = 4_000_000, presetId = "draft-720p")
            }
            RecoveryRoute.SHORTER_RANGE -> setExport {
                copy(rangeEndUs = minOf(rangeEndUs, rangeStartUs + 60_000_000))
            }
            RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.REIMPORT_AUDIO ->
                _state.update { it.copy(requestPickAudio = true) }
            RecoveryRoute.RETRY -> notify("info", "Ready to retry", "Try the action again when you're ready.")
            RecoveryRoute.SMALLER_MODEL -> setPanel(Panel.EXPORT)
            RecoveryRoute.DOCUMENTATION -> notify("info", "Guide",
                context.getString(R.string.privacy_line))
            RecoveryRoute.FREE_STORAGE -> notify("info", "Free up space",
                "Delete unused renders and old audio caches in Settings, then render again.")
            else -> Unit
        }
    }

    override fun onCleared() {
        super.onCleared()
        playbackController.release()
        analysisJob?.cancel()
        saveJob?.cancel()
    }
}
