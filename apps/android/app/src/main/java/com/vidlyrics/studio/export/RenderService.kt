package com.vidlyrics.studio.export

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.FileProvider
import com.vidlyrics.core.AppError
import com.vidlyrics.core.Time
import com.vidlyrics.core.suggestedFileName
import com.vidlyrics.studio.MainActivity
import com.vidlyrics.studio.R
import com.vidlyrics.studio.VidLyricsApp
import com.vidlyrics.studio.data.ProjectStore
import com.vidlyrics.studio.render.AssetProvider
import com.vidlyrics.studio.render.FramePainter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * A foreground service owns long renders. Android can (and will) kill a plain
 * coroutine when the screen turns off; a foreground service with an ongoing
 * notification is the platform-correct answer to the web app's "background tab
 * throttling killed my render" failure mode. Cancellation is cooperative.
 */
class RenderService : Service() {

    companion object {
        const val ACTION_START = "com.vidlyrics.studio.RENDER_START"
        const val ACTION_CANCEL = "com.vidlyrics.studio.RENDER_CANCEL"
        const val EXTRA_PROJECT_ID = "projectId"
        const val EXTRA_OUTPUT_URI = "outputUri"
        const val EXTRA_FILE_NAME = "fileName"

        fun start(context: Context, projectId: String, outputUri: Uri?, fileName: String) {
            val intent = Intent(context, RenderService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_PROJECT_ID, projectId)
                putExtra(EXTRA_FILE_NAME, fileName)
                if (outputUri != null) putExtra(EXTRA_OUTPUT_URI, outputUri.toString())
            }
            context.startForegroundService(intent)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            // Do NOT stopSelf() here: the render loop must be allowed to unwind,
            // delete its partial file and publish a clean CANCELLED status.
            RenderRepository.requestCancel()
            updateNotification(RenderStatus(phase = RenderPhase.RENDERING,
                message = "Stopping after this frame…"))
            return START_NOT_STICKY
        }
        if (intent?.action != ACTION_START) { stopSelf(); return START_NOT_STICKY }

        val projectId = intent.getStringExtra(EXTRA_PROJECT_ID) ?: run { stopSelf(); return START_NOT_STICKY }
        val outputUri = intent.getStringExtra(EXTRA_OUTPUT_URI)?.let { Uri.parse(it) }
        val fileName = intent.getStringExtra(EXTRA_FILE_NAME) ?: "lyric-video.mp4"
        RenderRepository.cancelled.set(false)
        RenderRepository.update(RenderStatus(phase = RenderPhase.PREPARING, projectId = projectId,
            message = "Checking encoders and free space…"))
        showForeground(RenderStatus(phase = RenderPhase.PREPARING, message = "Preparing render…"))

