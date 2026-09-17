import type { AssetRecord, Line, Project } from '../core/types';
import { usFromSeconds } from '../core/time';
import { appError, type ErrorCode } from '../core/errors';
import { sha256Hex, sanitizeFileName, validateAudioFile, validateAudioDuration, MAX_AUDIO_BYTES } from '../core/validation/files';
import { decodeAudioFile, DecodeError } from './audio/decode';
import { PlaybackEngine } from './audio/player';
import { exportVideo, downloadBlob, isExportSupported, checkAudioEncoderSupport, encodeWav, ExportError } from './export/encoder';
import { createMeasureFn } from './canvasMeasurer';
import { buildScene } from '../core/render/scene';
import { detectBeatGrid } from '../core/audio/beats';
import { serialisePeaks, deserialisePeaks, type PeakData } from '../core/audio/peaks';
import { newId } from '../core/project/factory';
import { loadProjectJson, ProjectFormatError } from '../core/project/migrate';
import { buildProjectFile, serialiseProjectFile, suggestedFileName, serialiseSubtitle, type SubtitleFormat } from '../core/export/subtitles';
import { saveProject, saveAsset, getAssetPayload, loadProject, listAssets } from '../storage/projectRepo';
import { estimateStorage, StorageQuotaError } from '../storage/idb';
import { useEditor } from '../state/store';
import { getEdgeClient } from '../backend/edge';
import { estimateRender } from '../core/design/tokens';

/**
 * Session orchestration.
 *
 * Everything that touches a File, an AudioContext, IndexedDB or the encoder
 * lives here rather than in components, so a component can never start a render
 * behind the store's back and leave the UI showing a state the app is not in.
 */

let engine: PlaybackEngine | null = null;
let decoded: { interleaved: Float32Array; sampleRate: number; channels: number } | null = null;
let abortController: AbortController | null = null;

export function getEngine(): PlaybackEngine | null {
  return engine;
}

export function getDecodedAudio(): { interleaved: Float32Array; sampleRate: number; channels: number } | null {
  return decoded;
}

export function ensureEngine(): PlaybackEngine {
  if (!engine) {
    engine = new PlaybackEngine({
      onTick: (positionUs) => useEditor.getState().setPlayhead(positionUs),
      onStateChange: (state) => useEditor.getState().setPlaying(state === 'playing'),
      onEnded: () => useEditor.getState().setPlaying(false)
    });
  }
  return engine;
}

