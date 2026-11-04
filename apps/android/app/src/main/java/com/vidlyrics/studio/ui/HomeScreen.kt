package com.vidlyrics.studio.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vidlyrics.core.Time
import com.vidlyrics.studio.R
import com.vidlyrics.studio.data.ProjectSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(onOpen: (String) -> Unit, onSettings: () -> Unit, onGuide: () -> Unit,
               incomingProjectUri: String?, viewModel: HomeViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var message by remember { mutableStateOf<String?>(null) }
    var menuFor by remember { mutableStateOf<String?>(null) }

    val pickProject = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) viewModel.importProject(uri) { result ->
            result.onSuccess { id -> onOpen(id) }
                .onFailure { message = "That file is not a valid VidLyrics project: ${it.message}" }
        }
    }

    LaunchedEffect(incomingProjectUri) {
        if (incomingProjectUri != null) {
            viewModel.importProject(Uri.parse(incomingProjectUri)) { result ->
                result.onSuccess { id -> onOpen(id) }
                    .onFailure { message = "Could not open the shared project: ${it.message}" }
            }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = {
            Column {
                Text("VidLyrics", style = MaterialTheme.typography.titleLarge)
                Text("Lyric video studio", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }, actions = {
            IconButton(onClick = onGuide, modifier = Modifier.semantics { contentDescription = "Open guide" }) {
                Icon(Icons.Default.Help, contentDescription = "Guide")
            }
            IconButton(onClick = onSettings, modifier = Modifier.semantics { contentDescription = "Open settings" }) {
                Icon(Icons.Default.Settings, contentDescription = "Settings")
            }
        })
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Spacer(Modifier.height(8.dp)) }
            item {
                Card(colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Turn a song and its words into a video.",
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text(context.getString(R.string.privacy_line),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { viewModel.createProject(onOpen) }) {
                                Icon(Icons.Default.Add, contentDescription = null)
                                Spacer(Modifier.width(6.dp)); Text("New project")
                            }
                            OutlinedButton(onClick = { pickProject.launch(arrayOf("application/json", "text/plain", "*/*")) }) {
                                Icon(Icons.Default.FolderOpen, contentDescription = null)
                                Spacer(Modifier.width(6.dp)); Text("Import")
                            }
                        }
                    }
                }
            }

            if (state.recovery != null && !state.recoveryDismissed) {
                item {
                    Card(colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Restore, contentDescription = null)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Unsaved work found", style = MaterialTheme.typography.titleMedium)
                                Text(state.recovery?.meta?.title?.takeIf { it.isNotBlank() } ?: "Untitled project",
                                    style = MaterialTheme.typography.bodyMedium)
                            }
                            TextButton(onClick = { onOpen(state.recovery!!.id) }) { Text("Restore") }
                            TextButton(onClick = { viewModel.dismissRecovery() }) { Text("Discard") }
                        }
                    }
                }
            }

            message?.let {
                item {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
            }

            item {
                Text("Your projects", style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 8.dp))
            }

            if (state.projects.isEmpty() && !state.loading) {
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Nothing here yet", style = MaterialTheme.typography.titleMedium)
                            Text("Start a project, add a song, paste the words, then sync them with a tap or automatically. Everything is stored on this phone.",
                                style = MaterialTheme.typography.bodyMedium)
                            TextButton(onClick = onGuide) { Text("Read the 2-minute guide") }
                        }
                    }
                }
            }

            items(state.projects, key = { it.id }) { project ->
                ProjectRow(project, menuFor == project.id,
                    onOpen = { onOpen(project.id) },
                    onMenu = { menuFor = if (menuFor == project.id) null else project.id },
                    onDismissMenu = { menuFor = null },
                    onDuplicate = { viewModel.duplicate(project.id); menuFor = null },
                    onDelete = { viewModel.delete(project.id); menuFor = null })
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectRow(project: ProjectSummary, menuOpen: Boolean, onOpen: () -> Unit,
                       onMenu: () -> Unit, onDismissMenu: () -> Unit,
                       onDuplicate: () -> Unit, onDelete: () -> Unit) {
    Card(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(project.title.ifBlank { "Untitled project" },
                    style = MaterialTheme.typography.titleMedium, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
                Text(buildString {
                    if (project.artist.isNotBlank()) append(project.artist).append(" · ")
                    append("${project.lineCount} lines")
                    if (project.durationUs > 0) append(" · ").append(Time.formatClock(project.durationUs))
                    if (!project.hasAudio) append(" · audio missing")
                }, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${project.themeId.replace('-', ' ')} · ${project.aspectId}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
            }
            Box {
                IconButton(onClick = onMenu) { Icon(Icons.Default.MoreVert, contentDescription = "Project options") }
                DropdownMenu(expanded = menuOpen, onDismissRequest = onDismissMenu) {
                    DropdownMenuItem(text = { Text("Duplicate") }, onClick = onDuplicate)
                    DropdownMenuItem(text = { Text("Delete") }, onClick = onDelete,
                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) })
                }
            }
        }
    }
}
