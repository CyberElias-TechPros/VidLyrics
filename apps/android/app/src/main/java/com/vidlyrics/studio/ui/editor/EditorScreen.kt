package com.vidlyrics.studio.ui.editor

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vidlyrics.core.Time
import com.vidlyrics.studio.R
import com.vidlyrics.studio.ui.components.ErrorCard
import com.vidlyrics.studio.ui.editor.components.DesignPanel
import com.vidlyrics.studio.ui.editor.components.ExportPanel
import com.vidlyrics.studio.ui.editor.components.LyricsPanel
import com.vidlyrics.studio.ui.editor.components.PreviewPane
import com.vidlyrics.studio.ui.editor.components.WaveformTimeline
import com.vidlyrics.studio.util.tickHaptic

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(projectId: String?, onBack: () -> Unit, onGuide: () -> Unit,
                 onSettings: () -> Unit, viewModel: EditorViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }
    var menuOpen by remember { mutableStateOf(false) }
    var viewStartUs by remember { mutableStateOf(0L) }
    var viewDurationUs by remember { mutableStateOf(30_000_000L) }
    val project = state.project
    val durationUs = project.audio?.durationUs?.takeIf { it > 0 }
        ?: project.lyrics.lines.maxOfOrNull { it.end }?.takeIf { it > 0 } ?: 60_000_000L
    val introUs = if (project.design.intro.enabled) project.design.intro.durationUs else 0L
    val compositionTimeUs = introUs + state.playback.positionUs
    val scene = remember(project, state.analysis) { viewModel.sceneFor(project) }
    val measure = remember(project.design.typography.fontStack) { viewModel.measureFor(project) }

    LaunchedEffect(projectId) { viewModel.load(projectId ?: "default") }

    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) viewModel.importAudio(uri)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) viewModel.importBackgroundImage(uri)
    }
    LaunchedEffect(state.requestPickAudio) {
        if (state.requestPickAudio) {
            viewModel.clearError()
            viewModel.consumePickRequests()
            pickAudio.launch(arrayOf("audio/*", "application/ogg", "*/*"))
        }
    }
    LaunchedEffect(state.requestPickImage) {
        if (state.requestPickImage) {
            viewModel.consumePickRequests()
            pickImage.launch(arrayOf("image/*"))
        }
    }

    // Surface notices once, as snackbars.
    val firstNotice = state.notices.firstOrNull()
    LaunchedEffect(firstNotice?.id) {
        if (firstNotice != null) {
            snackbarHost.showSnackbar("${firstNotice.title}${firstNotice.detail?.let { " · $it" } ?: ""}",
                duration = SnackbarDuration.Short)
            viewModel.dismissNotice(firstNotice.id)
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHost) }, topBar = {
        TopAppBar(
            title = {
                Column {
                    Text(project.meta.title.ifBlank { "Untitled project" },
                        maxLines = 1, style = MaterialTheme.typography.titleMedium)
                    Text(if (state.dirty) "Saving…" else "Saved on this device",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
            },
            actions = {
                IconButton(onClick = { viewModel.undo() }, enabled = state.undoAvailable) {
                    Icon(Icons.Default.Undo, contentDescription = "Undo")
                }
                IconButton(onClick = { viewModel.redo() }, enabled = state.redoAvailable) {
                    Icon(Icons.Default.Redo, contentDescription = "Redo")
                }
                IconButton(onClick = { viewModel.saveNow() }) {
                    Icon(Icons.Default.Save, contentDescription = "Save")
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More options")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("Import audio") },
                            onClick = { menuOpen = false; pickAudio.launch(arrayOf("audio/*", "*/*")) },
                            leadingIcon = { Icon(Icons.Default.MusicNote, contentDescription = null) })
                        DropdownMenuItem(text = { Text(if (state.showGuides) "Hide safe-area guides" else "Show safe-area guides") },
                            onClick = { viewModel.toggleGuides(); menuOpen = false })
                        DropdownMenuItem(text = { Text(if (state.showHeat) "Hide confidence heat" else "Show confidence heat") },
                            onClick = { viewModel.toggleHeat(); menuOpen = false })
                        DropdownMenuItem(text = { Text(if (state.simpleMode) "Advanced controls" else "Simple mode") },
                            onClick = { viewModel.setSimpleMode(!state.simpleMode); menuOpen = false })
                        DropdownMenuItem(text = { Text("Guide") }, onClick = { menuOpen = false; onGuide() })
                        DropdownMenuItem(text = { Text("Settings") }, onClick = { menuOpen = false; onSettings() })
                    }
                }
            })
    }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)
            .onPreviewKeyEvent { event ->
                if (event.isCtrlPressed && event.key == Key.Z) { viewModel.undo(); true }
                else if (event.isCtrlPressed && event.key == Key.Y) { viewModel.redo(); true }
                else if (event.key == Key.Spacebar) { viewModel.togglePlay(); true }
                else if (event.key == Key.T && state.tapActive) {
                    if (viewModel.settings.haptics.value) context.tickHaptic()
                    viewModel.tapAt(); true
                } else false
            }) {

            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth > 720.dp
                if (wide) {
                    Row(Modifier.fillMaxSize()) {
                        Column(Modifier.weight(1.35f).fillMaxHeight()) {
                            Stage(viewModel, state, scene, measure, compositionTimeUs, durationUs,
                                viewStartUs, viewDurationUs,
                                onPan = { delta -> viewStartUs = (viewStartUs + delta)
                                    .coerceIn(0L, maxOf(0L, durationUs - viewDurationUs)) },
                                onZoom = { value -> viewDurationUs = value },
                                modifier = Modifier.weight(1f))
                        }
                        Column(Modifier.weight(1f).fillMaxHeight()) {
                            PanelTabs(state, viewModel)
                        }
                    }
                } else {
                    Column(Modifier.fillMaxSize()) {
                        Stage(viewModel, state, scene, measure, compositionTimeUs, durationUs,
                            viewStartUs, viewDurationUs,
                            onPan = { delta -> viewStartUs = (viewStartUs + delta)
                                .coerceIn(0L, maxOf(0L, durationUs - viewDurationUs)) },
                            onZoom = { value -> viewDurationUs = value },
                            modifier = Modifier.heightIn(max = 320.dp))
                        PanelTabs(state, viewModel, Modifier.weight(1f))
                    }
                }
            }

            if (state.loading) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            state.error?.let { error ->
                ErrorCard(error, onRecovery = { viewModel.onRecovery(it) },
                    onDismiss = { viewModel.clearError() },
                    modifier = Modifier.align(Alignment.TopCenter))
            }
        }
    }
}

