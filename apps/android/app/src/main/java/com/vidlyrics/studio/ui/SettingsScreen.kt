package com.vidlyrics.studio.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vidlyrics.core.EXPORT_PRESETS
import com.vidlyrics.core.Time
import com.vidlyrics.studio.VidLyricsApp
import com.vidlyrics.studio.speech.SpeechModelPack
import com.vidlyrics.studio.ui.components.LabeledSlider
import com.vidlyrics.studio.ui.components.SectionHeader
import com.vidlyrics.studio.ui.editor.EditorViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, viewModel: EditorViewModel = viewModel()) {
    val context = LocalContext.current
    val settings = (context.applicationContext as VidLyricsApp).settings
    val theme by settings.theme.collectAsState()
    val dynamic by settings.dynamicColor.collectAsState()
    val reduced by settings.reducedMotion.collectAsState()
    val haptics by settings.haptics.collectAsState()
    val guides by settings.showGuides.collectAsState()
    val heat by settings.showHeat.collectAsState()
    val simple by settings.simpleMode.collectAsState()
    val editor by viewModel.state.collectAsState()
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val pickModel = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            viewModel.installSpeechFile(uri, isVocab = false)
            note = "Model installed. Vocab.json is required before alignment can run."
        }
    }
    val pickVocab = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            viewModel.installSpeechFile(uri, isVocab = true)
            note = "Vocabulary installed."
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Settings") }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
        })
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)
            .verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {

            SectionHeader("Appearance", "Dark theme first; light is fully supported.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("dark" to "Dark", "light" to "Light", "system" to "System").forEach { (value, label) ->
                    FilterChip(selected = theme == value, onClick = { settings.setTheme(value) },
                        label = { Text(label) })
                }
            }
            SettingSwitch("Dynamic colour", "Use your wallpaper palette on Android 12+.", dynamic,
                settings::setDynamicColor)
            SettingSwitch("Reduced motion", "Disables decorative motion and long transitions.", reduced,
                settings::setReducedMotion)

            SectionHeader("Editing")
            SettingSwitch("Simple mode", "Hides advanced controls until you need them.", simple,
                settings::setSimpleMode)
            SettingSwitch("Safe-area guides", "Show platform overlays in the preview.", guides,
                settings::setShowGuides)
            SettingSwitch("Confidence heat", "Mark machine-timed lines that need review.", heat,
                settings::setShowHeat)
            SettingSwitch("Haptic feedback", "A short tick for each tap-sync beat.", haptics,
                settings::setHaptics)
            var compensation by remember { mutableIntStateOf(settings.tapCompensationMs) }
            LabeledSlider("Tap compensation", compensation.toFloat(), -200f..200f,
                { compensation = it.toInt(); settings.tapCompensationMs = it.toInt() },
                "${compensation} ms", description = "Tap compensation in milliseconds")
            Text("If your taps are consistently late, a positive value pulls every line earlier.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            var latency by remember { mutableIntStateOf(settings.audioLatencyMs) }
            LabeledSlider("Preview audio latency", latency.toFloat(), 0f..200f,
                { latency = it.toInt(); settings.audioLatencyMs = it.toInt() },
                "${latency} ms", description = "Preview audio latency")

            SectionHeader("Default export preset")
            var expanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                OutlinedTextField(
                    value = EXPORT_PRESETS.firstOrNull { it.id == settings.defaultPreset }?.label ?: "Custom",
                    onValueChange = {}, readOnly = true,
                    label = { Text("Preset for new projects") },
                    trailingIcon = { ExposedDropdownMenuBoxDefaults.TrailingIcon(expanded) },
                    modifier = Modifier.menuAnchor().fillMaxWidth())
                ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    EXPORT_PRESETS.forEach { preset ->
                        DropdownMenuItem(text = { Text("${preset.label} · ${preset.width}×${preset.height}") },
                            onClick = { settings.defaultPreset = preset.id; expanded = false })
                    }
                }
            }

            SectionHeader("Optional on-device speech pack",
                "Word-level alignment with a local CTC ONNX model. Never downloaded, never uploaded.")
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(editor.speechPackStatus.message, style = MaterialTheme.typography.bodyMedium)
                    if (editor.speechPackStatus.installed) {
                        Text("${editor.speechPackStatus.vocabSize} tokens · " +
                            Time.formatBytes(editor.speechPackStatus.modelBytes),
                            style = MaterialTheme.typography.labelMedium)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { pickModel.launch(arrayOf("*/*")) }) { Text("Import ctc.onnx") }
                        OutlinedButton(onClick = { pickVocab.launch(arrayOf("application/json", "text/plain", "*/*")) }) { Text("Import vocab.json") }
                    }
                    Text("Add onnxruntime-android to the app build to enable inference. Without it, auto-sync and tap-sync remain fully functional.",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (editor.speechPackStatus.installed) {
                        TextButton(onClick = {
                            scope.launch {
                                SpeechModelPack.remove(context); viewModel.refreshSpeechPack()
                            }
                        }) { Text("Remove model pack") }
                    }
                }
            }

            SectionHeader("Storage")
            Button(onClick = {
                scope.launch {
                    viewModel.store.clearAnalysisCache()
                    note = "Waveform cache cleared. Projects and audio are untouched."
                }
            }) { Text("Clear waveform cache") }
            Text("Only derived analysis files are removed. Source audio stays private to the app.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            SectionHeader("Privacy")
            Text("VidLyrics declares no INTERNET permission. Audio decoding, analysis, alignment, rendering and encoding all happen on this device. Project files never embed your song; they carry a SHA-256 manifest so the audio can be re-linked.",
                style = MaterialTheme.typography.bodyMedium)
            note?.let { Text(it, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SettingSwitch(title: String, subtitle: String, checked: Boolean,
                          onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange,
            modifier = Modifier.semantics { contentDescription = title })
    }
}
