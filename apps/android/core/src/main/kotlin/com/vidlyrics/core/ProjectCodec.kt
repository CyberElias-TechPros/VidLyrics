package com.vidlyrics.core

/**
 * Strict project (de)serialisation.
 *
 * Everything crossing a trust boundary — a .vidlyricsproject file opened from
 * the user's Downloads folder, a JSON blob restored from an older build, a
 * subtitle file pasted by the user — is parsed into a FIXED shape here. Unknown
 * keys are dropped, values are range-checked, and enums are whitelisted. No
 * reflection, no polymorphic deserialisation, no executable input.
 */
class ProjectValidationException(val issues: List<String>) :
    IllegalArgumentException(issues.firstOrNull() ?: "Invalid project file")

private class FieldReader(private val obj: Map<String, JsonValue>?, private val path: String,
                          private val issues: MutableList<String>) {
    private fun raw(key: String): JsonValue? = obj?.get(key)
    private fun issue(key: String, message: String) { issues += "$path.$key: $message" }

    fun s(key: String, max: Int, default: String = ""): String {
        val v = raw(key) ?: return default
        val text = v.asString
        if (text == null) { issue(key, "expected a string"); return default }
        if (text.length > max) { issue(key, "too long (max $max)"); return text.take(max) }
        return text
    }
    fun nullableS(key: String, max: Int): String? {
        val v = raw(key) ?: return null
        if (v is JsonValue.Null) return null
        return s(key, max)
    }
    fun l(key: String, min: Long = Long.MIN_VALUE, max: Long = Long.MAX_VALUE, default: Long = 0): Long {
        val v = raw(key) ?: return default
        val n = v.asLong
        if (n == null) { issue(key, "expected a finite number"); return default }
        if (n < min || n > max) { issue(key, "out of range [$min, $max]"); return n.coerceIn(min, max) }
        return n
    }
    fun d(key: String, min: Double = Double.NEGATIVE_INFINITY, max: Double = Double.POSITIVE_INFINITY,
          default: Double = 0.0): Double {
        val v = raw(key) ?: return default
        val n = v.asDouble
        if (n == null || !n.isFinite()) { issue(key, "expected a finite number"); return default }
        if (n < min || n > max) { issue(key, "out of range [$min, $max]"); return n.coerceIn(min, max) }
        return n
    }
    fun b(key: String, default: Boolean = false): Boolean {
        val v = raw(key) ?: return default
        return v.asBoolean ?: run { issue(key, "expected a boolean"); default }
    }
    fun a(key: String, maxItems: Int): List<JsonValue> {
        val v = raw(key) ?: return emptyList()
        val items = v.asArray ?: run { issue(key, "expected an array"); return emptyList() }
        if (items.size > maxItems) issue(key, "too many entries (max $maxItems)")
        return items.take(maxItems)
    }
    fun r(key: String): FieldReader = FieldReader(raw(key)?.asObject, "$path.$key", issues)
    fun has(key: String): Boolean = raw(key) != null && raw(key) !is JsonValue.Null
    inline fun <reified T> e(key: String, values: Map<String, T>, default: T): T {
        val v = raw(key)?.asString ?: return default
        return values[v] ?: run { issue(key, "unknown value '$v'"); default }
    }
}

/* ------------------------------ ENCODE ------------------------------ */

private fun colorsJson(colors: List<String>): JsonValue = jArr(colors.map(::jStr))

private fun encodeWord(w: Word): JsonValue = jObj(
    "id" to jStr(w.id), "text" to jStr(w.text), "norm" to jStr(w.norm),
    "start" to jNum(w.start), "end" to jNum(w.end), "confidence" to jNum(w.confidence),
    "source" to jStr(w.source.wire), "locked" to jBool(w.locked))

private fun encodeLineStyle(s: LineStyle): JsonValue = jObj(
    "sizeRatio" to (s.sizeRatio?.let(::jNum) ?: jNull()),
    "weight" to (s.weight?.let(::jNum) ?: jNull()),
    "color" to (s.color?.let(::jStr) ?: jNull()),
    "uppercase" to (s.uppercase?.let(::jBool) ?: jNull()),
    "align" to (s.align?.let { jStr(it.wire) } ?: jNull()))

