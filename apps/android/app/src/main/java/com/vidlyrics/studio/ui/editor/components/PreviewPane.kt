package com.vidlyrics.studio.ui.editor.components

import android.content.Context
import android.graphics.Canvas
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import com.vidlyrics.core.MeasureFn
import com.vidlyrics.core.Project
import com.vidlyrics.core.Scene
import com.vidlyrics.studio.render.PreviewRenderer

/**
 * The preview is a native Android View drawing with the SAME Canvas painter as
 * the MP4 encoder. There is no second rendering path, so what you see on screen
 * is what lands in the file (down to the karaoke wipe and safe-area guides).
 */
@Composable
fun PreviewPane(renderer: PreviewRenderer, scene: Scene, project: Project, measure: MeasureFn,
                timeUs: Long, showGuides: Boolean, showHeat: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(Color.Black)) {
        AndroidView(modifier = Modifier.fillMaxSize(),
            factory = { ctx -> PreviewSurface(ctx) },
            update = { view ->
                view.bind(renderer, scene, project, measure, timeUs, showGuides, showHeat)
            })
    }
}

private class PreviewSurface(context: Context) : View(context) {
    private var renderer: PreviewRenderer? = null
    private var scene: Scene? = null
    private var project: Project? = null
    private var measure: MeasureFn? = null
    private var timeUs = 0L
    private var showGuides = false
    private var showHeat = false

    fun bind(r: PreviewRenderer, s: Scene, p: Project, m: MeasureFn,
             time: Long, guides: Boolean, heat: Boolean) {
        renderer = r; scene = s; project = p; measure = m
        timeUs = time; showGuides = guides; showHeat = heat
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val s = scene ?: return
        val p = project ?: return
        val m = measure ?: return
        val r = renderer ?: return
        if (width <= 0 || height <= 0) return
        val scale = minOf(width.toFloat() / s.width, height.toFloat() / s.height)
        val dx = (width - s.width * scale) / 2f
        val dy = (height - s.height * scale) / 2f
        canvas.save()
        canvas.translate(dx, dy)
        canvas.scale(scale, scale)
        r.drawFrame(canvas, s, timeUs, p, m, showGuides, showHeat)
        canvas.restore()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        setMeasuredDimension(measuredWidth, measuredHeight)
    }
}
