package com.vidlyrics.core

import java.util.UUID

/** Stable identifier generator. Only used for NEW domain objects, never for frames. */
fun newId(prefix: String = "id"): String = "$prefix-${UUID.randomUUID().toString().take(12)}"

const val PROJECT_FORMAT_VERSION: Int = 2 // wire-compatible with the web editor v2
const val APP_NAME: String = "VidLyrics"
const val APP_VERSION: String = "1.0.0-android"

/* ------------------------------------------------------------------ *
 * WIRING ENUMS
 *
 * `wire` is the on-disk spelling. It matches the web project format exactly,
 * so a .vidlyricsproject produced by the web editor opens in the Android app
 * and vice versa. Unknown values are refused by the codec, never guessed.
 * ------------------------------------------------------------------ */

enum class TimingSource(val wire: String) {
    HUMAN("human"), ALIGN("align"), ASR("asr"), ESTIMATE("estimate"), TAP("tap");
    companion object { fun fromWire(s: String): TimingSource = entries.firstOrNull { it.wire == s } ?: ESTIMATE }
}

enum class SectionKind(val wire: String) {
    INTRO("INTRO"), VERSE("VERSE"), PRE_CHORUS("PRE_CHORUS"), CHORUS("CHORUS"),
    HOOK("HOOK"), REFRAIN("REFRAIN"), BRIDGE("BRIDGE"), BREAKDOWN("BREAKDOWN"),
    INSTRUMENTAL("INSTRUMENTAL"), OUTRO("OUTRO"), UNKNOWN("UNKNOWN");
    companion object { fun fromWire(s: String): SectionKind = entries.firstOrNull { it.wire == s } ?: UNKNOWN }
}

enum class AspectId(val wire: String, val label: String, val width: Int, val height: Int,
                    val safeTop: Float, val safeRight: Float, val safeBottom: Float, val safeLeft: Float) {
    R16_9("16:9", "Landscape 16:9", 1920, 1080, 0.06f, 0.06f, 0.08f, 0.06f),
    R9_16("9:16", "Vertical 9:16", 1080, 1920, 0.10f, 0.08f, 0.20f, 0.08f),
    R1_1("1:1", "Square 1:1", 1080, 1080, 0.07f, 0.07f, 0.10f, 0.07f),
    R4_5("4:5", "Portrait 4:5", 1080, 1350, 0.08f, 0.07f, 0.14f, 0.07f),
    R4_3("4:3", "Classic 4:3", 1440, 1080, 0.06f, 0.06f, 0.08f, 0.06f),
    CUSTOM("custom", "Custom", 1280, 720, 0.06f, 0.06f, 0.08f, 0.06f);
    companion object { fun fromWire(s: String): AspectId = entries.firstOrNull { it.wire == s } ?: R16_9 }
}

enum class BackgroundKind(val wire: String) {
    GRADIENT("gradient"), IMAGE("image"), SOLID("solid"), MESH("mesh"), VISUALIZER("visualizer");
    companion object { fun fromWire(s: String): BackgroundKind = entries.firstOrNull { it.wire == s } ?: GRADIENT }
}

enum class TextAlign(val wire: String) {
    LEFT("left"), CENTER("center"), RIGHT("right");
    companion object { fun fromWire(s: String): TextAlign = entries.firstOrNull { it.wire == s } ?: CENTER }
}

enum class VerticalAnchor(val wire: String) {
    TOP("top"), CENTER("center"), BOTTOM("bottom");
    companion object { fun fromWire(s: String): VerticalAnchor = entries.firstOrNull { it.wire == s } ?: CENTER }
}

enum class KaraokeMode(val wire: String) {
    LINE("line"), WORD("word"), PROGRESSIVE("progressive"), NONE("none");
    companion object { fun fromWire(s: String): KaraokeMode = entries.firstOrNull { it.wire == s } ?: PROGRESSIVE }
}

enum class FillEase(val wire: String) {
    LINEAR("linear"), SMOOTH("smooth");
    companion object { fun fromWire(s: String): FillEase = entries.firstOrNull { it.wire == s } ?: SMOOTH }
}

