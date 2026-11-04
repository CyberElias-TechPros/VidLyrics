package com.vidlyrics.studio.ui.editor.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vidlyrics.core.Line
import com.vidlyrics.core.Time
import com.vidlyrics.core.TimingSource
import com.vidlyrics.core.tapProgress
import com.vidlyrics.studio.data.AppSettings
import com.vidlyrics.studio.ui.components.LabeledSlider
import com.vidlyrics.studio.ui.editor.EditorState
import com.vidlyrics.studio.ui.editor.EditorViewModel
import com.vidlyrics.studio.util.tickHaptic

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LyricsPanel(state: EditorState, viewModel: EditorViewModel, settings: AppSettings,
                modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val project = state.project
    val lines = project.lyrics.lines
    var pasteOpen by remember { mutableStateOf(false) }
    var pasteText by remember { mutableStateOf(project.lyrics.originalText) }
    var advanced by remember { mutableStateOf(!state.simpleMode) }
    val pickLyrics = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) viewModel.importLyrics(uri)
    }

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = { pickLyrics.launch(arrayOf("text/plain", "application/json", "*/*")) },
                modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.FolderOpen, contentDescription = null)
                Spacer(Modifier.width(4.dp)); Text("Import file")
            }
            OutlinedButton(onClick = { pasteText = project.lyrics.originalText; pasteOpen = true },
                modifier = Modifier.weight(1f)) { Text("Paste / edit text") }
        }
        Text("LRC, Enhanced LRC, SRT, VTT, ASS, TXT, timed JSON or plain lyrics.",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))

        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = { viewModel.autoSync() }, modifier = Modifier.weight(1f)) { Text("Auto-sync") }
            OutlinedButton(onClick = { viewModel.alignWithSpeechPack() }, modifier = Modifier.weight(1f)) {
                Text("Words (model)")
            }
        }
        if (state.syncMessage.isNotBlank()) {
            Text(state.syncMessage, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 14.dp))
        }

        TapSyncSection(state, viewModel, settings, context)

        LabeledSlider("Global offset", project.export.globalOffsetUs / 1000f, -3000f..3000f,
            { viewModel.setGlobalOffset((it * 1000).toLong()) },
            "${project.export.globalOffsetUs / 1000} ms", description = "Global timing offset")
        Text("Shifts every lyric at render time without rewriting stored timings.",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 14.dp))

        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text("${lines.size} lines", style = MaterialTheme.typography.titleMedium)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Advanced", style = MaterialTheme.typography.labelMedium)
                Switch(checked = advanced, onCheckedChange = { advanced = it })
            }
        }

        if (lines.isEmpty()) {
            Card(Modifier.fillMaxWidth().padding(12.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Add your words to begin", style = MaterialTheme.typography.titleMedium)
                    Text("Paste them, or import a timed subtitle file. Blank lines become intentional gaps.",
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            itemsIndexed(lines, key = { _, line -> line.id }) { index, line ->
                LineRow(line, index, selected = state.selectedLineId == line.id, advanced = advanced,
                    onSelect = { viewModel.selectLine(if (state.selectedLineId == line.id) null else line.id) },
                    onText = { viewModel.updateLineText(line.id, it) },
                    onNudge = { delta -> viewModel.nudgeLine(line.id, delta) },
                    onStart = { us -> viewModel.setLineTime(line.id, start = us) },
                    onEnd = { us -> viewModel.setLineTime(line.id, end = us) },
                    onLock = { viewModel.setLocked(line.id, !line.locked) },
                    onDelete = { viewModel.deleteLine(line.id) },
                    onDuplicate = { viewModel.duplicateLine(line.id) },
                    onSplit = { viewModel.splitLine(line.id, line.words.size / 2) },
                    onMerge = { viewModel.mergeWithNext(line.id) },
                    onTranslation = { viewModel.setTranslation(line.id, it) },
                    onSpeaker = { viewModel.setSpeaker(line.id, it) },
                    onSeek = { viewModel.seek(line.start) })
            }
            item {
                OutlinedButton(onClick = { viewModel.insertLine(lines.lastOrNull()?.id) },
                    Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Icon(Icons.Default.Add, contentDescription = null); Spacer(Modifier.width(6.dp))
                    Text("Add line")
                }
            }
        }
    }

    if (pasteOpen) {
        AlertDialog(onDismissRequest = { pasteOpen = false },
            title = { Text("Lyrics text") },
            text = {
                OutlinedTextField(value = pasteText, onValueChange = { pasteText = it },
                    minLines = 10, maxLines = 18, modifier = Modifier.fillMaxWidth(),
                    label = { Text("One line per row · [Verse] headings supported") })
            },
            confirmButton = {
                TextButton(onClick = { viewModel.setLyricsFromText(pasteText); pasteOpen = false }) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { pasteOpen = false }) { Text("Cancel") } })
    }
}

