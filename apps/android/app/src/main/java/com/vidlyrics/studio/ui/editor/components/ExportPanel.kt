package com.vidlyrics.studio.ui.editor.components

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.vidlyrics.core.*
import com.vidlyrics.studio.R
import com.vidlyrics.studio.export.RenderPhase
import com.vidlyrics.studio.export.RenderRepository
import com.vidlyrics.studio.ui.components.LabeledSlider
import com.vidlyrics.studio.ui.components.SectionHeader
import com.vidlyrics.studio.ui.editor.EditorState
import com.vidlyrics.studio.ui.editor.EditorViewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ExportPanel(state: EditorState, viewModel: EditorViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val settings = state.project.export
    val render = state.renderStatus
    val problems = validateExportSettings(settings)
    val estimate = estimateRender(settings)
    val duration = maxOf(1L, state.project.audio?.durationUs ?: settings.rangeEndUs)
    val advanced = !state.simpleMode

    var pendingSubtitle by remember { mutableStateOf<SubtitleFormat?>(null) }
    val createVideo = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("video/mp4")) { uri: Uri? ->
        viewModel.exportVideo(uri)
    }
    val createSubtitle = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri: Uri? ->
        val format = pendingSubtitle
        if (uri != null && format != null) viewModel.exportSubtitle(format, uri)
        pendingSubtitle = null
    }
    val createProject = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        if (uri != null) viewModel.exportProject(uri)
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {

        SectionHeader("Export preset", "Safe areas and bitrates chosen per platform.")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            EXPORT_PRESETS.take(9).forEach { preset ->
                FilterChip(selected = settings.presetId == preset.id,
                    onClick = {
                        viewModel.setExport {
                            copy(presetId = preset.id, width = preset.width, height = preset.height,
                                fps = preset.fps, videoBitrate = preset.videoBitrate,
                                audioBitrate = preset.audioBitrate)
                        }
                        viewModel.setAspect(preset.aspectId)
                    }, label = { Text(preset.label, style = MaterialTheme.typography.labelMedium) })
            }
        }
        getExportPreset(settings.presetId).note.let {
            Text(it, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (advanced) {
            SectionHeader("Video")
            LabeledSlider("Frame rate", settings.fps.toFloat(), 12f..60f,
                { viewModel.setExport { copy(fps = it.toInt()) } }, "${settings.fps} fps")
            LabeledSlider("Video bitrate", settings.videoBitrate / 1_000_000f, 0.5f..40f,
                { viewModel.setExport { copy(videoBitrate = (it * 1_000_000).toInt()) } },
                "${settings.videoBitrate / 1_000_000} Mbps")
            LabeledSlider("Audio bitrate", settings.audioBitrate / 1000f, 48f..320f,
                { viewModel.setExport { copy(audioBitrate = (it * 1000).toInt()) } },
                "${settings.audioBitrate / 1000} kbps")
            var codecOpen by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = codecOpen, onExpandedChange = { codecOpen = it }) {
                OutlinedTextField(value = codecLabel(settings.codec), onValueChange = {},
                    readOnly = true, label = { Text("Codec") },
                    trailingIcon = { ExposedDropdownMenuBoxDefaults.TrailingIcon(codecOpen) },
                    modifier = Modifier.menuAnchor().fillMaxWidth())
                ExposedDropdownMenu(expanded = codecOpen, onDismissRequest = { codecOpen = false }) {
                    CodecId.entries.forEach { codec ->
                        DropdownMenuItem(text = { Text(codecLabel(codec)) },
                            onClick = { viewModel.setExport { copy(codec = codec) }; codecOpen = false })
                    }
                }
            }
            Text("Unsupported codecs fall back automatically to an available hardware encoder.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Include audio", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Switch(checked = settings.includeAudio, onCheckedChange = {
                    viewModel.setExport { copy(includeAudio = it) }
                })
            }
        }

        SectionHeader("Range", "Render a short proof before the full video.")
        LabeledSlider("Start", settings.rangeStartUs / 1_000_000f, 0f..duration / 1_000_000f,
            { viewModel.setExport { copy(rangeStartUs = (it * 1_000_000).toLong()) } },
            Time.formatClock(settings.rangeStartUs))
        LabeledSlider("End", settings.rangeEndUs / 1_000_000f, 0f..duration / 1_000_000f,
            { viewModel.setExport { copy(rangeEndUs = (it * 1_000_000).toLong()) } },
            Time.formatClock(settings.rangeEndUs))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TextButton(onClick = { viewModel.setExport { copy(rangeStartUs = 0, rangeEndUs = duration) } }) {
                Text("Full song")
            }
            TextButton(onClick = { viewModel.setExport { copy(rangeEndUs = minOf(duration, rangeStartUs + 30_000_000)) } }) {
                Text("First 30 s")
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Before you render", style = MaterialTheme.typography.titleMedium)
                Text("${settings.width}×${settings.height} · ${settings.fps} fps · ${estimate.frames} frames",
                    style = MaterialTheme.typography.bodyMedium)
                Text("About ${Time.formatBytes(estimate.outputBytes)} · ~${Time.formatDuration(estimate.etaSeconds * 1_000_000L)} on this device",
                    style = MaterialTheme.typography.bodyMedium)
                estimate.warnings.forEach { Text("• $it", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.secondary) }
                if (problems.isNotEmpty()) {
                    problems.forEach { Text("• $it", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error) }
                }
            }
        }

        if (render.active) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.padding(14.dp)) {
                    Text(render.message.ifBlank { "Rendering…" }, style = MaterialTheme.typography.titleMedium)
                    LinearProgressIndicator(progress = { render.progress }, Modifier.fillMaxWidth().padding(vertical = 8.dp))
                    Text("${render.framesDone} / ${render.framesTotal} frames",
                        style = MaterialTheme.typography.labelMedium)
                    OutlinedButton(onClick = { RenderRepository.requestCancel() }) {
                        Icon(Icons.Default.Cancel, contentDescription = null)
                        Spacer(Modifier.width(6.dp)); Text("Stop render")
                    }
                }
            }
        } else {
            Button(onClick = { createVideo.launch(suggestedFileName(state.project, ".mp4")) },
                Modifier.fillMaxWidth().height(52.dp), enabled = problems.isEmpty() && !state.audioMissing) {
                Text("Render MP4")
            }
            if (state.audioMissing) {
                Text("Re-link the audio file before rendering with sound.",
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
            }
        }

        if (render.phase == RenderPhase.COMPLETE && render.resultUri != null) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(context.getString(R.string.render_complete), style = MaterialTheme.typography.titleMedium)
                        Text(render.message, style = MaterialTheme.typography.bodyMedium)
                    }
                    IconButton(onClick = {
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(render.resultUri, "video/mp4")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        try { context.startActivity(intent) } catch (_: Exception) { Unit }
                    }) { Icon(Icons.Default.Share, contentDescription = "Open video") }
                }
            }
        }

        SectionHeader("Also export")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SubtitleFormat.entries.forEach { format ->
                OutlinedButton(onClick = {
                    pendingSubtitle = format
                    createSubtitle.launch(suggestedFileName(state.project, format.extension))
                }) { Text(format.label) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = { createProject.launch(suggestedFileName(state.project, ".vidlyrics.json")) }) {
                Text("Project file")
            }
            OutlinedButton(onClick = { viewModel.synthesizeVoiceover() }) { Text("Add voiceover") }
        }
        if (state.project.voiceover != null) {
            TextButton(onClick = { viewModel.disableVoiceover() }) { Text("Remove voiceover") }
        }
        if (!state.speechPackStatus.installed) {
            Text("Optional: install a local CTC model in Settings for word-level alignment.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(24.dp))
    }
}