private fun encodeLine(l: Line): JsonValue = jObj(
    "id" to jStr(l.id), "text" to jStr(l.text), "words" to jArr(l.words.map(::encodeWord)),
    "start" to jNum(l.start), "end" to jNum(l.end),
    "sectionId" to (l.sectionId?.let(::jStr) ?: jNull()), "locked" to jBool(l.locked),
    "style" to encodeLineStyle(l.style), "speaker" to (l.speaker?.let(::jStr) ?: jNull()),
    "translation" to (l.translation?.let(::jStr) ?: jNull()),
    "source" to jStr(l.source.wire), "confidence" to jNum(l.confidence))

private fun encodeBackground(b: BackgroundSpec): JsonValue = jObj(
    "kind" to jStr(b.kind.wire), "assetId" to (b.assetId?.let(::jStr) ?: jNull()),
    "colors" to colorsJson(b.colors), "motion" to jNum(b.motion), "scrim" to jNum(b.scrim),
    "visualizerBand" to jNum(b.visualizerBand), "visualizerGain" to jNum(b.visualizerGain))

private fun encodeTypography(t: TypographySpec): JsonValue = jObj(
    "fontStack" to jStr(t.fontStack), "weight" to jNum(t.weight), "sizeRatio" to jNum(t.sizeRatio),
    "lineHeight" to jNum(t.lineHeight), "letterSpacing" to jNum(t.letterSpacing),
    "align" to jStr(t.align.wire), "anchor" to jStr(t.anchor.wire), "uppercase" to jBool(t.uppercase),
    "color" to jStr(t.color), "activeColor" to jStr(t.activeColor),
    "shadowBlur" to jNum(t.shadowBlur), "shadowColor" to jStr(t.shadowColor),
    "shadowOffsetY" to jNum(t.shadowOffsetY), "outlineWidth" to jNum(t.outlineWidth),
    "outlineColor" to jStr(t.outlineColor))

private fun encodeKaraoke(k: KaraokeSpec): JsonValue = jObj(
    "mode" to jStr(k.mode.wire), "fillEase" to jStr(k.fillEase.wire),
    "glow" to jNum(k.glow), "scale" to jNum(k.scale),
    "colorShift" to jBool(k.colorShift), "beatAware" to jBool(k.beatAware))

private fun encodeMotion(m: MotionSpec): JsonValue = jObj(
    "enter" to jStr(m.enter.wire), "exit" to jStr(m.exit.wire),
    "enterUs" to jNum(m.enterUs), "exitUs" to jNum(m.exitUs),
    "overlapUs" to jNum(m.overlapUs), "intensity" to jNum(m.intensity))

private fun encodeBrand(b: BrandSpec): JsonValue = jObj(
    "enabled" to jBool(b.enabled), "text" to jStr(b.text),
    "logoAssetId" to (b.logoAssetId?.let(::jStr) ?: jNull()),
    "position" to jStr(b.position.wire), "opacity" to jNum(b.opacity))

private fun encodeCard(c: CardSpec): JsonValue = jObj(
    "enabled" to jBool(c.enabled), "title" to jStr(c.title),
    "subtitle" to jStr(c.subtitle), "durationUs" to jNum(c.durationUs))

private fun encodeDesign(d: Design): JsonValue = jObj(
    "themeId" to jStr(d.themeId), "aspectId" to jStr(d.aspectId.wire),
    "customSize" to (d.customSize?.let { jObj("width" to jNum(it.first), "height" to jNum(it.second)) } ?: jNull()),
    "background" to encodeBackground(d.background), "typography" to encodeTypography(d.typography),
    "karaoke" to encodeKaraoke(d.karaoke), "motion" to encodeMotion(d.motion),
    "brand" to encodeBrand(d.brand), "intro" to encodeCard(d.intro), "outro" to encodeCard(d.outro),
    "accent" to (d.accent?.let(::jStr) ?: jNull()))

