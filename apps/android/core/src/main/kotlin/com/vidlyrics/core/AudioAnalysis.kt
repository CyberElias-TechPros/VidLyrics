package com.vidlyrics.core

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * On-device audio analysis.
 *
 * Unlike the web implementation, this does NOT hold the whole decoded song in
 * RAM. AudioAnalysisSink consumes small PCM chunks as MediaCodec decodes them,
 * computing waveform peaks and a log-mel band envelope incrementally. A
 * 10-minute track costs a few hundred kilobytes of analysis state instead of
 * 100+ MB of PCM — the difference between a render that completes on a
 * mid-range phone and one that is killed by the low-memory killer.
 */
const val BAND_COUNT = 32

data class PeakData(
    /** Interleaved [min, max, rms] triples. */
    val data: FloatArray,
    val buckets: Int,
    val bucketUs: Microseconds,
    val durationUs: Microseconds,
    val sampleRate: Int,
    val channels: Int,
    val peakAmplitude: Float
)

data class PeakSample(val min: Float, val max: Float, val rms: Float)

data class SpectrumEnvelope(
    /** frameCount * BAND_COUNT unsigned 0..255 values. */
    val bands: ByteArray,
    val frameCount: Int,
    val frameUs: Microseconds,
    val sampleRate: Int,
    val fftSize: Int,
    val bandCount: Int = BAND_COUNT,
    val bandMeans: FloatArray = FloatArray(BAND_COUNT)
)

data class BeatGrid(
    val bpm: Double, val beats: List<Microseconds>, val confidence: Double,
    val intervalUs: Microseconds
)

data class AudioAnalysis(
    val peaks: PeakData,
    val spectrum: SpectrumEnvelope,
    val beatGrid: BeatGrid?,
    /** Per-frame vocal-band energy ratio 0..1; used by auto-sync. */
    val vocalActivity: FloatArray,
    val frameUs: Microseconds,
    val durationUs: Microseconds,
    val sampleRate: Int
)

fun melBandEdges(sampleRate: Int, fftSize: Int, bandCount: Int): IntArray {
    val nyquist = sampleRate / 2.0
    val melHigh = 2595 * log10(1 + nyquist / 700)
    val binHz = sampleRate.toDouble() / fftSize
    return IntArray(bandCount + 1) { i ->
        val hz = 700 * (Math.pow(10.0, (melHigh * i / bandCount) / 2595) - 1)
        min(fftSize / 2, max(1, Math.round(hz / binHz).toInt()))
    }
}

