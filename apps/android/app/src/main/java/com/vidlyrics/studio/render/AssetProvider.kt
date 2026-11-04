package com.vidlyrics.studio.render

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import com.vidlyrics.core.Project
import com.vidlyrics.studio.data.ProjectStore
import java.io.File
import kotlin.math.max

/**
 * Decodes user-supplied artwork on demand with sampling, and keeps a small
 * bounded cache. A 12 MP album photo must never become a 48 MB ARGB bitmap in
 * the middle of a render.
 */
class AssetProvider(private val store: ProjectStore) {
    private val cache = object : LruCache<String, Bitmap>(8 * 1024 * 1024 / 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    fun background(project: Project): Bitmap? = project.design.background.assetId?.let { load(it) }
    fun logo(project: Project): Bitmap? = project.design.brand.logoAssetId?.let { load(it) }

    fun load(assetId: String): Bitmap? {
        cache.get(assetId)?.let { return it }
        val file: File = store.assetFile(assetId)
        if (!file.exists()) return null
        return try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            val maxDim = 2560
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / sample > maxDim) sample *= 2
            val opts = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val bitmap = BitmapFactory.decodeFile(file.absolutePath, opts) ?: return null
            cache.put(assetId, bitmap)
            bitmap
        } catch (_: OutOfMemoryError) { null }
        catch (_: Exception) { null }
    }

    fun clear() = cache.evictAll()
}
