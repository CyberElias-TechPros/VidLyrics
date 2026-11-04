package com.vidlyrics.studio.util

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Small, purposeful haptics: a tap-sync beat and a timeline snap. Never decorative. */
fun Context.tickHaptic(strong: Boolean = false) {
    try {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (!vibrator.hasVibrator()) return
        val ms = if (strong) 22L else 9L
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(ms, if (strong) 180 else 90))
        } else {
            @Suppress("DEPRECATION") vibrator.vibrate(ms)
        }
    } catch (_: Exception) { /* haptics are optional */ }
}