class AudioAnalysisSink(
    val sampleRate: Int,
    val channels: Int = 1,
    val bucketUs: Microseconds = 10_000,
    fftSize: Int = 1024,
    hopSize: Int = 512
) {
    val fftSize: Int = nextPowerOfTwo(fftSize)
    val hopSize: Int = min(this.fftSize, max(1, hopSize))
    private val samplesPerBucket = max(1, Math.round(bucketUs / 1_000_000.0 * sampleRate).toInt())
    private val edges = melBandEdges(sampleRate, this.fftSize, BAND_COUNT)
    private val scratch = FloatArray(this.fftSize * 2)
    private val mag = FloatArray(this.fftSize / 2 + 1)
    private val window = FloatArray(this.fftSize)
    private var windowFilled = 0
    private var totalSamples = 0L
    private var peaks = FloatArray(1024 * 3)
    private var bucketCount = 0
    private var bucketIndex = 0
    private var bucketMin = 1f
    private var bucketMax = -1f
    private var bucketSumSquares = 0.0
    private var bucketSamples = 0
    private var peakAmplitude = 0f
    private var bands = ByteArray(1024 * BAND_COUNT)
    private var frames = 0
    private val bandTotals = DoubleArray(BAND_COUNT)
    private val vocal = ArrayList<Float>()

    /** Feed MONO float samples in [-1,1]. Downmixing happens in the decoder. */
    fun push(samples: FloatArray, length: Int = samples.size) {
        for (i in 0 until min(length, samples.size)) {
            val s = samples[i]
            val a = abs(s)
            if (a > peakAmplitude) peakAmplitude = a
            if (s < bucketMin) bucketMin = s
            if (s > bucketMax) bucketMax = s
            bucketSumSquares += s.toDouble() * s
            bucketSamples++
            totalSamples++
            if (bucketSamples >= samplesPerBucket) flushBucket()

            window[windowFilled++] = s
            if (windowFilled == this.fftSize) {
                computeFrame()
                System.arraycopy(window, hopSize, window, 0, this.fftSize - hopSize)
                windowFilled = this.fftSize - hopSize
            }
        }
    }

    private fun flushBucket() {
        ensurePeakCapacity(bucketCount + 1)
        val minV = if (bucketSamples == 0) 0f else bucketMin
        val maxV = if (bucketSamples == 0) 0f else bucketMax
        val rms = if (bucketSamples == 0) 0f else kotlin.math.sqrt(bucketSumSquares / bucketSamples).toFloat()
        peaks[bucketCount * 3] = minV
        peaks[bucketCount * 3 + 1] = maxV
        peaks[bucketCount * 3 + 2] = rms
        bucketCount++
        bucketIndex++
        bucketMin = 1f; bucketMax = -1f; bucketSumSquares = 0.0; bucketSamples = 0
    }

    private fun ensurePeakCapacity(needed: Int) {
        if (needed * 3 <= peaks.size) return
        peaks = peaks.copyOf(maxOf(peaks.size * 2, needed * 3))
    }

    private fun computeFrame() {
        if (frames * BAND_COUNT + BAND_COUNT > bands.size) bands = bands.copyOf(maxOf(bands.size * 2, (frames + 1) * BAND_COUNT))
        magnitudeSpectrum(window, fftSize, mag, scratch)
        var total = 0.0
        var vocalEnergy = 0.0
        for (b in 0 until BAND_COUNT) {
            val lo = edges[b]
            val hi = max(lo + 1, edges[b + 1])
            var sum = 0.0
            var k = lo
            while (k < hi && k < mag.size) { sum += mag[k]; k++ }
            val energy = sum / max(1, hi - lo)
            val scaled = min(255.0, max(0.0, 255 * (log10(1 + energy * 400) / 3))).roundToInt()
            bands[frames * BAND_COUNT + b] = scaled.toByte()
            bandTotals[b] += scaled
            total += scaled
            // Mel bands ~8..24 cover roughly 300 Hz–3.5 kHz: the vocal region.
            if (b in 8..24) vocalEnergy += scaled
        }
        vocal.add(if (total > 0) (vocalEnergy / total).toFloat() else 0f)
        frames++
    }

    fun finish(): AudioAnalysis {
        if (bucketSamples > 0) flushBucket()
        val durationUs = Time.fromSeconds(totalSamples.toDouble() / sampleRate)
        val peakData = PeakData(peaks.copyOf(bucketCount * 3), bucketCount, bucketUs, durationUs,
            sampleRate, channels, peakAmplitude)
        val means = FloatArray(BAND_COUNT) { b -> (bandTotals[b] / max(1, frames)).toFloat() }
        val env = SpectrumEnvelope(bands.copyOf(frames * BAND_COUNT), frames,
            Time.fromSeconds(hopSize.toDouble() / sampleRate), sampleRate, fftSize,
            BAND_COUNT, means)
        val smoothedVocal = FloatArray(vocal.size) { i ->
            var sum = 0f; var count = 0
            for (j in max(0, i - 3)..min(vocal.size - 1, i + 3)) { sum += vocal[j]; count++ }
            if (count > 0) sum / count else 0f
        }
        return AudioAnalysis(peakData, env, detectBeatGrid(env), smoothedVocal,
            env.frameUs, durationUs, sampleRate)
    }
}

/** Convenience for tests and small files. */
fun analysePcm(pcm: FloatArray, sampleRate: Int, channels: Int = 1, chunk: Int = 4096): AudioAnalysis {
    val sink = AudioAnalysisSink(sampleRate, channels)
    var i = 0
    while (i < pcm.size) {
        val n = min(chunk, pcm.size - i)
        sink.push(pcm.copyOfRange(i, i + n), n)
        i += n
    }
    return sink.finish()
}

