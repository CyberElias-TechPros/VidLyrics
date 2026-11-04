package com.vidlyrics.studio.export

import android.net.Uri
import com.vidlyrics.core.AppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.atomic.AtomicBoolean

enum class RenderPhase { IDLE, PREPARING, RENDERING, MUXING, COMPLETE, FAILED, CANCELLED }

data class RenderStatus(
    val phase: RenderPhase = RenderPhase.IDLE,
    val progress: Float = 0f,
    val framesDone: Long = 0,
    val framesTotal: Long = 0,
    val etaSeconds: Long = 0,
    val message: String = "",
    val error: AppError? = null,
    val resultUri: Uri? = null,
    val resultBytes: Long = 0,
    val projectId: String? = null
) {
    val active: Boolean get() = phase == RenderPhase.PREPARING || phase == RenderPhase.RENDERING || phase == RenderPhase.MUXING
}

/** Process-wide render state. A single job at a time, visible to every screen. */
object RenderRepository {
    private val _status = MutableStateFlow(RenderStatus())
    val status: StateFlow<RenderStatus> = _status.asStateFlow()
    val cancelled = AtomicBoolean(false)

    fun update(status: RenderStatus) { _status.value = status }
    fun patch(projectId: String? = status.value.projectId, block: RenderStatus.() -> RenderStatus) {
        _status.value = block(_status.value).copy(projectId = projectId)
    }
    fun reset() { cancelled.set(false); _status.value = RenderStatus() }
    fun requestCancel() { cancelled.set(true) }
}