        scope.launch { doRender(projectId, outputUri, fileName) }
        return START_NOT_STICKY
    }

    private suspend fun doRender(projectId: String, outputUri: Uri?, fileName: String) {
        val app = application as VidLyricsApp
        val store: ProjectStore = app.projectStore
        val project = store.load(projectId)
        if (project == null) {
            finishWithError(AppError(code = "PROJECT_MISSING", title = "Project not found",
                detail = "The project was removed while the render was queued. Open it again and retry."), projectId)
            return
        }
        val audioFile = store.audioFile(project)
        val analysis = project.audio?.let { store.readAnalysis(it.contentHash) }
        val voiceoverFile = store.voiceoverFile(project)
        val painter = FramePainter(AssetProvider(store))
        val output = OutputDelivery.tempOutput(this, fileName)
        val displayName = fileName.substringBeforeLast('.') + ".mp4"

        val outcome = try {
            VideoExporter().render(
                project = project,
                audioFile = audioFile,
                analysis = analysis,
                voiceoverFile = voiceoverFile,
                output = output,
                painter = painter,
                onProgress = { done, total, eta, phase ->
                    val status = RenderStatus(
                        phase = phase, projectId = projectId,
                        progress = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else 0f,
                        framesDone = done, framesTotal = total, etaSeconds = eta,
                        message = when (phase) {
                            RenderPhase.MUXING -> "Finishing the MP4…"
                            RenderPhase.RENDERING -> "Frame $done of $total · ${Time.formatDuration(eta * 1_000_000L)} left"
                            else -> "Working…"
                        })
                    RenderRepository.update(status)
                    updateNotification(status)
                },
                shouldCancel = { RenderRepository.cancelled.get() }
            )
        } catch (e: Exception) {
            RenderOutcome(error = AppError(code = "RENDER_CRASH", title = "Render stopped unexpectedly",
                detail = "Your project is unchanged. Try a lower resolution or a shorter range.",
                technical = e.message,
                recovery = listOf(com.vidlyrics.core.RecoveryRoute.LOWER_RESOLUTION,
                    com.vidlyrics.core.RecoveryRoute.SHORTER_RANGE, com.vidlyrics.core.RecoveryRoute.RETRY)))
        }

        when {
            outcome.cancelled -> {
                output.delete()
                val status = RenderStatus(phase = RenderPhase.CANCELLED, projectId = projectId,
                    message = "Render stopped. Nothing was saved.")
                RenderRepository.update(status)
                updateNotification(status)
            }
            !outcome.ok -> finishWithError(outcome.error ?: AppError(
                code = "RENDER_FAILED", title = "Render failed",
                detail = "Try a lower resolution or a shorter range."), projectId)
            else -> {
                val file = outcome.file!!
                val deliveredUri = when {
                    outputUri != null && OutputDelivery.saveToUri(this, outputUri, file) -> outputUri
                    else -> OutputDelivery.insertIntoMediaStore(this, file, displayName)
                        ?: FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                }
                val status = RenderStatus(
                    phase = RenderPhase.COMPLETE, progress = 1f, projectId = projectId,
                    framesDone = RenderRepository.status.value.framesTotal,
                    framesTotal = RenderRepository.status.value.framesTotal,
                    resultUri = deliveredUri, resultBytes = file.length(),
                    message = outcome.warning?.let { "Video saved without audio: ${it.detail}" }
                        ?: "Saved ${Time.formatBytes(file.length())}")
                RenderRepository.update(status)
                updateNotification(status)
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun finishWithError(error: AppError, projectId: String) {
        val status = RenderStatus(phase = RenderPhase.FAILED, projectId = projectId,
            error = error, message = error.title)
        RenderRepository.update(status)
        updateNotification(status)
    }

    private fun showForeground(status: RenderStatus) {
        val notification = buildNotification(status)
        try {
            ServiceCompat.startForeground(this, VidLyricsApp.RenderChannel.NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING)
        } catch (_: Exception) {
            // Older platforms: the two-argument form uses the manifest type.
            startForeground(VidLyricsApp.RenderChannel.NOTIFICATION_ID, notification)
        }
    }

    @Suppress("MissingPermission")
    private fun updateNotification(status: RenderStatus) {
        try { NotificationManagerCompat.from(this).notify(VidLyricsApp.RenderChannel.NOTIFICATION_ID, buildNotification(status)) }
        catch (_: Exception) { Unit }
    }

    private fun buildNotification(status: RenderStatus): android.app.Notification {
        val open = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val cancel = PendingIntent.getService(this, 1,
            Intent(this, RenderService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val percent = (status.progress * 100).toInt().coerceIn(0, 100)
        return NotificationCompat.Builder(this, VidLyricsApp.RenderChannel.ID)
            .setSmallIcon(R.drawable.ic_stat_render)
            .setContentTitle(getString(R.string.render_in_progress))
            .setContentText(status.message.ifEmpty { "$percent% complete" })
            .setContentIntent(open)
            .setOngoing(status.active)
            .setOnlyAlertOnce(true)
            .setProgress(100, percent, status.phase == RenderPhase.PREPARING)
            .apply {
                if (status.active) addAction(R.drawable.ic_stat_render, getString(R.string.notification_cancel), cancel)
                if (status.phase == RenderPhase.COMPLETE) {
                    setContentTitle(getString(R.string.render_complete))
                    setProgress(0, 0, false)
                }
                if (status.phase == RenderPhase.FAILED) setContentTitle(getString(R.string.render_failed))
            }
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