enum class MotionEnter(val wire: String) {
    FADE("fade"), RISE("rise"), CLIP("clip"), BLUR("blur"), WORD_CASCADE("wordCascade"), NONE("none");
    companion object { fun fromWire(s: String): MotionEnter = entries.firstOrNull { it.wire == s } ?: FADE }
}

enum class MotionExit(val wire: String) {
    FADE("fade"), SINK("sink"), BLUR("blur"), NONE("none");
    companion object { fun fromWire(s: String): MotionExit = entries.firstOrNull { it.wire == s } ?: FADE }
}

enum class BrandPosition(val wire: String) {
    TOP_LEFT("top-left"), TOP_RIGHT("top-right"), BOTTOM_LEFT("bottom-left"), BOTTOM_RIGHT("bottom-right");
    companion object { fun fromWire(s: String): BrandPosition = entries.firstOrNull { it.wire == s } ?: BOTTOM_RIGHT }
}

enum class CodecId(val wire: String) {
    H264("h264"), VP9("vp9"), AV1("av1"), HEVC("hevc");
    companion object { fun fromWire(s: String): CodecId = entries.firstOrNull { it.wire == s } ?: H264 }
}

enum class LyricSource(val wire: String) {
    USER("user"), FILE("file"), ASR("asr"), EMPTY("empty");
    companion object { fun fromWire(s: String): LyricSource = entries.firstOrNull { it.wire == s } ?: USER }
}

/* ------------------------------------------------------------------ *
 * LYRICS
 * ------------------------------------------------------------------ */

data class Word(
    val id: String,
    /** Characters the user sees. Never rewritten destructively. */
    val text: String,
    /** Matching-only normalised form. Never displayed. */
    val norm: String,
    val start: Microseconds,
    val end: Microseconds,
    /** 0..1; 1 means a human set or confirmed it. */
    val confidence: Double = 0.3,
    val source: TimingSource = TimingSource.ESTIMATE,
    val locked: Boolean = false
)

/** Per-line style overrides. Null fields inherit from the theme. */
data class LineStyle(
    val sizeRatio: Double? = null,
    val weight: Int? = null,
    val color: String? = null,
    val uppercase: Boolean? = null,
    val align: TextAlign? = null
)

data class Line(
    val id: String,
    /** Original text exactly as imported/typed: display source of truth. */
    val text: String,
    val words: List<Word> = emptyList(),
    val start: Microseconds = 0,
    val end: Microseconds = 0,
    val sectionId: String? = null,
    val locked: Boolean = false,
    val style: LineStyle = LineStyle(),
    /** Duet / call-and-response voice. */
    val speaker: String? = null,
    /** Optional translated or romanised companion line, rendered beneath. */
    val translation: String? = null,
    val source: TimingSource = TimingSource.ESTIMATE,
    /** Absent/1 for human timing; lower for heuristic output. */
    val confidence: Double = 0.3
)

data class Section(val id: String, val kind: SectionKind, val label: String, val occurrence: Int)

/* ------------------------------------------------------------------ *
 * DESIGN
 * ------------------------------------------------------------------ */

data class BackgroundSpec(
    val kind: BackgroundKind = BackgroundKind.GRADIENT,
    val assetId: String? = null,
    val colors: List<String> = listOf("#101322", "#242b52"),
    /** Ken Burns / drift amount; 0 disables. */
    val motion: Double = 0.2,
    /** Darkening scrim behind text (readability floor). */
    val scrim: Double = 0.45,
    val visualizerBand: Double = 0.25,
    val visualizerGain: Double = 0.9
)

data class TypographySpec(
    val fontStack: String = "sans-serif",
    val weight: Int = 700,
    /** Font size as a fraction of composition height. */
    val sizeRatio: Double = 0.058,
    val lineHeight: Double = 1.2,
    val letterSpacing: Double = 0.0,
    val align: TextAlign = TextAlign.CENTER,
    val anchor: VerticalAnchor = VerticalAnchor.CENTER,
    val uppercase: Boolean = false,
    val color: String = "#FFFFFF",
    val activeColor: String = "#FFD166",
    val shadowBlur: Double = 24.0,
    val shadowColor: String = "#000000",
    val shadowOffsetY: Double = 0.0,
    /** Outline width in px at 1080p, scaled with the composition. */
    val outlineWidth: Double = 0.0,
    val outlineColor: String = "#000000"
)

