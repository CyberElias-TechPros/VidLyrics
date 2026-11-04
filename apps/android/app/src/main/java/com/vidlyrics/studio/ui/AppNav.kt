package com.vidlyrics.studio.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.vidlyrics.studio.ui.editor.EditorScreen

object Routes {
    const val HOME = "home"
    const val EDITOR = "editor/{projectId}"
    const val SETTINGS = "settings"
    const val GUIDE = "guide"
    fun editor(projectId: String) = "editor/$projectId"
}

@Composable
fun AppNav(navController: NavHostController, incomingProjectUri: String?) {
    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                onOpen = { id -> navController.navigate(Routes.editor(id)) },
                onSettings = { navController.navigate(Routes.SETTINGS) },
                onGuide = { navController.navigate(Routes.GUIDE) },
                incomingProjectUri = incomingProjectUri
            )
        }
        composable(Routes.EDITOR) { backStack ->
            val projectId = backStack.arguments?.getString("projectId")
            EditorScreen(projectId = projectId, onBack = { navController.popBackStack() },
                onGuide = { navController.navigate(Routes.GUIDE) },
                onSettings = { navController.navigate(Routes.SETTINGS) })
        }
        composable(Routes.SETTINGS) { SettingsScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.GUIDE) { GuideScreen(onBack = { navController.popBackStack() }) }
    }
}