@Composable
private fun Stage(viewModel: EditorViewModel, state: EditorState, scene: com.vidlyrics.core.Scene,
                   measure: com.vidlyrics.core.MeasureFn, compositionTimeUs: Long,
                   durationUs: Long, viewStartUs: Long, viewDurationUs: Long,
                   onPan: (Long) -> Unit, onZoom: (Long) -> Unit, modifier: Modifier = Modifier) {
    val project = state.project
    val aspect = com.vidlyrics.core.compositionSize(project.design)
    val ratio = aspect.first.toFloat() / aspect.second.toFloat()
    Column(modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PreviewPane(viewModel.previewRenderer, scene, project, measure, compositionTimeUs,
            state.showGuides, state.showHeat,
            Modifier.fillMaxWidth().aspectRatio(ratio).weight(1f, fill = false))

        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { viewModel.togglePlay() }) {
                Icon(if (state.playback.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (state.playback.playing) "Pause" else "Play")
            }
            Text(Time.formatClock(state.playback.positionUs), style = MaterialTheme.typography.labelMedium)
            Text(" / ${Time.formatClock(durationUs)}", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { viewModel.nudgePlayhead(-5_000_000) }) { Text("−5s") }
            TextButton(onClick = { viewModel.nudgePlayhead(5_000_000) }) { Text("+5s") }
            TextButton(onClick = { viewModel.setLoop(state.loop?.let { null } ?: Pair(
                state.playback.positionUs, minOf(durationUs, state.playback.positionUs + 8_000_000))) }) {
                Text(if (state.loop == null) "Loop 8s" else "Clear loop")
            }
        }

        if (state.audioMissing) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Text("Audio file missing — re-link it to restore playback and export with sound.",
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(10.dp))
            }
        }
        if (state.mediaPhase == MediaPhase.ANALYZING || state.mediaPhase == MediaPhase.IMPORTING) {
            LinearProgressIndicator(progress = { state.mediaProgress }, Modifier.fillMaxWidth())
            Text(state.mediaMessage, style = MaterialTheme.typography.labelMedium)
        }

        WaveformTimeline(state.analysis, project.lyrics.lines, state.tapSession,
            state.playback.positionUs, durationUs, viewStartUs, viewDurationUs,
            state.loop, state.selectedLineId, state.showHeat,
            onSeek = { viewModel.seek(it) }, onSelectLine = { viewModel.selectLine(it) },
            onPan = onPan, modifier = Modifier.fillMaxWidth().height(96.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Zoom", style = MaterialTheme.typography.labelMedium)
            Slider(value = viewDurationUs / 1_000_000f,
                onValueChange = { onZoom((it * 1_000_000).toLong().coerceIn(2_000_000, durationUs)) },
                valueRange = 2f..maxOf(3f, durationUs / 1_000_000f),
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
            Text("${viewDurationUs / 1_000_000}s", style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun ColumnScope.PanelTabs(state: EditorState, viewModel: EditorViewModel,
                                  modifier: Modifier = Modifier) {
    TabRow(selectedTabIndex = state.panel.ordinal) {
        listOf("Lyrics" to Panel.LYRICS, "Design" to Panel.DESIGN, "Export" to Panel.EXPORT)
            .forEachIndexed { index, (label, panel) ->
                Tab(selected = state.panel == panel, onClick = { viewModel.setPanel(panel) },
                    text = { Text(label) })
            }
    }
    when (state.panel) {
        Panel.LYRICS -> LyricsPanel(state, viewModel, viewModel.settings, modifier)
        Panel.DESIGN -> DesignPanel(state, viewModel, modifier)
        Panel.EXPORT -> ExportPanel(state, viewModel, modifier)
    }
}
