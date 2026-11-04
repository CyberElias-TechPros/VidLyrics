package com.vidlyrics.studio.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private data class GuideSection(val title: String, val body: String)

private val SECTIONS = listOf(
    GuideSection("1 · Start a project",
        "Tap New project. Give it a title and artist if you want them on the intro card, then add your song. MP3, M4A/AAC, WAV, FLAC, OGG and Opus are decoded on this device. You never need an account."),
    GuideSection("2 · Add the words",
        "Paste lyrics into the Lyrics panel, or import an LRC, Enhanced LRC (word-level karaoke), SRT, WebVTT, ASS or plain-text file. Timed files keep their timings; plain text is distributed across the song as a first estimate. Section headings like [Verse 1] are detected automatically."),
    GuideSection("3 · Sync them",
        "Auto-sync reads the waveform, finds vocal onsets and aligns the word sequence with dynamic programming — no server, no upload. For exact control use Tap-sync: press play and tap the beat or the first word of every line. Taps are read from the audio clock, so Bluetooth latency and UI jank do not affect them. If your taps are consistently late, set Tap compensation in Settings. Speech-pack alignment gives word-level timing when you have installed a local CTC ONNX model."),
    GuideSection("4 · Make it yours",
        "Pick a theme, aspect ratio and background. Safe-area guides show where platform UI overlays the video. Intro and outro cards are optional and extend the composition without shifting your lyric timings. Colours can be extracted from embedded album art. Confidence heat marks machine-timed lines that deserve a second look."),
    GuideSection("5 · Export",
        "Choose a resolution and frame rate, then render. The job runs in a foreground service so it survives screen-off and app switching; you can cancel from the notification. Output is a standard H.264/AAC MP4 in your Movies folder or the location you choose. Subtitles (LRC, SRT, VTT, ASS, JSON) and a portable project file can be exported separately."),
    GuideSection("6 · Privacy & storage",
        "The app declares no INTERNET permission. Your audio, lyrics and renders never leave the device. Source files live in private app storage; a SHA-256 manifest lets a project file re-link to audio already on the phone without embedding the song. Project files, waveform caches and render temps can all be cleaned up in Settings."),
    GuideSection("Troubleshooting",
        "• Audio won't decode: re-export it as WAV or M4A/AAC, or import a different copy.\n" +
        "• Auto-sync looks wrong: use tap-sync, nudge individual lines, or lock lines you have already set.\n" +
        "• Render is slow or fails: use 720p/30fps, shorten the range, or free storage.\n" +
        "• Video has no sound: re-link the audio file (the project stores a hash, not the song).\n" +
        "• Preview audio is ahead of the video: set preview audio latency in Settings.\n" +
        "• A crash: reopen the app — the last edit is offered back to you from the recovery file.")
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuideScreen(onBack: () -> Unit) {
    Scaffold(topBar = {
        TopAppBar(title = { Text("Guide") }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
        })
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)
            .verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("From song to video in five steps", style = MaterialTheme.typography.headlineMedium)
            Text("VidLyrics solves timing, then renders. This guide stays offline with the app.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            SECTIONS.forEach { section ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(section.title, style = MaterialTheme.typography.titleMedium)
                        Text(section.body, style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