export async function importAudioFile(file: File): Promise<void> {
  const store = useEditor.getState();
  const edge = getEdgeClient();
  store.setMedia({ state: 'IMPORTING', stage: 'reading', progress: 0, error: null });

  const check = validateAudioFile(file.name, file.type, file.size);
  if (!check.ok && check.errorCode) {
    store.setMedia({ state: 'FAILED', stage: 'idle', progress: 0, error: appError(check.errorCode, `${file.name} ${file.type} ${file.size}b`) });
    return;
  }

  abortController?.abort();
  abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_AUDIO_BYTES) throw new DecodeError('File exceeds the size limit.', 'AUDIO_TOO_LARGE');

    const contentHash = await sha256Hex(buffer);

    store.setMedia({ state: 'DECODING', stage: 'decoding', progress: 0.05 });
    const result = await decodeAudioFile(buffer, {
      signal,
      onProgress: (stage, progress) => {
        store.setMedia({
          state: stage === 'decoding' ? 'DECODING' : 'ANALYZING',
          stage,
          progress: stage === 'peaks' ? 0.35 + progress * 0.3 : stage === 'spectrum' ? 0.65 + progress * 0.3 : progress * 0.3
        });
      }
    });

    const durationCheck = validateAudioDuration(result.durationUs);
    if (!durationCheck.ok && durationCheck.errorCode) {
      store.setMedia({ state: 'FAILED', stage: 'idle', progress: 0, error: appError(durationCheck.errorCode) });
      return;
    }

    const audioAssetId = `aud_${contentHash.slice(0, 24)}`;
    const peaksAssetId = `pk_${contentHash.slice(0, 24)}`;
    const audioRecord: AssetRecord = {
      id: audioAssetId,
      kind: 'audio',
      fileName: sanitizeFileName(file.name),
      mimeType: file.type || 'audio/mpeg',
      bytes: file.size,
      contentHash,
      createdAt: Date.now()
    };
    const peaksRecord: AssetRecord = { ...audioRecord, id: peaksAssetId, kind: 'peaks' };

    // Assets are stored only after a successful decode, so a rejected file never
    // leaves an orphan in IndexedDB.
    await saveAsset(audioRecord, buffer);
    await saveAsset(peaksRecord, peaksBlob(result.peaks));

    const beatGrid = result.spectrum ? detectBeatGrid(result.spectrum) : null;
    store.setAnalysis({ peaks: result.peaks, spectrum: result.spectrum, beatGrid });

    decoded = { interleaved: result.interleaved, sampleRate: result.sampleRate, channels: result.channels };
    const player = ensureEngine();
    player.setBuffer(result.interleaved, result.sampleRate, result.channels);
    const loop = useEditor.getState().loop;
    player.setLoop(loop);

    const project = useEditor.getState().project;
    store.commit('Import audio', (p) => ({
      ...p,
      audio: {
        assetId: audioAssetId,
        fileName: sanitizeFileName(file.name),
        mimeType: file.type || 'audio/mpeg',
        bytes: file.size,
        durationUs: result.durationUs,
        sampleRate: result.sampleRate,
        channels: result.channels,
        peaksAssetId,
        contentHash
      },
      export: { ...p.export, rangeStartUs: 0, rangeEndUs: result.durationUs },
      meta: {
        ...p.meta,
        title: p.meta.title || sanitizeFileName(file.name).replace(/\.[^.]+$/, ''),
        artist: p.meta.artist
      }
    }));

    // Re-time untyped lyrics against the real duration now that we know it.
    const lines = useEditor.getState().project.lyrics.lines;
    if (lines.length > 0 && lines.every((l) => l.start === 0 && l.end === 0)) {
      useEditor.getState().generateTimings();
    }

    store.setMedia({ state: 'READY', stage: 'idle', progress: 1, error: null });
    if (durationCheck.warning) {
      store.notify({ kind: 'warning', title: 'Long track', detail: durationCheck.warning });
    }
    if (beatGrid) {
      store.notify({
        kind: 'info',
        title: `Detected ${Math.round(beatGrid.bpm)} BPM`,
        detail: `Confidence ${Math.round(beatGrid.confidence * 100)}%. Beat snapping stays off until you turn it on.`
      });
    }
    edge.track('audio_imported', { bucket: bucketBytes(file.size), outcome: 'success' });
    await persist();
    void project;
  } catch (error) {
    if (signal.aborted) {
      store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('CANCELLED') });
      return;
    }
    const code: ErrorCode =
      error instanceof DecodeError
        ? error.errorCode
        : error instanceof StorageQuotaError
          ? 'STORAGE_QUOTA'
          : 'AUDIO_DECODE_FAILED';
    store.setMedia({
      state: 'FAILED',
      stage: 'idle',
      progress: 0,
      error: appError(code, error instanceof Error ? error.message : String(error))
    });
    edge.track('audio_imported', { outcome: 'failure' });
  }
}

function bucketBytes(bytes: number): string {
  if (bytes < 1_000_000) return '<1mb';
  if (bytes < 10_000_000) return '1-10mb';
  if (bytes < 50_000_000) return '10-50mb';
  return '>50mb';
}

/** Re-link the audio file a project references, verifying the content hash. */
export async function relinkAudioFile(file: File, expectedHash: string): Promise<boolean> {
  const store = useEditor.getState();
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  if (hash !== expectedHash) {
    store.notify({
      kind: 'error',
      title: 'That is a different file',
      detail: 'The content hash does not match the audio this project was built against, so timings would be wrong. Choose the original file.'
    });
    return false;
  }
  await importAudioFile(file);
  return true;
}

/** Restore the decoded audio for a project loaded from disk. */
/**
 * Peaks are stored as JSON rather than a binary blob: they are small (about
 * 250 KB for a three-minute track) and the same serialised form is already used
 * by project export, so one code path covers both.
 */
function peaksBlob(peaks: PeakData): Blob {
  return new Blob([JSON.stringify(serialisePeaks(peaks))], { type: 'application/json' });
}

/**
 * Read a stored waveform back, or null if it is absent or unreadable.
 *
 * A corrupt or legacy entry is deliberately not an error: the waveform is
 * recomputed from the audio as soon as it decodes, so this is a fast path with
 * a correct fallback rather than a dependency.
 */
async function loadStoredPeaks(peaksAssetId: string): Promise<PeakData | null> {
  const payload = await getAssetPayload(peaksAssetId);
  if (!payload) return null;
  try {
    const text = payload instanceof ArrayBuffer ? new TextDecoder().decode(payload) : await payload.text();
    const parsed = JSON.parse(text) as Parameters<typeof deserialisePeaks>[0];
    if (!Array.isArray(parsed?.data) || typeof parsed.buckets !== 'number') return null;
    return deserialisePeaks(parsed);
  } catch {
    return null;
  }
}