private fun encodeAudio(a: AudioMeta): JsonValue = jObj(
    "assetId" to jStr(a.assetId), "fileName" to jStr(a.fileName), "mimeType" to jStr(a.mimeType),
    "bytes" to jNum(a.bytes), "durationUs" to jNum(a.durationUs), "sampleRate" to jNum(a.sampleRate),
    "channels" to jNum(a.channels), "peaksAssetId" to jStr(a.peaksAssetId),
    "contentHash" to jStr(a.contentHash))

private fun encodeVoiceover(v: VoiceoverMeta): JsonValue = jObj(
    "assetId" to jStr(v.assetId), "fileName" to jStr(v.fileName), "mimeType" to jStr(v.mimeType),
    "bytes" to jNum(v.bytes), "contentHash" to jStr(v.contentHash), "sampleRate" to jNum(v.sampleRate),
    "durationUs" to jNum(v.durationUs), "voiceId" to jStr(v.voiceId),
    "sourceSignature" to jStr(v.sourceSignature), "enabled" to jBool(v.enabled),
    "musicGain" to jNum(v.musicGain), "speechGain" to jNum(v.speechGain), "createdAt" to jNum(v.createdAt))

private fun encodeExport(e: ExportSettings): JsonValue = jObj(
    "presetId" to jStr(e.presetId), "width" to jNum(e.width), "height" to jNum(e.height),
    "fps" to jNum(e.fps), "videoBitrate" to jNum(e.videoBitrate), "codec" to jStr(e.codec.wire),
    "audioBitrate" to jNum(e.audioBitrate), "globalOffsetUs" to jNum(e.globalOffsetUs),
    "rangeStartUs" to jNum(e.rangeStartUs), "rangeEndUs" to jNum(e.rangeEndUs),
    "includeAudio" to jBool(e.includeAudio), "fileName" to jStr(e.fileName))

fun encodeProject(p: Project): JsonValue = jObj(
    "formatVersion" to jNum(p.formatVersion), "id" to jStr(p.id),
    "createdAt" to jNum(p.createdAt), "updatedAt" to jNum(p.updatedAt),
    "meta" to jObj("title" to jStr(p.meta.title), "artist" to jStr(p.meta.artist),
        "album" to jStr(p.meta.album), "language" to jStr(p.meta.language), "notes" to jStr(p.meta.notes)),
    "audio" to (p.audio?.let(::encodeAudio) ?: jNull()),
    "voiceover" to (p.voiceover?.let(::encodeVoiceover) ?: jNull()),
    "lyrics" to jObj("source" to jStr(p.lyrics.source.wire), "originalText" to jStr(p.lyrics.originalText),
        "originalFileName" to (p.lyrics.originalFileName?.let(::jStr) ?: jNull()),
        "lines" to jArr(p.lyrics.lines.map(::encodeLine))),
    "sections" to jArr(p.sections.map { jObj("id" to jStr(it.id), "kind" to jStr(it.kind.wire),
        "label" to jStr(it.label), "occurrence" to jNum(it.occurrence)) }),
    "design" to encodeDesign(p.design), "export" to encodeExport(p.export),
    "ui" to jObj("mode" to jStr(p.ui.mode), "zoomPxPerSecond" to jNum(p.ui.zoomPxPerSecond),
        "selection" to (p.ui.selection?.let(::jStr) ?: jNull()), "lastPlayheadUs" to jNum(p.ui.lastPlayheadUs)))

fun encodeAssetRecord(a: AssetRecord): JsonValue = jObj(
    "id" to jStr(a.id), "kind" to jStr(a.kind), "fileName" to jStr(a.fileName),
    "mimeType" to jStr(a.mimeType), "bytes" to jNum(a.bytes),
    "contentHash" to jStr(a.contentHash), "createdAt" to jNum(a.createdAt))

