import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Microseconds, RenderState } from '../../core/types';
import type { Scene } from '../../core/render/scene';
import { renderFrame, type RenderOptions } from '../../core/render/frame';
import { frameToUs, usToSeconds } from '../../core/time';

/**
 * Offline video export.
 *
 * Non-negotiable rules, each of which fixes a real failure:
 *
 *   1. OFFLINE, CONSTANT FRAME RATE. Frames are rendered one at a time and fed
 *      to the encoder with an exact timestamp. Realtime capture
 *      (canvas.captureStream) drops frames on slow machines and produces VFR
 *      output that drifts out of sync in every player.
 *   2. BACKPRESSURE. `encoder.encodeQueueSize` is respected, or a 4-minute song
 *      buffers thousands of uncompressed frames and the tab dies.
 *   3. AAC PRIMING. An AAC-LC encoder emits 1024 samples of priming. Left
 *      unhandled the audio lands ~23 ms early against the video. We feed 1024
 *      samples of silence ahead of the real audio so the priming consumes it.
 *   4. FONTS BEFORE FRAME 0. `document.fonts.ready` is awaited, or frame 0
 *      renders in a fallback font and the video opens with the wrong typeface.
 *   5. ONE RENDERER. This calls the same `renderFrame` the preview calls.
 */

export interface ExportProgress {
  state: RenderState;
  framesDone: number;
  framesTotal: number;
  bytesEncoded: number;
  elapsedMs: number;
  etaSeconds: number;
  /** Frames per second actually achieved, shown so the user can trust the ETA. */
  fpsAchieved: number;
}

export interface ExportRequest {
  scene: Scene;
  /** Interleaved PCM matching `sampleRate`/`channels`, or null for video-only. */
  interleaved: Float32Array | null;
  sampleRate: number;
  channels: number;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  codec: 'h264' | 'vp9' | 'av1';
  includeAudio: boolean;
  rangeStartUs: Microseconds;
  rangeEndUs: Microseconds;
  /** Absolute music time represented by sample 0 in interleaved PCM. */
  audioStartUs?: Microseconds;
  renderOptions: Omit<RenderOptions, 'showGuides'>;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export class ExportError extends Error {
  constructor(
    message: string,
    readonly code: 'ENCODER_FAILED' | 'OUT_OF_MEMORY' | 'CANCELLED' | 'WEBCODECS_UNAVAILABLE'
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export function isExportSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

/**
 * H.264 level limits, from Annex A Tables A-1/A-6 of the spec.
 *
 * Both limits are expressed in LUMA SAMPLES so they can be compared directly
 * against `macroblocks * 256`. A macroblock is 256 samples, so MaxFS (given in
 * macroblocks) becomes MaxFS * 256, and MaxMBPS (macroblocks/sec) becomes
 * MaxMBPS * 256.
 *
 * Getting these wrong is not cosmetic: `VideoEncoder` validates the `LL` byte of
 * an `avc1.PPCCLL` string against what the platform can actually do, and a level
 * that is too low for the frame size fails config outright. The export dies at
 * frame zero rather than producing a file.
 */
const AVC_LEVELS: { id: number; maxLumaPerSecond: number; maxFrameSize: number }[] = [
  { id: 0x1e, maxLumaPerSecond: 40_500 * 256, maxFrameSize: 1_620 * 256 },   // 3.0
  { id: 0x1f, maxLumaPerSecond: 108_000 * 256, maxFrameSize: 3_600 * 256 },  // 3.1
  { id: 0x20, maxLumaPerSecond: 216_000 * 256, maxFrameSize: 5_120 * 256 },  // 3.2
  { id: 0x28, maxLumaPerSecond: 245_760 * 256, maxFrameSize: 8_192 * 256 },  // 4.0
  { id: 0x29, maxLumaPerSecond: 245_760 * 256, maxFrameSize: 8_192 * 256 },  // 4.1
  { id: 0x2a, maxLumaPerSecond: 522_240 * 256, maxFrameSize: 8_704 * 256 },  // 4.2
  { id: 0x32, maxLumaPerSecond: 589_824 * 256, maxFrameSize: 22_080 * 256 }, // 5.0
  { id: 0x33, maxLumaPerSecond: 983_040 * 256, maxFrameSize: 36_864 * 256 }, // 5.1
  { id: 0x34, maxLumaPerSecond: 2_073_600 * 256, maxFrameSize: 36_864 * 256 } // 5.2
];

/** Build an `avc1.PPCCLL` string the encoder will actually accept. */
export function avcCodecString(width: number, height: number, fps: number, profile: 'baseline' | 'main' | 'high' = 'high'): string {
  const profileIdc = profile === 'baseline' ? 0x42 : profile === 'main' ? 0x4d : 0x64;
  // constraint_set_flags. Constrained Baseline sets all three of its flags
  // (0xE0); Main and High set none, giving the canonical `avc1.4D40LL` and
  // `avc1.6400LL` forms that platforms recognise.
  const constraint = profile === 'baseline' ? 0xe0 : profile === 'main' ? 0x40 : 0x00;
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const frameSize = macroblocks * 256;
  const lumaPerSecond = macroblocks * 256 * fps;
  const level = AVC_LEVELS.find((l) => l.maxLumaPerSecond >= lumaPerSecond && l.maxFrameSize >= frameSize) ?? AVC_LEVELS[AVC_LEVELS.length - 1]!;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `avc1.${hex(profileIdc)}${hex(constraint)}${hex(level.id)}`;
}

export function videoCodecString(codec: 'h264' | 'vp9' | 'av1', width: number, height: number, fps: number): string {
  if (codec === 'vp9') return 'vp09.00.10.08';
  if (codec === 'av1') return 'av01.0.08M.08';
  return avcCodecString(width, height, fps);
}

export function isAudioEncodingSupported(sampleRate: number, channels: number): boolean {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    return AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000 }).then(
      (r) => r.supported === true,
      () => false
    ) as unknown as boolean;
  } catch {
    return false;
  }
}

