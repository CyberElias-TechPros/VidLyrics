package com.vidlyrics.studio

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import com.vidlyrics.studio.ui.AppNav
import com.vidlyrics.studio.ui.theme.VidLyricsTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // A .vidlyricsproject shared from Files/a messaging app is imported on
        // first launch, then handed to the home screen as a pending import URI.
        val incomingProject = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data

        setContent {
            val app = LocalContext.current.applicationContext as VidLyricsApp
            VidLyricsTheme(settings = app.settings) {
                val navController = rememberNavController()
                AppNav(navController = navController, incomingProjectUri = incomingProject?.toString())
            }
        }
    }
}