data class KaraokeSpec(
    val mode: KaraokeMode = KaraokeMode.PROGRESSIVE,
    val fillEase: FillEase = FillEase.SMOOTH,
    val glow: Double = 0.6,
    val scale: Double = 1.03,
    val colorShift: Boolean = true,
    val beatAware: Boolean = false
)

data class MotionSpec(
    val enter: MotionEnter = MotionEnter.RISE,
    val exit: MotionExit = MotionExit.FADE,
    val enterUs: Microseconds = 260_000,
    val exitUs: Microseconds = 220_000,
    val overlapUs: Microseconds = 120_000,
    val intensity: Double = 1.0
)

data class BrandSpec(
    val enabled: Boolean = false,
    val text: String = "",
    val logoAssetId: String? = null,
    val position: BrandPosition = BrandPosition.BOTTOM_RIGHT,
    val opacity: Double = 0.85
)

data class CardSpec(
    val enabled: Boolean = false,
    val title: String = "",
    val subtitle: String = "",
    val durationUs: Microseconds = 3_000_000
)

data class Design(
    val themeId: String = "midnight-neon",
    val aspectId: AspectId = AspectId.R16_9,
    val customSize: Pair<Int, Int>? = null,
    val background: BackgroundSpec = BackgroundSpec(),
    val typography: TypographySpec = TypographySpec(),
    val karaoke: KaraokeSpec = KaraokeSpec(),
    val motion: MotionSpec = MotionSpec(),
    val brand: BrandSpec = BrandSpec(),
    val intro: CardSpec = CardSpec(),
    val outro: CardSpec = CardSpec(),
    /** Album-art derived accent colour. */
    val accent: String? = null
)

/* ------------------------------------------------------------------ *
 * AUDIO / ASSETS
 * ------------------------------------------------------------------ */

data class AudioMeta(
    val assetId: String,
    val fileName: String,
    val mimeType: String,
    val bytes: Long,
    val durationUs: Microseconds,
    val sampleRate: Int,
    val channels: Int,
    val peaksAssetId: String,
    /** SHA-256 of the file bytes; used for dedupe and re-linking on import. */
    val contentHash: String
)

data class AssetRecord(
    val id: String,
    val kind: String,
    val fileName: String,
    val mimeType: String,
    val bytes: Long,
    val contentHash: String,
    val createdAt: Long
)

data class VoiceoverMeta(
    val assetId: String,
    val fileName: String,
    val mimeType: String,
    val bytes: Long,
    val contentHash: String,
    val sampleRate: Int,
    val durationUs: Microseconds,
    val voiceId: String,
    val sourceSignature: String,
    val enabled: Boolean,
    val musicGain: Double,
    val speechGain: Double,
    val createdAt: Long
)

/* ------------------------------------------------------------------ *
 * EXPORT
 * ------------------------------------------------------------------ */

data class ExportSettings(
    val presetId: String = "youtube",
    val width: Int = 1920,
    val height: Int = 1080,
    val fps: Int = 30,
    val videoBitrate: Int = 8_000_000,
    val codec: CodecId = CodecId.H264,
    val audioBitrate: Int = 192_000,
    /** Applied at RENDER TIME only; never written back into stored timings. */
    val globalOffsetUs: Microseconds = 0,
    val rangeStartUs: Microseconds = 0,
    val rangeEndUs: Microseconds = 0,
    val includeAudio: Boolean = true,
    val fileName: String = ""
)

/* ------------------------------------------------------------------ *
 * PROJECT
 * ------------------------------------------------------------------ */

data class ProjectMeta(
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val language: String = "en",
    val notes: String = ""
)

