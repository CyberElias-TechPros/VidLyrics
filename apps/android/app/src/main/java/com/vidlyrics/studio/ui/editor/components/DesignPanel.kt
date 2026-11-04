package com.vidlyrics.studio.ui.editor.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vidlyrics.core.*
import com.vidlyrics.studio.ui.components.LabeledSlider
import com.vidlyrics.studio.ui.components.SectionHeader
import com.vidlyrics.studio.ui.editor.EditorState
import com.vidlyrics.studio.ui.editor.EditorViewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DesignPanel(state: EditorState, viewModel: EditorViewModel, modifier: Modifier = Modifier) {
    val design = state.project.design
    val advanced = !state.simpleMode
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) viewModel.importBackgroundImage(uri)
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {

        SectionHeader("Theme", "A complete starting point — change anything below.")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            THEMES.forEach { theme ->
                FilterChip(selected = design.themeId == theme.id,
                    onClick = { viewModel.setTheme(theme.id) },
                    label = { Text(theme.name, style = MaterialTheme.typography.labelMedium) })
            }
        }

        SectionHeader("Aspect ratio", "Sets both the preview and the export canvas.")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AspectId.entries.filter { it != AspectId.CUSTOM }.forEach { aspect ->
                FilterChip(selected = design.aspectId == aspect,
                    onClick = { viewModel.setAspect(aspect) },
                    label = { Text(aspect.label.split(" ").first()) })
            }
        }

        SectionHeader("Background")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            BackgroundKind.entries.forEach { kind ->
                FilterChip(selected = design.background.kind == kind,
                    onClick = { viewModel.setDesign { copy(background = background.copy(kind = kind)) } },
                    label = { Text(kind.wire.replaceFirstChar { it.uppercase() }) })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = { pickImage.launch(arrayOf("image/*")) }) { Text("Choose image") }
            OutlinedButton(onClick = { viewModel.setAccentFromAlbumArt() }) { Text("Album-art palette") }
        }
        ColorField("Colour 1", design.background.colors.getOrElse(0) { "#101322" }) { hex ->
            viewModel.setDesign { copy(background = background.copy(colors = background.colors.replaceColor(0, hex))) }
        }
        ColorField("Colour 2", design.background.colors.getOrElse(1) { "#242B52" }) { hex ->
            viewModel.setDesign { copy(background = background.copy(colors = background.colors.replaceColor(1, hex))) }
        }
        ColorField("Accent", design.accent ?: design.typography.activeColor) { hex ->
            viewModel.setDesign { copy(accent = hex) }
        }
        LabeledSlider("Drift motion", design.background.motion.toFloat(), 0f..1f,
            { viewModel.setDesign { copy(background = background.copy(motion = it.toDouble())) } },
            "${(design.background.motion * 100).toInt()}%")
        LabeledSlider("Scrim", design.background.scrim.toFloat(), 0f..1f,
            { viewModel.setDesign { copy(background = background.copy(scrim = it.toDouble())) } },
            "${(design.background.scrim * 100).toInt()}%")

        if (advanced) {
            SectionHeader("Typography")
            LabeledSlider("Font size", design.typography.sizeRatio.toFloat(), 0.02f..0.14f,
                { viewModel.setDesign { copy(typography = typography.copy(sizeRatio = it.toDouble())) } },
                "${(design.typography.sizeRatio * 100).toFixed(1)}% of height")
            LabeledSlider("Line height", design.typography.lineHeight.toFloat(), 0.9f..2f,
                { viewModel.setDesign { copy(typography = typography.copy(lineHeight = it.toDouble())) } },
                design.typography.lineHeight.toFixed(2).toString())
            LabeledSlider("Letter spacing", design.typography.letterSpacing.toFloat(), -0.1f..0.3f,
                { viewModel.setDesign { copy(typography = typography.copy(letterSpacing = it.toDouble())) } },
                design.typography.letterSpacing.toFixed(3).toString())
            ColorField("Text colour", design.typography.color) { hex ->
                viewModel.setDesign { copy(typography = typography.copy(color = hex)) }
            }
            ColorField("Karaoke colour", design.typography.activeColor) { hex ->
                viewModel.setDesign { copy(typography = typography.copy(activeColor = hex)) }
            }
            SettingToggle("Uppercase", design.typography.uppercase) {
                viewModel.setDesign { copy(typography = typography.copy(uppercase = it)) }
            }
            SettingToggle("Outline", design.typography.outlineWidth > 0) {
                viewModel.setDesign { copy(typography = typography.copy(outlineWidth = if (it) 0.012 else 0.0)) }
            }

            SectionHeader("Karaoke")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                KaraokeMode.entries.forEach { mode ->
                    FilterChip(selected = design.karaoke.mode == mode,
                        onClick = { viewModel.setDesign { copy(karaoke = karaoke.copy(mode = mode)) } },
                        label = { Text(mode.wire.replace('-', ' ')) })
                }
            }
            LabeledSlider("Glow", design.karaoke.glow.toFloat(), 0f..1f,
                { viewModel.setDesign { copy(karaoke = karaoke.copy(glow = it.toDouble())) } },
                "${(design.karaoke.glow * 100).toInt()}%")
            SettingToggle("Beat-aware fill", design.karaoke.beatAware) {
                viewModel.setDesign { copy(karaoke = karaoke.copy(beatAware = it)) }
            }

            SectionHeader("Motion")
            LabeledSlider("Enter duration", design.motion.enterUs / 1000f, 0f..1000f,
                { viewModel.setDesign { copy(motion = motion.copy(enterUs = (it * 1000).toLong())) } },
                "${design.motion.enterUs / 1000} ms")
            LabeledSlider("Exit duration", design.motion.exitUs / 1000f, 0f..1000f,
                { viewModel.setDesign { copy(motion = motion.copy(exitUs = (it * 1000).toLong())) } },
                "${design.motion.exitUs / 1000} ms")
        }

        SectionHeader("Intro & outro cards", "They extend the video; lyric timings stay put.")
        CardField("Intro", design.intro) { card -> viewModel.setDesign { copy(intro = card) } }
        CardField("Outro", design.outro) { card -> viewModel.setDesign { copy(outro = card) } }

        SectionHeader("Brand")
        SettingToggle("Show watermark", design.brand.enabled) {
            viewModel.setDesign { copy(brand = brand.copy(enabled = it)) }
        }
        if (design.brand.enabled) {
            ColorHexField("Brand text", design.brand.text, isColor = false) { text ->
                viewModel.setDesign { copy(brand = brand.copy(text = text)) }
            }
        }

        SectionHeader("Project details")
        ColorHexField("Title", state.project.meta.title, isColor = false) {
            viewModel.setMeta { copy(title = it) }
        }
        ColorHexField("Artist", state.project.meta.artist, isColor = false) {
            viewModel.setMeta { copy(artist = it) }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private fun List<String>.replaceColor(index: Int, hex: String): List<String> {
    val out = if (size <= index) MutableList(index + 1) { "#101322" } else toMutableList()
    out[index] = hex
    return out
}

@Composable
private fun ColorField(label: String, hex: String, onChange: (String) -> Unit) {
    ColorHexField(label, hex, isColor = true, onChange)
}

@Composable
private fun ColorHexField(label: String, value: String, isColor: Boolean, onChange: (String) -> Unit) {
    var raw by remember(value) { mutableStateOf(value) }
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        if (isColor) {
            val swatch = try { Color(android.graphics.Color.parseColor(raw)) }
            catch (_: Exception) { Color.Gray }
            Box(Modifier.size(28.dp).background(swatch, RoundedCornerShape(6.dp)))
            Spacer(Modifier.width(8.dp))
        }
        OutlinedTextField(value = raw, onValueChange = {
            raw = it
            if (!isColor || raw.matches(Regex("^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$"))) onChange(raw)
        }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth().weight(1f))
    }
}

@Composable
private fun SettingToggle(title: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun CardField(label: String, card: CardSpec, onChange: (CardSpec) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        SettingToggle("$label card", card.enabled) { onChange(card.copy(enabled = it)) }
        if (card.enabled) {
            ColorHexField("$label title", card.title, isColor = false) { onChange(card.copy(title = it)) }
            ColorHexField("$label subtitle", card.subtitle, isColor = false) { onChange(card.copy(subtitle = it)) }
            LabeledSlider("$label duration", card.durationUs / 1_000_000f, 0.5f..12f,
                { onChange(card.copy(durationUs = (it * 1_000_000).toLong())) },
                "${card.durationUs / 1_000_000} s")
        }
    }
}

private fun Double.toFixed(digits: Int): String = "%.${digits}f".format(java.util.Locale.US, this)