export async function hydrateAudioFromStorage(): Promise<boolean> {
  const store = useEditor.getState();
  const audio = store.project.audio;
  if (!audio) return false;
  const payload = await getAssetPayload(audio.assetId);
  if (!payload) {
    store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
    return false;
  }
  // Paint the stored waveform immediately so the timeline is usable during the
  // decode, then overwrite it with the freshly computed one.
  const storedPeaks = await loadStoredPeaks(audio.peaksAssetId);
  if (storedPeaks) store.setAnalysis({ peaks: storedPeaks, spectrum: store.spectrum, beatGrid: store.beatGrid });
  store.setMedia({ state: 'DECODING', stage: 'decoding', progress: 0.1, error: null });
  try {
    const buffer = payload instanceof ArrayBuffer ? payload : await payload.arrayBuffer();
    const result = await decodeAudioFile(buffer, {
      onProgress: (stage, progress) => store.setMedia({ stage, progress })
    });
    decoded = { interleaved: result.interleaved, sampleRate: result.sampleRate, channels: result.channels };
    const beatGrid = result.spectrum ? detectBeatGrid(result.spectrum) : null;
    store.setAnalysis({ peaks: result.peaks, spectrum: result.spectrum, beatGrid });
    ensureEngine().setBuffer(result.interleaved, result.sampleRate, result.channels);
    store.setMedia({ state: 'READY', stage: 'idle', progress: 1, error: null });
    return true;
  } catch (error) {
    store.setMedia({
      state: 'FAILED',
      stage: 'idle',
      progress: 0,
      error: appError('AUDIO_DECODE_FAILED', error instanceof Error ? error.message : String(error))
    });
    return false;
  }
}

/* ------------------------------- playback ------------------------------- */

export async function togglePlayback(): Promise<void> {
  const store = useEditor.getState();
  const player = ensureEngine();
  if (!store.project.audio) {
    store.notify({ kind: 'warning', title: 'No audio yet', detail: 'Import an audio file to play the timeline.' });
    return;
  }
  if (!decoded) {
    const ok = await hydrateAudioFromStorage();
    if (!ok) return;
  }
  const started = await player.toggle();
  if (!started && player.currentState !== 'playing') {
    store.setMedia({ ...store.media, error: appError('AUDIOCONTEXT_BLOCKED') });
  }
}

export function seekTo(timeUs: number): void {
  const store = useEditor.getState();
  ensureEngine().seek(timeUs);
  store.setPlayhead(timeUs);
}

export function nudgePlayhead(deltaUs: number): void {
  const store = useEditor.getState();
  const next = Math.max(0, store.playheadUs + deltaUs);
  seekTo(next);
}

export function setLoopRegion(startUs: number, endUs: number): void {
  const store = useEditor.getState();
  store.setLoop({ startUs, endUs });
  ensureEngine().setLoop({ startUs, endUs });
}

export function clearLoopRegion(): void {
  useEditor.getState().setLoop(null);
  ensureEngine().setLoop(null);
}

export function setPlaybackRate(rate: number): void {
  ensureEngine().setRate(rate);
}

/* -------------------------------- export -------------------------------- */

export function buildCurrentScene(pixelRatio = 1) {
  const state = useEditor.getState();
  const measure = createMeasureFn(state.project.design.typography.fontStack);
  const scene = buildScene(state.project, {
    spectrum: state.spectrum,
    beatGrid: state.beatGrid,
    pixelRatio,
    durationUs: state.project.audio?.durationUs ?? null
  });
  return { scene, measure };
}

export function estimateCurrentExport() {
  const { project } = useEditor.getState();
  return estimateRender(project.export);
}