fun encodeProjectFile(f: ProjectFile): JsonValue = jObj(
    "kind" to jStr(f.kind), "formatVersion" to jNum(f.formatVersion),
    "app" to jObj("name" to jStr(f.appName), "version" to jStr(f.appVersion)),
    "exportedAt" to jNum(f.exportedAt), "project" to encodeProject(f.project),
    "assets" to jArr(f.assets.map(::encodeAssetRecord)))

/* ------------------------------ DECODE ------------------------------ */

private inline fun <T> wireMap(values: Array<T>, crossinline wire: (T) -> String): Map<String, T> =
    values.associateBy { wire(it) }

private fun decodeWord(v: JsonValue, issues: MutableList<String>, path: String): Word {
    val r = FieldReader(v.asObject, path, issues)
    return Word(
        id = r.s("id", 128, newId("w")), text = r.s("text", 4000),
        norm = r.s("norm", 4000), start = r.l("start", 0),
        end = r.l("end", 0), confidence = r.d("confidence", 0.0, 1.0, 0.3),
        source = r.e("source", wireMap(TimingSource.entries.toTypedArray()) { it.wire }, TimingSource.ESTIMATE),
        locked = r.b("locked"))
}

private fun decodeLine(v: JsonValue, issues: MutableList<String>, path: String): Line {
    val r = FieldReader(v.asObject, path, issues)
    val style = r.r("style")
    return Line(
        id = r.s("id", 128, newId("ln")), text = r.s("text", 4000),
        words = r.a("words", 600).mapIndexed { i, w -> decodeWord(w, issues, "$path.words[$i]") },
        start = r.l("start", 0), end = r.l("end", 0),
        sectionId = r.nullableS("sectionId", 128), locked = r.b("locked"),
        style = LineStyle(
            sizeRatio = if (style.has("sizeRatio")) style.d("sizeRatio", 0.01, 0.5) else null,
            weight = if (style.has("weight")) style.d("weight", 100.0, 900.0).toInt() else null,
            color = style.nullableS("color", 32),
            uppercase = if (style.has("uppercase")) style.b("uppercase") else null,
            align = if (style.has("align")) style.e("align", wireMap(TextAlign.entries.toTypedArray()) { it.wire }, TextAlign.CENTER) else null),
        speaker = r.nullableS("speaker", 8), translation = r.nullableS("translation", 4000),
        source = r.e("source", wireMap(TimingSource.entries.toTypedArray()) { it.wire }, TimingSource.ESTIMATE),
        confidence = r.d("confidence", 0.0, 1.0, 0.3))
}

private fun decodeColors(v: JsonValue?, default: List<String>): List<String> =
    (v?.asArray?.mapNotNull { it.asString }?.take(8) ?: default).ifEmpty { default }

private fun decodeBackground(v: JsonValue?, d: Design): BackgroundSpec {
    val o = v?.asObject
    val r = FieldReader(o, "design.background", mutableListOf())
    val base = d.background
    return BackgroundSpec(
        kind = r.e("kind", wireMap(BackgroundKind.entries.toTypedArray()) { it.wire }, base.kind),
        assetId = r.nullableS("assetId", 128),
        colors = decodeColors(o?.get("colors"), base.colors),
        motion = r.d("motion", 0.0, 2.0, base.motion), scrim = r.d("scrim", 0.0, 1.0, base.scrim),
        visualizerBand = r.d("visualizerBand", 0.0, 1.0, base.visualizerBand),
        visualizerGain = r.d("visualizerGain", 0.0, 4.0, base.visualizerGain))
}