fun peaksInRange(peaks: PeakData, startUs: Microseconds, endUs: Microseconds): PeakSample {
    if (peaks.buckets == 0) return PeakSample(0f, 0f, 0f)
    val first = max(0, Math.floor(startUs.toDouble() / peaks.bucketUs).toInt())
    val last = min(peaks.buckets - 1, Math.ceil(endUs.toDouble() / peaks.bucketUs).toInt())
    var mn = 1f; var mx = -1f; var rms = 0f; var count = 0
    for (i in first..last) {
        val vMin = peaks.data[i * 3]; val vMax = peaks.data[i * 3 + 1]
        if (vMin < mn) mn = vMin
        if (vMax > mx) mx = vMax
        rms += peaks.data[i * 3 + 2]; count++
    }
    return if (count == 0) PeakSample(0f, 0f, 0f) else PeakSample(mn, mx, rms / count)
}

fun decimate(peaks: PeakData, startUs: Microseconds, endUs: Microseconds, pixels: Int): List<PeakSample> {
    if (pixels <= 0 || endUs <= startUs) return emptyList()
    val step = (endUs - startUs).toDouble() / pixels
    return (0 until pixels).map { p ->
        peaksInRange(peaks, startUs + (p * step).toLong(), startUs + ((p + 1) * step).toLong())
    }
}

fun bandsAt(env: SpectrumEnvelope, timeUs: Microseconds): IntArray {
    val out = IntArray(BAND_COUNT)
    if (env.frameCount == 0 || timeUs < 0) return out
    val frame = (timeUs / max(1L, env.frameUs)).toInt()
    if (frame >= env.frameCount) return out
    for (b in 0 until BAND_COUNT) out[b] = env.bands[frame * BAND_COUNT + b].toInt() and 0xFF
    return out
}

fun energyAt(env: SpectrumEnvelope, timeUs: Microseconds, bandIndex: Double): Double {
    val bands = bandsAt(env, timeUs)
    val idx = min(BAND_COUNT - 1, max(0, Math.round(bandIndex * (BAND_COUNT - 1)).toInt()))
    return min(1.6, bands[idx] / max(8.0, env.bandMeans[idx].toDouble()))
}

/* --------------------------- beat detection --------------------------- */

fun onsetEnvelope(env: SpectrumEnvelope): FloatArray {
    val out = FloatArray(env.frameCount)
    var previous: FloatArray? = null
    for (f in 0 until env.frameCount) {
        var positive = 0f
        for (b in 0 until BAND_COUNT) {
            val v = (env.bands[f * BAND_COUNT + b].toInt() and 0xFF).toFloat()
            val prev = previous?.get(b) ?: v
            positive += max(0f, v - prev)
        }
        val current = FloatArray(BAND_COUNT) { b -> (env.bands[f * BAND_COUNT + b].toInt() and 0xFF).toFloat() }
        previous = current
        out[f] = positive / BAND_COUNT
    }
    return out
}

private fun normalise(src: FloatArray): FloatArray {
    var max = 0f
    for (v in src) if (v > max) max = v
    if (max <= 0f) return FloatArray(src.size)
    return FloatArray(src.size) { i -> src[i] / max }
}

/** Adaptive-whitened onset strength with non-maximum suppression. */
fun prepareOnsetEnvelope(raw: FloatArray): FloatArray {
    val n = raw.size
    if (n == 0) return raw
    val residual = FloatArray(n)
    val half = 8
    for (i in 0 until n) {
        var sum = 0f; var count = 0
        for (j in max(0, i - half)..min(n - 1, i + half)) { sum += raw[j]; count++ }
        residual[i] = max(0f, raw[i] - if (count > 0) sum / count else 0f)
    }
    val peaks = FloatArray(n)
    val radius = 2
    for (i in 0 until n) {
        val value = residual[i]
        var isMax = true
        for (j in max(0, i - radius)..min(n - 1, i + radius)) {
            if (j != i && residual[j] > value) { isMax = false; break }
        }
        if (isMax) peaks[i] = value
    }
    val smoothed = FloatArray(n)
    for (i in 0 until n) {
        var sum = 0f; var count = 0
        for (j in max(0, i - 2)..min(n - 1, i + 2)) { sum += peaks[j]; count++ }
        smoothed[i] = if (count > 0) sum / count else 0f
    }
    return normalise(smoothed)
}