export async function runExport(): Promise<void> {
  const store = useEditor.getState();
  const edge = getEdgeClient();
  const { project } = store;

  if (!project.audio || !decoded) {
    store.setRender({ state: 'FAILED', error: appError('NO_AUDIO_FOR_RENDER') });
    return;
  }
  if (!isExportSupported()) {
    store.setRender({ state: 'FAILED', error: appError('WEBCODECS_UNAVAILABLE') });
    edge.track('export_failed', { bucket: 'webcodecs-missing' });
    return;
  }
  if (project.lyrics.lines.length === 0) {
    store.setRender({ state: 'FAILED', error: appError('LYRICS_EMPTY') });
    return;
  }

  const { scene, measure } = buildCurrentScene(1);
  abortController?.abort();
  abortController = new AbortController();

  store.setRender({ state: 'QUEUED', progress: 0, framesDone: 0, framesTotal: 0, etaSeconds: 0, error: null, result: null });
  edge.track('export_started', { bucket: `${project.export.width}x${project.export.height}` });

  try {
    const audioSupported = await checkAudioEncoderSupport(decoded.sampleRate, decoded.channels);
    if (project.export.includeAudio && !audioSupported) {
      store.notify({
        kind: 'warning',
        title: 'Audio will be exported separately',
        detail: 'This browser has no AAC encoder, so you will get a silent MP4 plus a WAV file. Mux them in any editor, or use Chrome or Edge for a single file.'
      });
    }

    const output = await exportVideo({
      scene,
      interleaved: project.export.includeAudio && audioSupported ? decoded.interleaved : null,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      width: project.export.width,
      height: project.export.height,
      fps: project.export.fps,
      videoBitrate: project.export.videoBitrate,
      audioBitrate: project.export.audioBitrate,
      codec: project.export.codec,
      includeAudio: project.export.includeAudio && audioSupported,
      rangeStartUs: project.export.rangeStartUs,
      rangeEndUs: Math.min(project.export.rangeEndUs, project.audio.durationUs),
      renderOptions: { measure, showHeat: false },
      signal: abortController.signal,
      onProgress: (progress) =>
        store.setRender({
          state: progress.state,
          progress: progress.framesTotal > 0 ? progress.framesDone / progress.framesTotal : 0,
          framesDone: progress.framesDone,
          framesTotal: progress.framesTotal,
          etaSeconds: Math.round(progress.etaSeconds),
          error: null
        })
    });

    const fileName = project.export.fileName.trim()
      ? sanitizeFileName(project.export.fileName.trim(), 'lyric-video') + '.mp4'
      : suggestedFileName(project, '.mp4');

    store.setRender({
      state: 'COMPLETE',
      progress: 1,
      result: { blob: output.blob, fileName, bytes: output.bytes, frames: output.frames },
      error: null
    });
    downloadBlob(output.blob, fileName);

    if (project.export.includeAudio && !audioSupported) {
      const startSample = Math.floor((project.export.rangeStartUs / 1_000_000) * decoded.sampleRate);
      const endSample = Math.floor((Math.min(project.export.rangeEndUs, project.audio.durationUs) / 1_000_000) * decoded.sampleRate);
      downloadBlob(encodeWav(decoded.interleaved, decoded.sampleRate, decoded.channels, startSample, endSample), suggestedFileName(project, '.wav'));
    }

    edge.track('export_completed', { bucket: `${project.export.width}x${project.export.height}`, outcome: 'success' });
    store.notify({ kind: 'success', title: 'Export complete', detail: `${fileName} — ${output.frames} frames.` });
  } catch (error) {
    if (abortController?.signal.aborted) {
      store.setRender({ state: 'CANCELLED', error: appError('CANCELLED') });
      return;
    }
    const code: ErrorCode =
      error instanceof ExportError ? error.code === 'OUT_OF_MEMORY' ? 'OUT_OF_MEMORY' : error.code === 'CANCELLED' ? 'CANCELLED' : 'ENCODER_FAILED' : 'ENCODER_FAILED';
    store.setRender({ state: 'FAILED', error: appError(code, error instanceof Error ? error.message : String(error)) });
    edge.track('export_failed', { bucket: code, outcome: 'failure' });
  }
}

export function cancelExport(): void {
  abortController?.abort();
  useEditor.getState().setRender({ state: 'CANCELLED', error: appError('CANCELLED') });
}

export function downloadExportResult(): void {
  const result = useEditor.getState().render.result;
  if (result) downloadBlob(result.blob, result.fileName);
}

/* ------------------------------- file I/O ------------------------------- */

export function downloadText(content: string, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([content], { type: mimeType }), fileName);
}

export function exportSubtitle(format: SubtitleFormat): void {
  const store = useEditor.getState();
  const extension = format === 'json' ? '.json' : format === 'ass' ? '.ass' : format === 'srt' ? '.srt' : format === 'vtt' ? '.vtt' : '.lrc';
  const content = serialiseSubtitle(store.project, format, { offsetUs: store.project.export.globalOffsetUs });
  downloadText(content, suggestedFileName(store.project, extension), 'text/plain;charset=utf-8');
  store.notify({ kind: 'success', title: `${format.toUpperCase()} exported` });
  getEdgeClient().track('subtitle_exported', { bucket: format });
}