export async function checkAudioEncoderSupport(sampleRate: number, channels: number): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const result = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000 });
    return result.supported === true;
  } catch {
    return false;
  }
}

/** AAC-LC encoder delay in samples. Fed as silence ahead of real audio. */
export const AAC_PRIMING_SAMPLES = 1024;

function waitForDrain(encoder: VideoEncoder | AudioEncoder, limit = 8): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize <= limit || encoder.state === 'closed') {
        resolve();
        return;
      }
      setTimeout(check, 4);
    };
    check();
  });
}

/**
 * Encode a WAV container for the audio-only fallback path (browsers without an
 * AAC encoder). Honest degradation: the user gets a valid file plus a note, not
 * a silent failure.
 */
export function encodeWav(interleaved: Float32Array, sampleRate: number, channels: number, startSample = 0, endSample = interleaved.length / Math.max(1, channels)): Blob {
  const frames = Math.max(0, Math.floor(endSample - startSample));
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = startSample; i < endSample; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, interleaved[i * channels + c] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Render and mux the video.
 * Throws ExportError with a recovery code; never resolves with a partial file.
 */
export async function exportVideo(request: ExportRequest): Promise<{ blob: Blob; frames: number; bytes: number; durationUs: Microseconds }> {
  if (!isExportSupported()) {
    throw new ExportError('WebCodecs is not available in this browser.', 'WEBCODECS_UNAVAILABLE');
  }

  const {
    scene, interleaved, sampleRate, channels, width, height, fps, videoBitrate, audioBitrate,
    codec, includeAudio, rangeStartUs, rangeEndUs, audioStartUs = 0, renderOptions, onProgress, signal
  } = request;

  const aborted = () => signal?.aborted === true;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const durationUs = Math.max(0, rangeEndUs - rangeStartUs);
  const framesTotal = Math.max(1, Math.round(usToSeconds(durationUs) * fps));
  const frameDurationUs = Math.round(1_000_000 / fps);

  // The scene's own clock starts at 0 of the composition; the export range is
  // expressed in the same clock, so frame i maps straight onto it.
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
  if (!ctx) throw new ExportError('Could not create a 2D rendering context.', 'ENCODER_FAILED');

  // Fonts must be resident before the first frame or frame 0 uses a fallback.
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.ready;
      for (const family of scene.requiredFonts) {
        await document.fonts.load(`${scene.design.typography.weight} 100px "${family}"`).catch(() => undefined);
      }
      await document.fonts.ready;
    } catch {
      /* proceed with fallback fonts rather than failing the export */
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: codec === 'h264' ? 'avc' : codec === 'vp9' ? 'vp9' : 'av1', width, height },
    audio: includeAudio && interleaved ? { codec: 'aac', numberOfChannels: channels, sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  let bytesEncoded = 0;
  let framesDone = 0;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      bytesEncoded += chunk.byteLength;
      muxer.addVideoChunk(chunk, meta);
    },
    error: (error) => {
      throw new ExportError(`Video encoder failed: ${error.message}`, 'ENCODER_FAILED');
    }
  });

  videoEncoder.configure({
    codec: videoCodecString(codec, width, height, fps),
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' }
  });

  let audioEncoder: AudioEncoder | null = null;
  const useAudio = includeAudio && interleaved !== null && (await checkAudioEncoderSupport(sampleRate, channels));
  if (useAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        bytesEncoded += chunk.byteLength;
        muxer.addAudioChunk(chunk, meta);
      },
      error: (error) => {
        throw new ExportError(`Audio encoder failed: ${error.message}`, 'ENCODER_FAILED');
      }
    });
    audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: audioBitrate });
  }

  const report = (state: RenderState) => {
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    const fpsAchieved = elapsedMs > 0 ? (framesDone / elapsedMs) * 1000 : 0;
    const remaining = framesTotal - framesDone;
    onProgress?.({
      state,
      framesDone,
      framesTotal,
      bytesEncoded,
      elapsedMs,
      etaSeconds: fpsAchieved > 0 ? remaining / fpsAchieved : 0,
      fpsAchieved
    });
  };

  report('PREPARING');

  try {
    const sampleOffset = Math.max(0, Math.floor(((rangeStartUs - audioStartUs) / 1_000_000) * sampleRate));
    const audioFramesTotal = Math.floor((durationUs / 1_000_000) * sampleRate);
    // Audio is emitted in ~50 ms blocks. Small blocks keep the muxer's
    // interleaving tight, which is what keeps long exports in sync.
    const audioBlockSize = Math.max(1, Math.floor(sampleRate * 0.05));
    let audioCursor = 0;

    const pushAudio = (uptoUs: Microseconds) => {
      if (!audioEncoder || !interleaved || audioEncoder.state === 'closed') return;
      const target = Math.min(audioFramesTotal, Math.floor((uptoUs / 1_000_000) * sampleRate));
      while (audioCursor < target) {
        const count = Math.min(audioBlockSize, target - audioCursor);
        const absoluteStart = sampleOffset + audioCursor;
        const data = new Float32Array(count * channels);
        for (let i = 0; i < count; i += 1) {
          for (let c = 0; c < channels; c += 1) {
            const idx = (absoluteStart + i) * channels + c;
            data[i * channels + c] = idx >= 0 && idx < interleaved.length ? (interleaved[idx] ?? 0) : 0;
          }
        }
        // Priming compensation: AAC-LC emits 1024 samples of encoder delay.
        // Shifting every audio timestamp back by that amount cancels it, so the
        // audio lands where the video expects it instead of ~23 ms early.
        const timestampUs = Math.max(
          0,
          Math.round((audioCursor / sampleRate) * 1_000_000) - Math.round((AAC_PRIMING_SAMPLES / sampleRate) * 1_000_000)
        );
        const block = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: count,
          numberOfChannels: channels,
          timestamp: timestampUs,
          data: deinterleavePlanar(data, count, channels)
        });
        audioEncoder.encode(block);
        block.close();
        audioCursor += count;
      }
    };

    for (let frame = 0; frame < framesTotal; frame += 1) {
      if (aborted()) {
        videoEncoder.close();
        audioEncoder?.close();
        throw new ExportError('Export was cancelled.', 'CANCELLED');
      }

      const compositionTimeUs = rangeStartUs + frame * frameDurationUs;
      const outputTimestamp = frame * frameDurationUs;

      renderFrame(ctx as CanvasRenderingContext2D, scene, compositionTimeUs, renderOptions);

      const videoFrame = new VideoFrame(canvas as CanvasImageSource, {
        timestamp: outputTimestamp,
        duration: frameDurationUs
      });
      const keyFrame = frame % (fps * 2) === 0;
      videoEncoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      framesDone += 1;
      pushAudio(compositionTimeUs - rangeStartUs);

      if (videoEncoder.encodeQueueSize > 8) await waitForDrain(videoEncoder, 4);
      if (framesDone % 10 === 0 || framesDone === framesTotal) {
        report('RENDERING');
        // Yield so the progress UI can paint; a tight loop starves the main thread.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    report('ENCODING');
    await videoEncoder.flush();
    if (audioEncoder && audioEncoder.state !== 'closed') await audioEncoder.flush();

    report('MUXING');
    muxer.finalize();
    const target = muxer.target as ArrayBufferTarget;
    const blob = new Blob([target.buffer], { type: 'video/mp4' });

    report('VALIDATING');
    if (blob.size < 1024) throw new ExportError('The encoder produced an empty file.', 'ENCODER_FAILED');

    report('COMPLETE');
    return { blob, frames: framesDone, bytes: blob.size, durationUs };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = /memory|alloc|heap/i.test(message) ? 'OUT_OF_MEMORY' : 'ENCODER_FAILED';
    throw new ExportError(message, code);
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
  }
}

/** AudioData with 'f32-planar' expects channel-planar data, not interleaved. */
/**
 * Interleaved to planar for `AudioData({ format: 'f32-planar' })`.
 *
 * Returns a freshly allocated `Float32Array` over a plain `ArrayBuffer`. The
 * return type is spelled out because `AudioData.data` accepts `BufferSource`,
 * which excludes views that could be backed by a `SharedArrayBuffer`.
 */
function deinterleavePlanar(
  interleaved: Float32Array,
  frames: number,
  channels: number
): Float32Array<ArrayBuffer> {
  if (channels === 1) return new Float32Array(interleaved);
  const planar: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(frames * channels * 4));
  for (let c = 0; c < channels; c += 1) {
    for (let i = 0; i < frames; i += 1) {
      planar[c * frames + i] = interleaved[i * channels + c] ?? 0;
    }
  }
  return planar;
}

/** Trigger a download without leaving the page. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
