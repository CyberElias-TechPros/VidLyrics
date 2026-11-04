package com.vidlyrics.studio.util

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import java.security.MessageDigest

/** SHA-256 hex, used for content-addressed assets and re-linking on import. */
fun sha256Hex(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
}

fun Uri.displayName(resolver: ContentResolver): String {
    return try {
        resolver.query(this, null, null, null, null)?.use { c: Cursor ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        } ?: lastPathSegment?.substringAfterLast('/') ?: "audio"
    } catch (_: Exception) {
        lastPathSegment?.substringAfterLast('/') ?: "audio"
    }
}

fun Uri.sizeBytes(resolver: ContentResolver): Long = try {
    resolver.query(this, null, null, null, null)?.use { c: Cursor ->
        val idx = c.getColumnIndex(OpenableColumns.SIZE)
        if (idx >= 0 && c.moveToFirst() && !c.isNull(idx)) c.getLong(idx) else -1L
    } ?: -1L
} catch (_: Exception) { -1L }

fun mimeFor(name: String, fallback: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return when (ext) {
        "mp3" -> "audio/mpeg"
        "m4a", "mp4", "aac", "mov", "3gp" -> "audio/mp4"
        "wav" -> "audio/wav"
        "flac" -> "audio/flac"
        "ogg", "oga" -> "audio/ogg"
        "opus" -> "audio/ogg"
        "amr" -> "audio/amr"
        "aiff", "aif" -> "audio/aiff"
        "lrc", "txt", "srt", "vtt", "ass", "ssa" -> "text/plain"
        "json", "vidlyricsproject" -> "application/json"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        else -> fallback
    }
}

fun Context.privateFile(path: String): java.io.File = java.io.File(filesDir, path)
