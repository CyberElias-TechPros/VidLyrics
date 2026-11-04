package com.vidlyrics.core

/**
 * Theme library, aspect definitions and export presets.
 *
 * Ported from the web editor's design tokens so a project created on either
 * surface renders with the same palette, type scale and composition rules.
 * Colours are plain #RRGGBB / #AARRGGBB strings; Android resolves them with
 * Color.parseColor and the core stays platform-free.
 */
data class Theme(
    val id: String, val name: String, val blurb: String, val category: String,
    val swatches: List<String>, val background: BackgroundSpec,
    val typography: TypographySpec, val karaoke: KaraokeSpec, val motion: MotionSpec
)

private const val SANS = "sans-serif"
private const val DISPLAY = "sans-serif-medium"
private const val SERIF = "serif"
private const val MONO = "monospace"

private fun baseTypography(
    fontStack: String = SANS, weight: Int = 700, sizeRatio: Double = 0.058,
    color: String = "#F5F7FF", activeColor: String = "#FFD166",
    lineHeight: Double = 1.2, letterSpacing: Double = 0.0,
    uppercase: Boolean = false, shadowBlur: Double = 24.0,
    outlineWidth: Double = 0.0, anchor: VerticalAnchor = VerticalAnchor.CENTER
) = TypographySpec(
    fontStack = fontStack, weight = weight, sizeRatio = sizeRatio, lineHeight = lineHeight,
    letterSpacing = letterSpacing, align = TextAlign.CENTER, anchor = anchor,
    uppercase = uppercase, color = color, activeColor = activeColor,
    shadowBlur = shadowBlur, shadowColor = "#000000", shadowOffsetY = 0.0,
    outlineWidth = outlineWidth, outlineColor = "#000000"
)

private fun baseMotion(enter: MotionEnter = MotionEnter.RISE, exitUs: Microseconds = 220_000,
                       enterUs: Microseconds = 260_000, overlapUs: Microseconds = 120_000) = MotionSpec(
    enter = enter, exit = MotionExit.FADE, enterUs = enterUs, exitUs = exitUs,
    overlapUs = overlapUs, intensity = 1.0
)