private fun decodeTypography(v: JsonValue?, d: Design): TypographySpec {
    val o = v?.asObject
    val r = FieldReader(o, "design.typography", mutableListOf())
    val b = d.typography
    return TypographySpec(
        fontStack = r.s("fontStack", 512, b.fontStack), weight = r.d("weight", 100.0, 900.0, b.weight.toDouble()).toInt(),
        sizeRatio = r.d("sizeRatio", 0.01, 0.5, b.sizeRatio), lineHeight = r.d("lineHeight", 0.8, 3.0, b.lineHeight),
        letterSpacing = r.d("letterSpacing", -0.2, 0.5, b.letterSpacing),
        align = r.e("align", wireMap(TextAlign.entries.toTypedArray()) { it.wire }, b.align),
        anchor = r.e("anchor", wireMap(VerticalAnchor.entries.toTypedArray()) { it.wire }, b.anchor),
        uppercase = r.b("uppercase", b.uppercase), color = r.s("color", 64, b.color),
        activeColor = r.s("activeColor", 64, b.activeColor),
        shadowBlur = r.d("shadowBlur", 0.0, 200.0, b.shadowBlur),
        shadowColor = r.s("shadowColor", 64, b.shadowColor),
        shadowOffsetY = r.d("shadowOffsetY", -100.0, 100.0, b.shadowOffsetY),
        outlineWidth = r.d("outlineWidth", 0.0, 40.0, b.outlineWidth),
        outlineColor = r.s("outlineColor", 64, b.outlineColor))
}

private fun decodeKaraoke(v: JsonValue?, d: Design): KaraokeSpec {
    val r = FieldReader(v?.asObject, "design.karaoke", mutableListOf())
    val b = d.karaoke
    return KaraokeSpec(
        mode = r.e("mode", wireMap(KaraokeMode.entries.toTypedArray()) { it.wire }, b.mode),
        fillEase = r.e("fillEase", wireMap(FillEase.entries.toTypedArray()) { it.wire }, b.fillEase),
        glow = r.d("glow", 0.0, 2.0, b.glow), scale = r.d("scale", 0.8, 1.5, b.scale),
        colorShift = r.b("colorShift", b.colorShift), beatAware = r.b("beatAware", b.beatAware))
}

private fun decodeMotion(v: JsonValue?, d: Design): MotionSpec {
    val r = FieldReader(v?.asObject, "design.motion", mutableListOf())
    val b = d.motion
    return MotionSpec(
        enter = r.e("enter", wireMap(MotionEnter.entries.toTypedArray()) { it.wire }, b.enter),
        exit = r.e("exit", wireMap(MotionExit.entries.toTypedArray()) { it.wire }, b.exit),
        enterUs = r.l("enterUs", 0, 10_000_000, b.enterUs), exitUs = r.l("exitUs", 0, 10_000_000, b.exitUs),
        overlapUs = r.l("overlapUs", 0, 10_000_000, b.overlapUs),
        intensity = r.d("intensity", 0.0, 2.0, b.intensity))
}

private fun decodeCard(v: JsonValue?): CardSpec {
    val r = FieldReader(v?.asObject, "design.card", mutableListOf())
    return CardSpec(r.b("enabled"), r.s("title", 200), r.s("subtitle", 400), r.l("durationUs", 0, 60_000_000, 3_000_000))
}

private fun decodeDesign(v: JsonValue?, issues: MutableList<String>): Design {
    val o = v?.asObject
    val r = FieldReader(o, "design", issues)
    val base = designFromTheme(r.s("themeId", 64, "midnight-neon"))
    val custom = o?.get("customSize")?.asObject
    val brand = FieldReader(o?.get("brand")?.asObject, "design.brand", issues)
    return base.copy(
        aspectId = r.e("aspectId", wireMap(AspectId.entries.toTypedArray()) { it.wire }, base.aspectId),
        customSize = custom?.let {
            val cw = FieldReader(it, "design.customSize", issues)
            Pair(cw.d("width", 128.0, 7680.0, 1280.0).toInt(), cw.d("height", 128.0, 4320.0, 720.0).toInt())
        },
        background = decodeBackground(o?.get("background"), base),
        typography = decodeTypography(o?.get("typography"), base),
        karaoke = decodeKaraoke(o?.get("karaoke"), base),
        motion = decodeMotion(o?.get("motion"), base),
        brand = BrandSpec(brand.b("enabled"), brand.s("text", 200),
            brand.nullableS("logoAssetId", 128),
            brand.e("position", wireMap(BrandPosition.entries.toTypedArray()) { it.wire }, BrandPosition.BOTTOM_RIGHT),
            brand.d("opacity", 0.0, 1.0, 0.85)),
        intro = decodeCard(o?.get("intro")), outro = decodeCard(o?.get("outro")),
        accent = r.nullableS("accent", 64))
}

