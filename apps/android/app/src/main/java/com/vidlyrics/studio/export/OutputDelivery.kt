package com.vidlyrics.studio.export

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File

/** Writes finished files where the user asked, or into the public video library. */
object OutputDelivery {

    fun tempOutput(context: Context, fileName: String): File {
        val dir = File(context.cacheDir, "renders").apply { mkdirs() }
        return File(dir, fileName)
    }

    /** SAF destination chosen with ACTION_CREATE_DOCUMENT before the render. */
    fun saveToUri(context: Context, uri: Uri, file: File): Boolean = try {
        context.contentResolver.openOutputStream(uri, "w")?.use { out ->
            file.inputStream().buffered().use { input -> input.copyTo(out, 128 * 1024) }
        } ?: return false
        true
    } catch (_: Exception) { false }

    /** API 29+ scoped-storage safe insertion into Movies/VidLyrics. */
    fun insertIntoMediaStore(context: Context, file: File, displayName: String): Uri? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/VidLyrics")
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        val uri = context.contentResolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
            ?: return null
        return try {
            context.contentResolver.openOutputStream(uri)?.use { out ->
                file.inputStream().buffered().use { it.copyTo(out, 128 * 1024) }
            } ?: return null
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
            uri
        } catch (_: Exception) {
            context.contentResolver.delete(uri, null, null)
            null
        }
    }

    fun share(context: Context, file: File, mimeType: String, title: String) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, title)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = android.content.ClipData.newUri(context.contentResolver, title, uri)
        }
        context.startActivity(Intent.createChooser(intent, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun writeTextToUri(context: Context, uri: Uri, text: String): Boolean = try {
        context.contentResolver.openOutputStream(uri, "w")?.use { out ->
            out.write(text.toByteArray(Charsets.UTF_8))
        } ?: false
        true
    } catch (_: Exception) { false }
}