data class LyricsState(
    val source: LyricSource = LyricSource.EMPTY,
    /** Raw text supplied by the user, preserved verbatim for re-parsing. */
    val originalText: String = "",
    val originalFileName: String? = null,
    val lines: List<Line> = emptyList()
)

data class EditorUiState(
    val mode: String = "simple",
    val zoomPxPerSecond: Double = 80.0,
    val selection: String? = null,
    val lastPlayheadUs: Microseconds = 0
)

data class Project(
    val formatVersion: Int = PROJECT_FORMAT_VERSION,
    val id: String = newId("proj"),
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
    val meta: ProjectMeta = ProjectMeta(),
    val audio: AudioMeta? = null,
    val voiceover: VoiceoverMeta? = null,
    val lyrics: LyricsState = LyricsState(),
    val sections: List<Section> = emptyList(),
    val design: Design = designFromTheme("midnight-neon"),
    val export: ExportSettings = ExportSettings(),
    val ui: EditorUiState = EditorUiState()
)

data class ProjectFile(
    val kind: String = "vidlyrics.project",
    val formatVersion: Int = PROJECT_FORMAT_VERSION,
    val appName: String = APP_NAME,
    val appVersion: String = APP_VERSION,
    val exportedAt: Long,
    val project: Project,
    /** Manifest only: binaries are NEVER embedded in a project file. */
    val assets: List<AssetRecord> = emptyList()
)

/* ------------------------------------------------------------------ *
 * ERRORS — every failure carries a route forward, never a dead end.
 * ------------------------------------------------------------------ */

enum class RecoveryRoute(val wire: String) {
    RETRY("retry"), MANUAL_TAP_SYNC("manual-tap-sync"), LOWER_RESOLUTION("lower-resolution"),
    SHORTER_RANGE("shorter-range"), SMALLER_MODEL("smaller-model"), REMOVE_PROJECT("remove-project"),
    UPDATE_APP("update-app"), TRY_DIFFERENT_FILE("try-different-file"), FREE_STORAGE("free-storage"),
    REIMPORT_AUDIO("reimport-audio"), DOCUMENTATION("documentation");
    companion object { fun fromWire(s: String): RecoveryRoute = entries.firstOrNull { it.wire == s } ?: RETRY }
}

data class AppError(
    val code: String,
    val title: String,
    val detail: String,
    val recovery: List<RecoveryRoute> = listOf(RecoveryRoute.RETRY),
    val technical: String? = null,
    val retryable: Boolean = true,
    val fatal: Boolean = false
) {
    companion object {
        fun unsupportedAudio(technical: String? = null) = AppError(
            code = "AUDIO_UNSUPPORTED", title = "This audio file can't be decoded",
            detail = "Your device has no decoder for this file, or the file is damaged. Try MP3, M4A/AAC, WAV, FLAC, OGG or Opus exported from a trusted source.",
            recovery = listOf(RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.DOCUMENTATION), technical = technical)

        fun storageFull() = AppError(
            code = "STORAGE_FULL", title = "Not enough free storage",
            detail = "The render needs room for the MP4 and its temporary audio. Free some space or export a shorter range at a lower resolution.",
            recovery = listOf(RecoveryRoute.FREE_STORAGE, RecoveryRoute.SHORTER_RANGE, RecoveryRoute.LOWER_RESOLUTION))

        fun encoderUnavailable(technical: String? = null) = AppError(
            code = "ENCODER_UNAVAILABLE", title = "No video encoder available",
            detail = "This device does not offer a hardware encoder for the chosen settings. Try the H.264 preset at 720p and 30 fps.",
            recovery = listOf(RecoveryRoute.LOWER_RESOLUTION, RecoveryRoute.UPDATE_APP), technical = technical)

        fun lowConfidence() = AppError(
            code = "ALIGN_LOW_CONFIDENCE", title = "Auto-sync isn't confident",
            detail = "The audio features don't line up cleanly with these lyrics. Tap-sync takes about one pass through the song and is always exact.",
            recovery = listOf(RecoveryRoute.MANUAL_TAP_SYNC, RecoveryRoute.RETRY), retryable = true)
    }
}
