package com.vidlyrics.studio.render

import android.graphics.Bitmap
import android.graphics.Canvas
import com.vidlyrics.core.ComputeOptions
import com.vidlyrics.core.Scene
import com.vidlyrics.core.computeFrameState
import kotlin.math.max
import kotlin.math.min

/**
 * Preview rasteriser. Uses the SAME FramePainter as the encoder; only the
 * backing bitmap resolution differs. The composition is scaled as a whole so
 * all coordinates in FrameState stay valid — no second layout path.
 */
class PreviewRenderer(private val painter: FramePainter) {

    fun render(scene: Scene, timeUs: Long, project: com.vidlyrics.core.Project,
               measure: com.vidlyrics.core.MeasureFn,
               maxWidth: Int = 960, maxHeight: Int = 960,
               showGuides: Boolean = false, showHeat: Boolean = false): Bitmap {
        val scale = min(1f, min(maxWidth.toFloat() / scene.width, maxHeight.toFloat() / scene.height))
        val w = max(2, Math.round(scene.width * scale))
        val h = max(2, Math.round(scene.height * scale))
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(scale, scale)
        val state = computeFrameState(scene, timeUs, measure,
            ComputeOptions(showGuides = showGuides, showHeat = showHeat))
        painter.draw(canvas, state, scene, project)
        return bitmap
    }

    /** Draws into an already-scaled Canvas (used by the live Compose preview). */
    fun drawFrame(canvas: Canvas, scene: Scene, timeUs: Long, project: com.vidlyrics.core.Project,
                  measure: com.vidlyrics.core.MeasureFn,
                  showGuides: Boolean = false, showHeat: Boolean = false) {
        val state = computeFrameState(scene, timeUs, measure,
            ComputeOptions(showGuides = showGuides, showHeat = showHeat))
        painter.draw(canvas, state, scene, project)
    }

    /** Reuses a bitmap when the size has not changed: the preview redraws at 60fps. */
    fun renderInto(bitmap: Bitmap, scene: Scene, timeUs: Long, project: com.vidlyrics.core.Project,
                   measure: com.vidlyrics.core.MeasureFn,
                   showGuides: Boolean = false, showHeat: Boolean = false): Boolean {
        if (bitmap.isRecycled) return false
        val scale = bitmap.width.toFloat() / scene.width
        val canvas = Canvas(bitmap)
        canvas.scale(scale, scale)
        val state = computeFrameState(scene, timeUs, measure,
            ComputeOptions(showGuides = showGuides, showHeat = showHeat))
        painter.draw(canvas, state, scene, project)
        return true
    }
}