private fun decodeExport(v: JsonValue?, issues: MutableList<String>): ExportSettings {
    val r = FieldReader(v?.asObject, "export", issues)
    val base = ExportSettings()
    return ExportSettings(
        presetId = r.s("presetId", 64, base.presetId),
        width = r.d("width", 128.0, 7680.0, base.width.toDouble()).toInt(),
        height = r.d("height", 128.0, 4320.0, base.height.toDouble()).toInt(),
        fps = r.d("fps", 12.0, 60.0, base.fps.toDouble()).toInt(),
        videoBitrate = r.l("videoBitrate", 100_000, 80_000_000, base.videoBitrate.toLong()).toInt(),
        codec = r.e("codec", wireMap(CodecId.entries.toTypedArray()) { it.wire }, base.codec),
        audioBitrate = r.l("audioBitrate", 32_000, 512_000, base.audioBitrate.toLong()).toInt(),
        globalOffsetUs = r.l("globalOffsetUs", -86_400_000_000, 86_400_000_000, 0),
        rangeStartUs = r.l("rangeStartUs", 0, 86_400_000_000, 0),
        rangeEndUs = r.l("rangeEndUs", 0, 86_400_000_000, 0),
        includeAudio = r.b("includeAudio", true), fileName = r.s("fileName", 256))
}

private fun decodeAudio(v: JsonValue?, issues: MutableList<String>): AudioMeta? {
    val o = v?.asObject ?: return null
    val r = FieldReader(o, "audio", issues)
    return AudioMeta(
        assetId = r.s("assetId", 128), fileName = r.s("fileName", 512), mimeType = r.s("mimeType", 128),
        bytes = r.l("bytes", 0), durationUs = r.l("durationUs", 0),
        sampleRate = r.d("sampleRate", 1.0, 384000.0, 44100.0).toInt(),
        channels = r.d("channels", 1.0, 32.0, 1.0).toInt(),
        peaksAssetId = r.s("peaksAssetId", 128), contentHash = r.s("contentHash", 128))
}

private fun decodeVoiceover(v: JsonValue?, issues: MutableList<String>): VoiceoverMeta? {
    val o = v?.asObject ?: return null
    val r = FieldReader(o, "voiceover", issues)
    return VoiceoverMeta(
        assetId = r.s("assetId", 128), fileName = r.s("fileName", 512), mimeType = r.s("mimeType", 128),
        bytes = r.l("bytes", 0), contentHash = r.s("contentHash", 128),
        sampleRate = r.d("sampleRate", 1.0, 384000.0, 24000.0).toInt(),
        durationUs = r.l("durationUs", 0), voiceId = r.s("voiceId", 128),
        sourceSignature = r.s("sourceSignature", 128), enabled = r.b("enabled"),
        musicGain = r.d("musicGain", 0.0, 2.0, 1.0), speechGain = r.d("speechGain", 0.0, 2.0, 1.0),
        createdAt = r.l("createdAt", 0))
}

