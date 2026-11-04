package com.vidlyrics.studio.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vidlyrics.core.AppError
import com.vidlyrics.core.RecoveryRoute

/**
 * Every failure gets a designed card with a route forward. No dead ends, no
 * bare toasts: the primary action always moves the user closer to a video.
 */
@Composable
fun ErrorCard(error: AppError, onRecovery: (RecoveryRoute) -> Unit, onDismiss: () -> Unit,
              modifier: Modifier = Modifier, technicalExpanded: Boolean = false) {
    Card(modifier.fillMaxWidth().padding(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(error.title, style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onErrorContainer)
            Text(error.detail, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer)
            if (technicalExpanded && error.technical != null) {
                Text(error.technical!!, style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.75f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                error.recovery.forEach { route ->
                    when (route) {
                        RecoveryRoute.RETRY -> Button(onClick = { onRecovery(route) }) { Text("Try again") }
                        RecoveryRoute.MANUAL_TAP_SYNC -> Button(onClick = { onRecovery(route) }) { Text("Tap-sync instead") }
                        RecoveryRoute.LOWER_RESOLUTION -> OutlinedButton(onClick = { onRecovery(route) }) { Text("Use 720p") }
                        RecoveryRoute.SHORTER_RANGE -> OutlinedButton(onClick = { onRecovery(route) }) { Text("Shorten range") }
                        RecoveryRoute.TRY_DIFFERENT_FILE, RecoveryRoute.REIMPORT_AUDIO ->
                            OutlinedButton(onClick = { onRecovery(route) }) { Text("Choose another file") }
                        else -> TextButton(onClick = { onRecovery(route) }) { Text(route.wire.replace('-', ' ')) }
                    }
                }
                TextButton(onClick = onDismiss) { Text("Dismiss") }
            }
        }
    }
}