private fun tempoPrior(bpm: Double, centre: Double = 120.0, sigmaOctaves: Double = 0.9): Double {
    val octaves = ln(bpm / centre) / ln(2.0)
    return exp(-0.5 * (octaves / sigmaOctaves) * (octaves / sigmaOctaves))
}

data class TempoEstimate(val bpm: Double, val confidence: Double)

fun estimateTempo(env: SpectrumEnvelope, minBpm: Double = 60.0, maxBpm: Double = 190.0): TempoEstimate {
    val onset = prepareOnsetEnvelope(onsetEnvelope(env))
    if (onset.size < 64 || (onset.maxOrNull() ?: 0f) <= 0f) return TempoEstimate(0.0, 0.0)
    val frameSeconds = env.frameUs / 1_000_000.0
    if (frameSeconds <= 0) return TempoEstimate(0.0, 0.0)
    val minLag = max(2, Math.floor(60 / maxBpm / frameSeconds).toInt())
    val maxLag = min(onset.size - 1, Math.ceil(60 / minBpm / frameSeconds).toInt())
    if (maxLag <= minLag) return TempoEstimate(0.0, 0.0)
    var bestLag = minLag
    var bestScore = Double.NEGATIVE_INFINITY
    for (lag in minLag..maxLag) {
        var sum = 0.0; var count = 0
        var i = 0
        while (i + lag < onset.size) { sum += onset[i] * onset[i + lag]; count++; i++ }
        val raw = if (count > 0) sum / count else 0.0
        val bpm = 60.0 / (lag * frameSeconds)
        val score = raw * tempoPrior(bpm)
        if (score > bestScore) { bestScore = score; bestLag = lag }
    }
    return TempoEstimate(Math.round(60.0 / (bestLag * frameSeconds) * 10) / 10.0,
        min(1.0, max(0.0, bestScore * 4)))
}

fun detectBeatGrid(env: SpectrumEnvelope): BeatGrid? {
    val (bpm, confidence) = estimateTempo(env)
    if (bpm <= 0 || env.frameUs <= 0) return null
    val frameSeconds = env.frameUs / 1_000_000.0
    val lagFrames = max(1, Math.round(60 / bpm / frameSeconds).toInt())
    val intervalUs = Math.round(lagFrames * env.frameUs.toDouble())
    if (intervalUs <= 0) return null
    val onset = normalise(onsetEnvelope(env))
    var bestPhase = 0; var bestScore = Double.NEGATIVE_INFINITY
    for (phase in 0 until min(lagFrames, onset.size)) {
        var score = 0.0
        var i = phase
        while (i < onset.size) { score += onset[i]; i += lagFrames }
        if (score > bestScore) { bestScore = score; bestPhase = phase }
    }
    val totalUs = env.frameCount * env.frameUs
    val beats = ArrayList<Microseconds>()
    var t = Math.round(bestPhase * env.frameUs.toDouble())
    while (t < totalUs) { beats += t; t += intervalUs }
    return BeatGrid(bpm, beats, confidence, intervalUs)
}

fun beatStrength(grid: BeatGrid?, timeUs: Microseconds, toleranceUs: Microseconds): Double {
    if (grid == null || grid.beats.isEmpty()) return 0.0
    var best = Double.POSITIVE_INFINITY
    for (b in grid.beats) {
        val d = abs(b - timeUs)
        if (d < best) best = d.toDouble()
        if (b > timeUs + toleranceUs) break
    }
    return if (best <= toleranceUs) 1.0 - best / toleranceUs else 0.0
}