@Composable
private fun TapSyncSection(state: EditorState, viewModel: EditorViewModel,
                           settings: AppSettings, context: android.content.Context) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Tap-sync", style = MaterialTheme.typography.titleMedium)
                    Text("${state.tapSession.taps.size} / ${state.project.lyrics.lines.size} lines tapped",
                        style = MaterialTheme.typography.labelMedium)
                }
                if (!state.tapActive) {
                    Button(onClick = { viewModel.startTap() }) { Text("Start") }
                } else {
                    Button(onClick = { viewModel.stopTap() },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) {
                        Text("Stop")
                    }
                }
            }
            LinearProgressIndicator(progress = { tapProgress(state.tapSession, state.project.lyrics.lines.size).toFloat() },
                modifier = Modifier.fillMaxWidth())
            if (state.tapActive) {
                Button(onClick = {
                    if (settings.haptics.value) context.tickHaptic()
                    viewModel.tapAt()
                },
                    Modifier.fillMaxWidth().height(56.dp)) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("TAP  ·  ${Time.formatClock(state.playback.positionUs)}")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = { viewModel.tapUndo() }) {
                        Icon(Icons.Default.Undo, contentDescription = null); Text("Undo tap")
                    }
                    OutlinedButton(onClick = { viewModel.tapReset() }) { Text("Reset") }
                    OutlinedButton(onClick = { viewModel.applyTaps() },
                        enabled = state.tapSession.taps.isNotEmpty()) {
                        Icon(Icons.Default.Done, contentDescription = null); Text("Apply")
                    }
                }
            } else if (state.tapSession.taps.isNotEmpty()) {
                OutlinedButton(onClick = { viewModel.applyTaps() }) { Text("Apply ${state.tapSession.taps.size} taps") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LineRow(line: Line, index: Int, selected: Boolean, advanced: Boolean,
                    onSelect: () -> Unit, onText: (String) -> Unit, onNudge: (Long) -> Unit,
                    onStart: (Long) -> Unit, onEnd: (Long) -> Unit, onLock: () -> Unit,
                    onDelete: () -> Unit, onDuplicate: () -> Unit, onSplit: () -> Unit,
                    onMerge: () -> Unit, onTranslation: (String?) -> Unit,
                    onSpeaker: (String?) -> Unit, onSeek: () -> Unit) {
    var text by remember(line.id) { mutableStateOf(line.text) }
    var showTimes by remember { mutableStateOf(false) }
    Card(onClick = onSelect, modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = if (selected)
            MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${index + 1}", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(26.dp))
                OutlinedTextField(value = text, onValueChange = { text = it; onText(it) },
                    singleLine = true, modifier = Modifier.weight(1f),
                    textStyle = MaterialTheme.typography.bodyMedium,
                    label = { Text(if (line.locked) "Locked" else "Line") })
                IconButton(onClick = onLock) { Icon(Icons.Default.Lock,
                    contentDescription = if (line.locked) "Unlock line" else "Lock line",
                    tint = if (line.locked) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                IconButton(onClick = onSeek) { Icon(Icons.Default.PlayArrow, contentDescription = "Preview this line") }
                Text("${Time.formatClock(line.start)} → ${Time.formatClock(line.end)}",
                    style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { onNudge(-50_000) }) { Icon(Icons.Default.KeyboardArrowLeft, contentDescription = "Earlier 50 ms") }
                IconButton(onClick = { onNudge(50_000) }) { Icon(Icons.Default.KeyboardArrowRight, contentDescription = "Later 50 ms") }
                IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, contentDescription = "Delete line") }
            }
            val badge = when (line.source) {
                TimingSource.ALIGN, TimingSource.ASR ->
                    "auto · ${(line.confidence * 100).toInt()}%"
                else -> line.source.wire
            }
            Text("$badge · ${line.words.size} words" +
                (line.speaker?.let { " · $it" } ?: "") +
                (line.translation?.let { " · translation" } ?: ""),
                style = MaterialTheme.typography.labelMedium,
                color = if ((line.source == TimingSource.ALIGN || line.source == TimingSource.ASR)
                    && line.confidence < 0.5)
                    MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)

            if (selected) {
                TextButton(onClick = { showTimes = !showTimes }) {
                    Text(if (showTimes) "Hide word timings" else "Edit timings & words")
                }
                if (showTimes) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        TimeField("Start", line.start, onStart)
                        TimeField("End", line.end, onEnd)
                    }
                    if (advanced) {
                        OutlinedTextField(value = line.translation.orEmpty(),
                            onValueChange = { onTranslation(it) }, label = { Text("Translation") },
                            singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value = line.speaker.orEmpty(),
                            onValueChange = { onSpeaker(it) }, label = { Text("Speaker") },
                            singleLine = true, modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            TextButton(onClick = onDuplicate) { Text("Duplicate") }
                            TextButton(onClick = onSplit) { Text("Split") }
                            TextButton(onClick = onMerge) { Text("Merge next") }
                        }
                    }
                    if (line.words.isNotEmpty()) {
                        Text(line.words.joinToString("  ") { "${it.text} ${Time.formatClock(it.start)}" },
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun RowScope.TimeField(label: String, value: Long, onChange: (Long) -> Unit) {
    var raw by remember(value) { mutableStateOf(Time.formatClock(value)) }
    OutlinedTextField(value = raw, onValueChange = {
        raw = it
        Time.parseClock(it)?.let { parsed -> onChange(parsed) }
    }, label = { Text(label) }, singleLine = true, modifier = Modifier.weight(1f),
        textStyle = MaterialTheme.typography.bodyMedium)
}