val THEMES: List<Theme> = listOf(
    Theme(
        id = "midnight-neon", name = "Midnight Neon", category = "Modern",
        blurb = "Deep indigo with a warm gold highlight. Built for modern pop and worship.",
        swatches = listOf("#0D1024", "#4C3AE4", "#FFD166"),
        background = BackgroundSpec(BackgroundKind.GRADIENT, null, listOf("#080B1C", "#171C46", "#2B1D5B"), 0.18, 0.42, 0.25, 0.9),
        typography = baseTypography(), karaoke = KaraokeSpec(KaraokeMode.PROGRESSIVE, FillEase.SMOOTH, 0.6, 1.03, true, true),
        motion = baseMotion()
    ),
    Theme(
        id = "paper-ink", name = "Paper & Ink", category = "Editorial",
        blurb = "Quiet off-white with near-black type. Spoken word, ballads, acoustic sets.",
        swatches = listOf("#F4F1EA", "#1B1B1B", "#B5654A"),
        background = BackgroundSpec(BackgroundKind.SOLID, null, listOf("#F4F1EA"), 0.0, 0.0, 0.0, 0.0),
        typography = baseTypography(SERIF, 500, 0.056, "#1B1B1B", "#B5654A", lineHeight = 1.3, shadowBlur = 0.0),
        karaoke = KaraokeSpec(KaraokeMode.WORD, FillEase.SMOOTH, 0.0, 1.0, true, false),
        motion = baseMotion(MotionEnter.FADE, enterUs = 400_000)
    ),
    Theme(
        id = "sunset-mesh", name = "Sunset Mesh", category = "Modern",
        blurb = "Warm mesh gradient with slow drift. Warm vocals, indie, R&B.",
        swatches = listOf("#2B0F3A", "#FF7A45", "#FFD166"),
        background = BackgroundSpec(BackgroundKind.MESH, null, listOf("#2B0F3A", "#B4366B", "#FF7A45", "#FFD166"), 0.35, 0.38, 0.25, 0.8),
        typography = baseTypography(DISPLAY, 700, 0.06, "#FFF3E2", "#FFFFFF"),
        karaoke = KaraokeSpec(KaraokeMode.PROGRESSIVE, FillEase.SMOOTH, 0.5, 1.02, false, true),
        motion = baseMotion()
    ),
    Theme(
        id = "mono-brutal", name = "Mono Brutal", category = "Modern",
        blurb = "Oversized uppercase on flat black. Maximum legibility at 9:16 on a phone.",
        swatches = listOf("#000000", "#FFFFFF", "#F5F5F5"),
        background = BackgroundSpec(BackgroundKind.SOLID, null, listOf("#000000"), 0.0, 0.0, 0.0, 0.0),
        typography = baseTypography(MONO, 700, 0.072, "#FFFFFF", "#FFFFFF", lineHeight = 1.05, letterSpacing = -0.03, uppercase = true, shadowBlur = 0.0),
        karaoke = KaraokeSpec(KaraokeMode.WORD, FillEase.LINEAR, 0.0, 1.0, false, false),
        motion = MotionSpec(MotionEnter.CLIP, MotionExit.NONE, 200_000, 0, 0, 1.0)
    ),
    Theme(
        id = "aurora", name = "Aurora", category = "Cinematic",
        blurb = "Slow green-to-violet wash. Ambient, worship, cinematic instrumental.",
        swatches = listOf("#04121A", "#16A085", "#7B5CFF"),
        background = BackgroundSpec(BackgroundKind.MESH, null, listOf("#04121A", "#0D3B3F", "#16A085", "#7B5CFF"), 0.28, 0.45, 0.12, 0.7),
        typography = baseTypography(DISPLAY, 500, 0.06, "#EAF6F2", "#FFFFFF", shadowBlur = 28.0),
        karaoke = KaraokeSpec(KaraokeMode.PROGRESSIVE, FillEase.SMOOTH, 0.6, 1.02, true, false),
        motion = baseMotion(MotionEnter.BLUR, enterUs = 420_000)
    ),
    Theme(
        id = "cinema-classic", name = "Cinema Classic", category = "Cinematic",
        blurb = "Gold serif on black with a letterbox feel. Ballads and standards.",
        swatches = listOf("#000000", "#E8C87A", "#F7F3E8"),
        background = BackgroundSpec(BackgroundKind.GRADIENT, null, listOf("#000000", "#1A1408", "#000000"), 0.08, 0.3, 0.1, 0.4),
        typography = baseTypography(SERIF, 400, 0.058, "#F7F3E8", "#E8C87A", lineHeight = 1.3, shadowBlur = 20.0),
        karaoke = KaraokeSpec(KaraokeMode.WORD, FillEase.SMOOTH, 0.45, 1.01, true, false),
        motion = baseMotion(MotionEnter.FADE, enterUs = 400_000, exitUs = 300_000)
    ),
    Theme(
        id = "karaoke-stage", name = "Karaoke Stage", category = "Karaoke",
        blurb = "Bottom-anchored with a hard outline and strong fill. Built to sing along to.",
        swatches = listOf("#12062B", "#4C1D95", "#FBBF24"),
        background = BackgroundSpec(BackgroundKind.GRADIENT, null, listOf("#12062B", "#4C1D95", "#12062B"), 0.2, 0.55, 0.4, 0.9),
        typography = baseTypography(SANS, 800, 0.056, "#FFFFFF", "#FBBF24", shadowBlur = 16.0, outlineWidth = 6.0, anchor = VerticalAnchor.BOTTOM),
        karaoke = KaraokeSpec(KaraokeMode.PROGRESSIVE, FillEase.LINEAR, 0.7, 1.06, true, true),
        motion = MotionSpec(MotionEnter.RISE, MotionExit.FADE, 240_000, 220_000, 160_000, 1.0)
    ),
    Theme(
        id = "pulse-bars", name = "Pulse Bars", category = "Visualizer",
        blurb = "Live FFT bars behind the words. DJs, electronic and live sets.",
        swatches = listOf("#06131F", "#22D3EE", "#A855F7"),
        background = BackgroundSpec(BackgroundKind.VISUALIZER, null, listOf("#06131F", "#0E2A47", "#A855F7"), 0.1, 0.5, 0.5, 1.1),
        typography = baseTypography(SANS, 800, 0.062, "#FFFFFF", "#22D3EE", shadowBlur = 18.0),
        karaoke = KaraokeSpec(KaraokeMode.PROGRESSIVE, FillEase.SMOOTH, 0.8, 1.04, true, true),
        motion = baseMotion()
    )
)

