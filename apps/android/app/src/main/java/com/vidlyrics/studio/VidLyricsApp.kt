package com.vidlyrics.studio

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.vidlyrics.studio.data.AppSettings
import com.vidlyrics.studio.data.ProjectStore

class VidLyricsApp : Application() {
    lateinit var projectStore: ProjectStore
        private set
    lateinit var settings: AppSettings
        private set

    override fun onCreate() {
        super.onCreate()
        projectStore = ProjectStore(this)
        settings = AppSettings(this)
        createRenderChannel()
    }

    private fun createRenderChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            RenderChannel.ID, getString(R.string.render_channel),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Progress for video renders running in the background"
            setSound(null, null)
            enableVibration(false)
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    object RenderChannel {
        const val ID = "vidlyrics.renders"
        const val NOTIFICATION_ID = 4201
    }
}