export async function exportProjectFile(): Promise<void> {
  const store = useEditor.getState();
  const assets = await listAssets();
  const referenced = assets.filter((a) => a.id === store.project.audio?.assetId || a.id === store.project.audio?.peaksAssetId);
  const file = buildProjectFile(store.project, referenced);
  downloadText(serialiseProjectFile(file), suggestedFileName(store.project, '.vidlyricsproject'), 'application/json');
  store.notify({
    kind: 'info',
    title: 'Project exported',
    detail: 'Project files do not embed audio. You will be asked to re-link the original audio file on import.'
  });
  getEdgeClient().track('project_exported');
}

export async function importProjectFile(file: File): Promise<void> {
  const store = useEditor.getState();
  try {
    const text = await file.text();
    const { project, report } = loadProjectJson(JSON.parse(text));
    const audioMissing = project.audio ? !(await getAssetPayload(project.audio.assetId)) : false;
    store.replaceProject(project, { audioMissing });
    if (audioMissing) {
      store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
    } else if (project.audio) {
      await hydrateAudioFromStorage();
    }
    store.notify({
      kind: 'success',
      title: 'Project opened',
      detail: report.steps.length > 0 ? `Migrated from format v${report.fromVersion}.` : undefined
    });
    getEdgeClient().track('project_imported');
    await persist();
  } catch (error) {
    const code: ErrorCode = error instanceof ProjectFormatError ? (error.code === 'FUTURE_VERSION' ? 'IMPORT_FUTURE_VERSION' : 'IMPORT_INVALID_PROJECT') : 'IMPORT_INVALID_PROJECT';
    store.notify({ kind: 'error', title: 'Could not open that project', detail: error instanceof Error ? error.message : String(error) });
    store.setMedia({ ...store.media, error: appError(code, error instanceof Error ? error.message : undefined) });
  }
}

/* ------------------------------ persistence ----------------------------- */

export async function persist(): Promise<void> {
  const store = useEditor.getState();
  try {
    await saveProject(store.project);
    store.markSaved();
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      const estimate = await estimateStorage();
      store.notify({
        kind: 'error',
        title: 'Storage is full',
        detail: estimate
          ? `Using ${(estimate.usageBytes / 1_048_576).toFixed(0)} MB of ${(estimate.quotaBytes / 1_048_576).toFixed(0)} MB. Remove old projects to free space.`
          : 'Remove old projects to free space.'
      });
      store.setMedia({ ...store.media, error: appError('STORAGE_QUOTA') });
      return;
    }
    store.notify({ kind: 'error', title: 'Could not save', detail: error instanceof Error ? error.message : String(error) });
  }
}

export async function loadStoredProject(id: string): Promise<boolean> {
  const store = useEditor.getState();
  const loaded = await loadProject(id);
  if (!loaded) {
    store.notify({ kind: 'error', title: 'Project not found', detail: 'It may have been deleted in another tab.' });
    return false;
  }
  store.replaceProject(loaded.project, { audioMissing: loaded.audioMissing });
  if (loaded.audioMissing) {
    store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
  } else if (loaded.project.audio) {
    await hydrateAudioFromStorage();
  }
  return true;
}

/** Warn before an export that is likely to fail, so the user is not surprised. */
export function preflightExport(project: Project): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const seconds = (project.export.rangeEndUs - project.export.rangeStartUs) / 1_000_000;
  const pixels = project.export.width * project.export.height;
  const frames = seconds * project.export.fps;

  if (pixels >= 3840 * 2160 && seconds > 60) warnings.push('A 4K export over a minute needs a lot of memory. Consider 1080p or a shorter range.');
  if (seconds > 600) warnings.push('Tracks over ten minutes often exceed a browser tab’s memory limit. Export in sections.');
  if (frames > 30_000) warnings.push(`This render is ${Math.round(frames).toLocaleString()} frames. Expect it to take a while.`);
  if (!isExportSupported()) warnings.push('WebCodecs is unavailable, so export cannot run in this browser.');
  return { ok: warnings.length === 0, warnings };
}

/** Total timeline duration used by the timeline ruler and the export range. */
export function timelineDurationUs(): number {
  const { project } = useEditor.getState();
  const lastLine = project.lyrics.lines.reduce((max, l: Line) => Math.max(max, l.end), 0);
  return Math.max(project.audio?.durationUs ?? 0, lastLine, usFromSeconds(1));
}

export function disposeSession(): void {
  abortController?.abort();
  engine?.dispose();
  engine = null;
  decoded = null;
}

export async function storageSummary() {
  return estimateStorage();
}

export { newId };