fun getTheme(id: String): Theme = THEMES.firstOrNull { it.id == id } ?: THEMES[0]

fun designFromTheme(themeId: String, aspectId: AspectId = AspectId.R16_9): Design {
    val t = getTheme(themeId)
    return Design(
        themeId = t.id, aspectId = aspectId, customSize = null,
        background = t.background, typography = t.typography, karaoke = t.karaoke,
        motion = t.motion, brand = BrandSpec(), intro = CardSpec(), outro = CardSpec(), accent = null
    )
}

data class CompositionBox(
    val left: Float, val top: Float, val width: Float, val height: Float
) {
    val right: Float get() = left + width
    val bottom: Float get() = top + height
}

/** Platform UI overlays are respected rather than guessed at. */
fun contentBox(width: Int, height: Int, design: Design): CompositionBox {
    val a = design.aspectId
    val left = width * a.safeLeft
    val right = width * (1f - a.safeRight)
    val top = height * a.safeTop
    val bottom = height * (1f - a.safeBottom)
    return CompositionBox(left, top, maxOf(1f, right - left), maxOf(1f, bottom - top))
}

fun compositionSize(design: Design): Pair<Int, Int> {
    val custom = design.customSize
    return if (design.aspectId == AspectId.CUSTOM && custom != null) custom
    else Pair(design.aspectId.width, design.aspectId.height)
}

/** Even dimensions are required by H.264/HEVC encoders. */
fun evenize(n: Int): Int = if (n % 2 == 0) n else n - 1

data class ExportPreset(
    val id: String, val label: String, val platform: String, val aspectId: AspectId,
    val width: Int, val height: Int, val fps: Int, val videoBitrate: Int,
    val audioBitrate: Int, val note: String
)

val EXPORT_PRESETS: List<ExportPreset> = listOf(
    ExportPreset("youtube", "YouTube", "YouTube", AspectId.R16_9, 1920, 1080, 30, 8_000_000, 192_000, "Standard long-form upload."),
    ExportPreset("youtube-4k", "YouTube 4K", "YouTube", AspectId.R16_9, 3840, 2160, 30, 35_000_000, 256_000, "Needs a fast device; check the memory estimate first."),
    ExportPreset("youtube-shorts", "Shorts", "YouTube", AspectId.R9_16, 1080, 1920, 30, 10_000_000, 192_000, "Keep the hook inside the centre safe area."),
    ExportPreset("tiktok", "TikTok", "TikTok", AspectId.R9_16, 1080, 1920, 30, 10_000_000, 192_000, "The right-hand UI overlaps roughly 12% of the frame."),
    ExportPreset("instagram-reels", "Reels", "Instagram", AspectId.R9_16, 1080, 1920, 30, 10_000_000, 192_000, "The bottom 18% carries captions and CTAs."),
    ExportPreset("instagram-post", "Feed portrait", "Instagram", AspectId.R4_5, 1080, 1350, 30, 8_000_000, 192_000, "Feed-native portrait."),
    ExportPreset("instagram-square", "Square", "Instagram", AspectId.R1_1, 1080, 1080, 30, 8_000_000, 192_000, "Legacy feed format."),
    ExportPreset("facebook", "Facebook", "Facebook", AspectId.R16_9, 1280, 720, 30, 5_000_000, 128_000, "Smaller upload, faster processing."),
    ExportPreset("karaoke-room", "Karaoke Room", "General", AspectId.R16_9, 1920, 1080, 30, 10_000_000, 256_000, "Higher audio bitrate for sing-along playback."),
    ExportPreset("draft-720p", "Fast draft 720p", "General", AspectId.R16_9, 1280, 720, 24, 3_000_000, 128_000, "Quick proof before the final render."),
    ExportPreset("custom", "Custom", "General", AspectId.CUSTOM, 1280, 720, 30, 5_000_000, 160_000, "Set resolution, frame rate and bitrate yourself.")
)

fun getExportPreset(id: String): ExportPreset = EXPORT_PRESETS.firstOrNull { it.id == id } ?: EXPORT_PRESETS[0]

fun exportSettingsFromPreset(presetId: String, durationUs: Microseconds): ExportSettings {
    val p = getExportPreset(presetId)
    return ExportSettings(
        presetId = p.id, width = p.width, height = p.height, fps = p.fps,
        videoBitrate = p.videoBitrate, audioBitrate = p.audioBitrate,
        rangeStartUs = 0, rangeEndUs = durationUs
    )
}
