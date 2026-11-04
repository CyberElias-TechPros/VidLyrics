package com.vidlyrics.studio.media

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.vidlyrics.core.Time
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

data class PlaybackState(
    val positionUs: Long = 0,
    val durationUs: Long = 0,
    val playing: Boolean = false,
    val speed: Float = 1f,
    val ready: Boolean = false,
    val loopStartUs: Long? = null,
    val loopEndUs: Long? = null
)

/**
 * Playback is the ONLY clock the editor trusts. Tap-sync timestamps and the
 * preview playhead read player.currentPosition (the audio clock), never
 * System.currentTimeMillis(), so a UI stall cannot shift a lyric.
 */
class PlaybackController(context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val player: ExoPlayer = ExoPlayer.Builder(context).build().apply {
        repeatMode = Player.REPEAT_MODE_OFF
    }
    private val _state = MutableStateFlow(PlaybackState())
    val state: StateFlow<PlaybackState> = _state.asStateFlow()
    private var ticker: Job? = null
    private var loopStart: Long? = null
    private var loopEnd: Long? = null

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _state.value = _state.value.copy(playing = isPlaying)
        }
        override fun onPlaybackStateChanged(playbackState: Int) {
            val ready = playbackState == Player.STATE_READY
            _state.value = _state.value.copy(ready = ready,
                durationUs = if (ready && player.duration > 0) player.duration * Time.US_PER_MS else _state.value.durationUs)
        }
    }

    init { player.addListener(listener) }

    fun prepare(file: File) {
        player.stop()
        player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
        player.prepare()
        _state.value = _state.value.copy(ready = false, positionUs = 0, playing = false)
        startTicker()
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (true) {
                if (_state.value.ready) {
                    val posUs = player.currentPosition * Time.US_PER_MS
                    val end = loopEnd
                    if (end != null && posUs >= end) {
                        player.seekTo((loopStart ?: 0) / Time.US_PER_MS)
                    } else {
                        _state.value = _state.value.copy(positionUs = posUs)
                    }
                }
                delay(16L) // ~60 fps playhead updates; scrub stays under one frame
            }
        }
    }

    fun play() { player.play() }
    fun pause() { player.pause() }
    fun toggle() { if (player.isPlaying) player.pause() else player.play() }
    fun seek(us: Long) {
        val clamped = us.coerceIn(0, _state.value.durationUs.coerceAtLeast(0))
        player.seekTo(clamped / Time.US_PER_MS)
        _state.value = _state.value.copy(positionUs = clamped)
    }
    fun nudge(deltaUs: Long) = seek(_state.value.positionUs + deltaUs)

    fun setSpeed(speed: Float) {
        val s = speed.coerceIn(0.25f, 2f)
        player.setPlaybackSpeed(s)
        _state.value = _state.value.copy(speed = s)
    }

    fun setLoop(startUs: Long?, endUs: Long?) {
        loopStart = startUs; loopEnd = endUs
        _state.value = _state.value.copy(loopStartUs = startUs, loopEndUs = endUs)
    }

    fun setVolume(volume: Float) { player.volume = volume.coerceIn(0f, 1f) }

    fun release() {
        ticker?.cancel()
        scope.cancel()
        player.removeListener(listener)
        player.release()
    }
}
