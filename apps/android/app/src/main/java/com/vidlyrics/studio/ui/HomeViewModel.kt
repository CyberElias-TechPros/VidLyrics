package com.vidlyrics.studio.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vidlyrics.studio.VidLyricsApp
import com.vidlyrics.studio.data.ProjectSummary
import com.vidlyrics.studio.data.ProjectStore
import com.vidlyrics.core.Project
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeState(
    val projects: List<ProjectSummary> = emptyList(),
    val loading: Boolean = true,
    val recovery: Project? = null,
    val recoveryDismissed: Boolean = false
)

class HomeViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as VidLyricsApp
    val store: ProjectStore = app.projectStore
    val settings = app.settings

    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        val projects = store.list()
        val recovery = try { store.loadRecovery() } catch (_: Exception) { null }
        _state.value = HomeState(projects = projects, loading = false,
            recovery = recovery, recoveryDismissed = _state.value.recoveryDismissed)
    }

    fun createProject(onCreated: (String) -> Unit) = viewModelScope.launch {
        val id = com.vidlyrics.core.newId("proj")
        store.save(Project(id = id, createdAt = System.currentTimeMillis(),
            export = com.vidlyrics.core.exportSettingsFromPreset(settings.defaultPreset, 0)))
        settings.lastProjectId = id
        refresh()
        onCreated(id)
    }

    fun importProject(uri: Uri, onResult: (Result<String>) -> Unit) = viewModelScope.launch {
        try {
            val (project, _) = store.importProjectFile(uri)
            settings.lastProjectId = project.id
            refresh()
            onResult(Result.success(project.id))
        } catch (e: Exception) { onResult(Result.failure(e)) }
    }

    fun delete(id: String) = viewModelScope.launch { store.delete(id); refresh() }
    fun duplicate(id: String) = viewModelScope.launch { store.duplicate(id); refresh() }
    fun dismissRecovery() = viewModelScope.launch {
        store.clearRecovery()
        _state.value = _state.value.copy(recovery = null, recoveryDismissed = true)
    }
}