fun decodeProject(v: JsonValue): Project {
    val issues = mutableListOf<String>()
    val o = v.asObject
    if (o == null) throw ProjectValidationException(listOf("project: expected a JSON object"))
    val r = FieldReader(o, "project", issues)
    val formatVersion = r.l("formatVersion", 1, 1000, PROJECT_FORMAT_VERSION.toLong()).toInt()
    if (formatVersion > PROJECT_FORMAT_VERSION)
        throw ProjectValidationException(listOf("This project was written by a newer version of VidLyrics (format $formatVersion). Update the app to open it."))
    val meta = FieldReader(o["meta"]?.asObject, "project.meta", issues)
    val lyrics = FieldReader(o["lyrics"]?.asObject, "project.lyrics", issues)
    val ui = FieldReader(o["ui"]?.asObject, "project.ui", issues)
    val project = Project(
        formatVersion = PROJECT_FORMAT_VERSION,
        id = r.s("id", 128, newId("proj")),
        createdAt = r.l("createdAt", 0), updatedAt = r.l("updatedAt", 0),
        meta = ProjectMeta(meta.s("title", 300), meta.s("artist", 300), meta.s("album", 300),
            meta.s("language", 16, "en"), meta.s("notes", 8000)),
        audio = decodeAudio(o["audio"], issues), voiceover = decodeVoiceover(o["voiceover"], issues),
        lyrics = LyricsState(
            source = lyrics.e("source", wireMap(LyricSource.entries.toTypedArray()) { it.wire }, LyricSource.USER),
            originalText = lyrics.s("originalText", 200_000),
            originalFileName = lyrics.nullableS("originalFileName", 512),
            lines = lyrics.a("lines", 5000).mapIndexed { i, l -> decodeLine(l, issues, "project.lyrics.lines[$i]") }),
        sections = r.a("sections", 500).map { s ->
            val sr = FieldReader(s.asObject, "project.sections", issues)
            Section(sr.s("id", 128, newId("sec")),
                sr.e("kind", wireMap(SectionKind.entries.toTypedArray()) { it.wire }, SectionKind.UNKNOWN),
                sr.s("label", 64), sr.d("occurrence", 0.0, 999.0, 0.0).toInt())
        },
        design = decodeDesign(o["design"], issues),
        export = decodeExport(o["export"], issues),
        ui = EditorUiState(
            mode = if (ui.s("mode", 32, "simple") == "advanced") "advanced" else "simple",
            zoomPxPerSecond = ui.d("zoomPxPerSecond", 2.0, 4000.0, 80.0),
            selection = ui.nullableS("selection", 128),
            lastPlayheadUs = ui.l("lastPlayheadUs", 0)))
    if (issues.isNotEmpty()) throw ProjectValidationException(issues.take(40))
    return project
}

fun decodeProjectFile(v: JsonValue): ProjectFile {
    val issues = mutableListOf<String>()
    val o = v.asObject ?: throw ProjectValidationException(listOf("(root): expected a JSON object"))
    val r = FieldReader(o, "root", issues)
    val kind = r.s("kind", 64)
    if (kind != "vidlyrics.project") throw ProjectValidationException(listOf("Not a VidLyrics project file (kind='$kind')."))
    val app = FieldReader(o["app"]?.asObject, "root.app", issues)
    val projectValue = o["project"] ?: throw ProjectValidationException(listOf("Missing 'project' object."))
    val project = decodeProject(projectValue)
    val assets = r.a("assets", 200).map { a ->
        val ar = FieldReader(a.asObject, "root.assets", issues)
        AssetRecord(ar.s("id", 128), ar.s("kind", 32), ar.s("fileName", 512),
            ar.s("mimeType", 128), ar.l("bytes", 0), ar.s("contentHash", 128), ar.l("createdAt", 0))
    }
    return ProjectFile(kind, r.d("formatVersion", 1.0, 1000.0, PROJECT_FORMAT_VERSION.toDouble()).toInt(),
        app.s("name", 64, APP_NAME), app.s("version", 32, APP_VERSION),
        r.l("exportedAt", 0), project, assets)
}

fun parseProjectFile(text: String): ProjectFile {
    val root = try { Json.parse(text) } catch (e: JsonException) {
        throw ProjectValidationException(listOf("The file is not valid JSON: ${e.message}"))
    }
    return decodeProjectFile(root)
}

/** Summarise validation issues into one readable line for the import dialog. */
fun summariseIssues(issues: List<String>): String =
    if (issues.isEmpty()) "" else issues[0] + if (issues.size > 1) " (+${issues.size - 1} more)" else ""

/** Android app also writes a compact per-project snapshot; this is the same schema. */
fun encodeProjectString(p: Project): String = Json.stringify(encodeProject(p), pretty = false)
fun parseProjectString(text: String): Project = decodeProject(Json.parse(text))
