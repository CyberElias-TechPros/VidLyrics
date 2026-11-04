package com.vidlyrics.studio.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.vidlyrics.studio.data.AppSettings

/** Dark-first, like the rooms people actually edit video in. */
private val DarkColors = darkColorScheme(
    primary = Color(0xFF9C8CFF),
    onPrimary = Color(0xFF120A2E),
    primaryContainer = Color(0xFF332466),
    onPrimaryContainer = Color(0xFFEDE6FF),
    secondary = Color(0xFFFFD166),
    onSecondary = Color(0xFF2A1B00),
    secondaryContainer = Color(0xFF4A3700),
    onSecondaryContainer = Color(0xFFFFE9B0),
    tertiary = Color(0xFF4DD0C1),
    background = Color(0xFF0B0D14),
    onBackground = Color(0xFFE7E8F2),
    surface = Color(0xFF131722),
    onSurface = Color(0xFFE7E8F2),
    surfaceVariant = Color(0xFF1D2232),
    onSurfaceVariant = Color(0xFFB9BDD0),
    outline = Color(0xFF414761),
    error = Color(0xFFFF8A80)
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF5040B8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE6DEFF),
    onPrimaryContainer = Color(0xFF1A0E4B),
    secondary = Color(0xFF8A5A00),
    background = Color(0xFFF7F7FB),
    onBackground = Color(0xFF171922),
    surface = Color.White,
    onSurface = Color(0xFF171922),
    surfaceVariant = Color(0xFFE9EAF3),
    onSurfaceVariant = Color(0xFF41465B)
)

private val AppTypography = Typography(
    headlineLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 30.sp, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 24.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 19.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 16.sp),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 13.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp)
)

/** Props for motion-sensitive users; switch off transforms and long animations. */
val LocalReducedMotion = compositionLocalOf { false }

@Composable
fun VidLyricsTheme(settings: AppSettings, content: @Composable () -> Unit) {
    val mode by settings.theme.collectAsState()
    val dynamic by settings.dynamicColor.collectAsState()
    val reduced by settings.reducedMotion.collectAsState()
    val dark = when (mode) {
        "light" -> false
        "system" -> isSystemInDarkTheme()
        else -> true
    }
    val context = LocalContext.current
    val colors = when {
        dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && dark -> dynamicDarkColorScheme(context)
        dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> dynamicLightColorScheme(context)
        dark -> DarkColors
        else -> LightColors
    }
    CompositionLocalProvider(LocalReducedMotion provides reduced) {
        MaterialTheme(colorScheme = colors, typography = AppTypography, content = content)
    }
}
