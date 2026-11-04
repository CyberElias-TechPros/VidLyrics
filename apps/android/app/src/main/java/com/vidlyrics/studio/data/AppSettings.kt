package com.vidlyrics.studio.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Tiny preference wrapper. StateFlows let Compose react without a DataStore
 * dependency or a schema migration; every write is synchronous and durable,
 * which matters for a setting the user changes right before a long render.
 */
class AppSettings(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("vidlyrics.settings", Context.MODE_PRIVATE)

    private fun flow(key: String, default: String): MutableStateFlow<String> =
        MutableStateFlow(prefs.getString(key, default) ?: default)
    private fun boolFlow(key: String, default: Boolean): MutableStateFlow<Boolean> =
        MutableStateFlow(prefs.getBoolean(key, default))

    private val _theme = flow("theme", "dark")
    val theme: StateFlow<String> = _theme.asStateFlow()
    fun setTheme(value: String) { prefs.edit().putString("theme", value).apply(); _theme.value = value }

    private val _dynamicColor = boolFlow("dynamicColor", true)
    val dynamicColor: StateFlow<Boolean> = _dynamicColor.asStateFlow()
    fun setDynamicColor(value: Boolean) { prefs.edit().putBoolean("dynamicColor", value).apply(); _dynamicColor.value = value }

    private val _reducedMotion = boolFlow("reducedMotion", false)
    val reducedMotion: StateFlow<Boolean> = _reducedMotion.asStateFlow()
    fun setReducedMotion(value: Boolean) { prefs.edit().putBoolean("reducedMotion", value).apply(); _reducedMotion.value = value }

    private val _showGuides = boolFlow("showGuides", false)
    val showGuides: StateFlow<Boolean> = _showGuides.asStateFlow()
    fun setShowGuides(value: Boolean) { prefs.edit().putBoolean("showGuides", value).apply(); _showGuides.value = value }

    private val _showHeat = boolFlow("showHeat", true)
    val showHeat: StateFlow<Boolean> = _showHeat.asStateFlow()
    fun setShowHeat(value: Boolean) { prefs.edit().putBoolean("showHeat", value).apply(); _showHeat.value = value }

    private val _haptics = boolFlow("haptics", true)
    val haptics: StateFlow<Boolean> = _haptics.asStateFlow()
    fun setHaptics(value: Boolean) { prefs.edit().putBoolean("haptics", value).apply(); _haptics.value = value }

    private val _simpleMode = boolFlow("simpleMode", true)
    val simpleMode: StateFlow<Boolean> = _simpleMode.asStateFlow()
    fun setSimpleMode(value: Boolean) { prefs.edit().putBoolean("simpleMode", value).apply(); _simpleMode.value = value }

    /** Milliseconds of consistent late tapping; applied to every tap. */
    var tapCompensationMs: Int
        get() = prefs.getInt("tapCompensationMs", 0)
        set(value) { prefs.edit().putInt("tapCompensationMs", value.coerceIn(-500, 500)).apply() }

    /** Audio output latency compensation for preview (not for export). */
    var audioLatencyMs: Int
        get() = prefs.getInt("audioLatencyMs", 0)
        set(value) { prefs.edit().putInt("audioLatencyMs", value.coerceIn(0, 300)).apply() }

    var lastProjectId: String?
        get() = prefs.getString("lastProjectId", null)
        set(value) { prefs.edit().putString("lastProjectId", value).apply() }

    var defaultPreset: String
        get() = prefs.getString("defaultPreset", "youtube-shorts") ?: "youtube-shorts"
        set(value) { prefs.edit().putString("defaultPreset", value).apply() }
}
