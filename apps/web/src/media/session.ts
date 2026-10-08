import type { AssetRecord, Line, Project, VoiceoverMeta } from '../core/types';
import { usFromSeconds } from '../core/time';
import { decodeWav } from '../core/audio/wav';
import { mixVoiceover, voiceoverSourceSignature } from '../core/audio/voiceover';
import { whisperSegmentsToCues, untimedTranscriptCue } from '../core/lyrics/transcript';
import { isInstrumentalMarker } from '../core/lyrics/normalize';
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
import { useEditor, type GenerationState } from '../state/store';
import { getEdgeClient } from '../backend/edge';
import { estimateRender, formatBytes } from '../core/design/tokens';
import {
  rememberInstalledModel, selectBundledPiperModel, selectBundledWhisperModel,
  type SelectedPiperModel, type SelectedWhisperModel
} from './modelBundle';

/**
 * Session orchestration.
 *
 * Everything that touches a File, an AudioContext, IndexedDB or the encoder
 * lives here rather than in components, so a component can never start a render
 * behind the store's back and leave the UI showing a state the app is not in.
 */

let engine: PlaybackEngine | null = null;
let decoded: { pcm: Float32Array; interleaved: Float32Array; sampleRate: number; channels: number; durationUs: number } | null = null;
let voiceoverAudio: { pcm: Float32Array; sampleRate: number; assetId: string } | null = null;
let importController: AbortController | null = null;
let exportController: AbortController | null = null;
let projectEpoch = 0;
let generationWorker: Worker | null = null;
let activeGenerationId: string | null = null;
let activeGenerationKind: 'transcription' | 'voiceover' | null = null;
let generationStartToken: symbol | null = null;

function reserveGenerationStart(): symbol | null {
  if (generationWorker || generationStartToken) return null;
  const token = Symbol('generation-start');
  generationStartToken = token;
  return token;
}

function releaseGenerationStart(token: symbol): void {
  if (generationStartToken === token) generationStartToken = null;
}

interface WhisperWorkerMessage {
  type: 'STATUS' | 'DOWNLOAD_PROGRESS' | 'TRANSCRIBE_PROGRESS' | 'MODEL_READY' | 'RESULT' | 'ERROR' | 'CANCELLED';
  id: string;
  version?: string;
  url?: string;
  bundleId?: string;
  bytes?: number;
  sha256?: string;
  state?: 'DOWNLOADING' | 'LOADING' | 'TRANSCRIBING';
  message?: string;
  loaded?: number;
  total?: number;
  progress?: number;
  language?: string | null;
  text?: string;
  segments?: { text: string; t0: number; t1: number }[];
}

interface VoiceoverWorkerMessage {
  type: 'STATUS' | 'MODEL_PROGRESS' | 'MODEL_READY' | 'LINE_PROGRESS' | 'RESULT' | 'ERROR' | 'CANCELLED';
  id: string;
  version?: string;
  url?: string;
  bundleId?: string;
  bytes?: number;
  state?: 'PREPARING' | 'DOWNLOADING' | 'SYNTHESIZING';
  message?: string;
  loaded?: number;
  total?: number;
  completed?: number;
  pcm?: Float32Array;
  sampleRate?: number;
  durationUs?: number;
  lineCount?: number;
}

function stopActiveGeneration(markCancelled = true): void {
  if (!generationWorker) return;
  const worker = generationWorker;
  const id = activeGenerationId;
  const kind = activeGenerationKind;
  if (id) worker.postMessage({ type: 'CANCEL', id });
  worker.terminate();
  generationWorker = null;
  activeGenerationId = null;
  activeGenerationKind = null;
  if (!markCancelled) return;
  if (kind === 'transcription') {
    useEditor.getState().setTranscription({ state: 'CANCELLED', progress: 0, message: 'Transcription cancelled.', error: null });
  } else if (kind === 'voiceover') {
    useEditor.getState().setVoiceoverJob({ state: 'CANCELLED', progress: 0, message: 'Speech generation cancelled.', error: null });
  }
}

export function getEngine(): PlaybackEngine | null {
  return engine;
}

export function getDecodedAudio(): { pcm: Float32Array; interleaved: Float32Array; sampleRate: number; channels: number; durationUs: number } | null {
  return decoded;
}

function isVoiceoverCurrent(project: Project): boolean {
  return !!project.voiceover && project.voiceover.sourceSignature === voiceoverSourceSignature(project.lyrics.lines);
}

function voiceoverTimelineOffsetUs(project: Project): number {
  return (project.design.intro.enabled ? project.design.intro.durationUs : 0) + project.export.globalOffsetUs;
}

function syncVoiceoverPlayback(): void {
  if (!engine || !decoded) return;
  const project = useEditor.getState().project;
  if (!project.audio) return;
  const meta = project.voiceover;
  const loaded = voiceoverAudio;
  const current = !!meta && isVoiceoverCurrent(project) && loaded?.assetId === meta.assetId;

  if (!current || !meta || !loaded) {
    if (engineVoiceoverAssetId !== null) engine.setVoiceoverBuffer(null, 0);
    engineVoiceoverAssetId = null;
    engine.setVoiceoverMix({ enabled: false, timelineOffsetUs: 0, musicGain: 1, speechGain: 0 });
    return;
  }

  if (engineVoiceoverAssetId !== meta.assetId) {
    engine.setVoiceoverBuffer(loaded.pcm, loaded.sampleRate);
    engineVoiceoverAssetId = meta.assetId;
  }
  engine.setVoiceoverMix({
    enabled: meta.enabled,
    timelineOffsetUs: voiceoverTimelineOffsetUs(project),
    musicGain: meta.musicGain,
    speechGain: meta.speechGain
  });
}

let engineVoiceoverAssetId: string | null = null;

export function ensureEngine(): PlaybackEngine {
  if (!engine) {
    engine = new PlaybackEngine({
      onTick: (positionUs) => useEditor.getState().setPlayhead(positionUs),
      onStateChange: (state) => useEditor.getState().setPlaying(state === 'playing'),
      onEnded: () => useEditor.getState().setPlaying(false)
    });
    syncVoiceoverPlayback();
  }
  return engine;
}

function resetProjectRuntime(): void {
  projectEpoch += 1;
  generationStartToken = null;
  stopActiveGeneration();
  importController?.abort();
  exportController?.abort();
  engine?.dispose();
  engine = null;
  decoded = null;
  voiceoverAudio = null;
  engineVoiceoverAssetId = null;
}

useEditor.subscribe((state, previous) => {
  if (state.project.id !== previous.project.id) {
    resetProjectRuntime();
  } else if (state.project.voiceover?.assetId !== previous.project.voiceover?.assetId) {
    void hydrateVoiceoverFromStorage();
  }
  if (state.project !== previous.project && engine) syncVoiceoverPlayback();
});

export async function importAudioFile(file: File, preloaded?: { buffer: ArrayBuffer; contentHash: string }): Promise<void> {
  const store = useEditor.getState();
  const projectId = store.project.id;
  const runtimeEpoch = projectEpoch;
  if (generationWorker) stopActiveGeneration();
  const edge = getEdgeClient();
  store.setMedia({ state: 'IMPORTING', stage: 'reading', progress: 0, error: null });

  const check = validateAudioFile(file.name, file.type, file.size);
  if (!check.ok && check.errorCode) {
    store.setMedia({ state: 'FAILED', stage: 'idle', progress: 0, error: appError(check.errorCode, `${file.name} ${file.type} ${file.size}b`) });
    return;
  }

  importController?.abort();
  exportController?.abort();
  importController = new AbortController();
  const signal = importController.signal;
  const isCurrentImport = () => !signal.aborted && projectEpoch === runtimeEpoch && useEditor.getState().project.id === projectId;

  try {
    const buffer = preloaded?.buffer ?? await file.arrayBuffer();
    if (!isCurrentImport()) return;
    if (buffer.byteLength > MAX_AUDIO_BYTES) throw new DecodeError('File exceeds the size limit.', 'AUDIO_TOO_LARGE');

    const contentHash = preloaded?.contentHash ?? await sha256Hex(buffer);

    store.setMedia({ state: 'DECODING', stage: 'decoding', progress: 0.05 });
    const result = await decodeAudioFile(buffer, {
      signal,
      onProgress: (stage, progress) => {
        if (!isCurrentImport()) return;
        store.setMedia({
          state: stage === 'decoding' ? 'DECODING' : 'ANALYZING',
          stage,
          progress: stage === 'peaks' ? 0.35 + progress * 0.3 : stage === 'spectrum' ? 0.65 + progress * 0.3 : progress * 0.3
        });
      }
    });
    if (!isCurrentImport()) return;

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
    if (!isCurrentImport()) return;
    await saveAsset(peaksRecord, peaksBlob(result.peaks));
    if (!isCurrentImport()) return;

    const beatGrid = result.spectrum ? detectBeatGrid(result.spectrum) : null;
    store.setAnalysis({ peaks: result.peaks, spectrum: result.spectrum, beatGrid });

    decoded = { pcm: result.pcm, interleaved: result.interleaved, sampleRate: result.sampleRate, channels: result.channels, durationUs: result.durationUs };
    const player = ensureEngine();
    player.setBuffer(result.interleaved, result.sampleRate, result.channels);
    const loop = useEditor.getState().loop;
    player.setLoop(loop);

    const project = useEditor.getState().project;
    const preserveVoiceover = project.audio?.contentHash === contentHash;
    if (!preserveVoiceover) {
      voiceoverAudio = null;
      store.setVoiceoverJob({ state: 'IDLE', progress: 0, message: '', error: null, available: false });
    }
    store.commit('Import audio', (p) => ({
      ...p,
      voiceover: preserveVoiceover ? p.voiceover : null,
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

    store.setAudioMissing(false);
    if (preserveVoiceover) await hydrateVoiceoverFromStorage();
    if (!isCurrentImport()) return;
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
      if (projectEpoch === runtimeEpoch && useEditor.getState().project.id === projectId) {
        store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('CANCELLED') });
      }
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
  const projectId = store.project.id;
  const runtimeEpoch = projectEpoch;
  const isCurrentRelink = () => {
    const current = useEditor.getState();
    return projectEpoch === runtimeEpoch && current.project.id === projectId && current.audioMissing && current.project.audio?.contentHash === expectedHash;
  };
  const check = validateAudioFile(file.name, file.type, file.size);
  if (!check.ok && check.errorCode) {
    await importAudioFile(file);
    return false;
  }

  store.setMedia({ state: 'IMPORTING', stage: 'reading', progress: 0, error: null });
  try {
    const buffer = await file.arrayBuffer();
    if (!isCurrentRelink()) return false;
    if (buffer.byteLength > MAX_AUDIO_BYTES) throw new DecodeError('File exceeds the size limit.', 'AUDIO_TOO_LARGE');
    const contentHash = await sha256Hex(buffer);
    if (!isCurrentRelink()) return false;
    if (contentHash !== expectedHash) {
      store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
      store.notify({
        kind: 'error',
        title: 'That is a different file',
        detail: 'The content hash does not match the audio this project was built against, so timings would be wrong. Choose the original file.'
      });
      return false;
    }
    await importAudioFile(file, { buffer, contentHash });
    return true;
  } catch (error) {
    if (!isCurrentRelink()) return false;
    const code: ErrorCode = error instanceof DecodeError ? error.errorCode : 'AUDIO_DECODE_FAILED';
    store.setMedia({ state: 'FAILED', stage: 'idle', progress: 0, error: appError(code, error instanceof Error ? error.message : String(error)) });
    return false;
  }
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
  const projectId = store.project.id;
  const runtimeEpoch = projectEpoch;
  const audio = store.project.audio;
  if (!audio) return false;
  const isCurrentAudio = () => {
    const current = useEditor.getState().project;
    return projectEpoch === runtimeEpoch && current.id === projectId && current.audio?.assetId === audio.assetId;
  };
  const payload = await getAssetPayload(audio.assetId);
  if (!isCurrentAudio()) return false;
  if (!payload) {
    store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
    await hydrateVoiceoverFromStorage();
    return false;
  }
  // Paint the stored waveform immediately so the timeline is usable during the
  // decode, then overwrite it with the freshly computed one.
  const storedPeaks = await loadStoredPeaks(audio.peaksAssetId);
  if (!isCurrentAudio()) return false;
  if (storedPeaks) store.setAnalysis({ peaks: storedPeaks, spectrum: store.spectrum, beatGrid: store.beatGrid });
  store.setMedia({ state: 'DECODING', stage: 'decoding', progress: 0.1, error: null });
  try {
    const buffer = payload instanceof ArrayBuffer ? payload : await payload.arrayBuffer();
    if (!isCurrentAudio()) return false;
    const result = await decodeAudioFile(buffer, {
      onProgress: (stage, progress) => { if (isCurrentAudio()) store.setMedia({ stage, progress }); }
    });
    if (!isCurrentAudio()) return false;
    decoded = { pcm: result.pcm, interleaved: result.interleaved, sampleRate: result.sampleRate, channels: result.channels, durationUs: result.durationUs };
    const beatGrid = result.spectrum ? detectBeatGrid(result.spectrum) : null;
    store.setAnalysis({ peaks: result.peaks, spectrum: result.spectrum, beatGrid });
    ensureEngine().setBuffer(result.interleaved, result.sampleRate, result.channels);
    store.setMedia({ state: 'READY', stage: 'idle', progress: 1, error: null });
    await hydrateVoiceoverFromStorage();
    return true;
  } catch (error) {
    if (!isCurrentAudio()) return false;
    store.setMedia({
      state: 'FAILED',
      stage: 'idle',
      progress: 0,
      error: appError('AUDIO_DECODE_FAILED', error instanceof Error ? error.message : String(error))
    });
    return false;
  }
}

/* ------------------------ transcription + speech ------------------------ */

function finishGenerationWorker(worker: Worker, id: string): void {
  if (generationWorker !== worker || activeGenerationId !== id) return;
  worker.terminate();
  generationWorker = null;
  activeGenerationId = null;
  activeGenerationKind = null;
}

function showGenerationError(kind: 'transcription' | 'voiceover', id: string, message: string): void {
  if (activeGenerationId !== id || activeGenerationKind !== kind) return;
  if (kind === 'transcription') {
    useEditor.getState().setTranscription({ state: 'FAILED', progress: 0, error: message, message: 'Transcription did not finish.' });
  } else {
    useEditor.getState().setVoiceoverJob({ state: 'FAILED', progress: 0, error: message, message: 'Speech generation did not finish.' });
  }
  useEditor.getState().notify({ kind: 'error', title: kind === 'transcription' ? 'Subtitle generation failed' : 'Speech generation failed', detail: message });
}

function bytesProgress(loaded: number, total: number): string {
  return total > 0 ? `${formatBytes(loaded)} of ${formatBytes(total)}` : `${formatBytes(loaded)} received`;
}

/** Generate a reviewable, line-timed transcript without uploading the audio. */
export async function transcribeAudio(model: 'tiny' | 'base', language = 'auto'): Promise<void> {
  const store = useEditor.getState();
  const token = reserveGenerationStart();
  if (!token) {
    store.notify({ kind: 'warning', title: 'A generation task is already starting or running', detail: 'Wait for it to finish or cancel it first.' });
    return;
  }
  try {
    await runTranscription(model, language);
  } finally {
    releaseGenerationStart(token);
  }
}

async function runTranscription(model: 'tiny' | 'base', language: string): Promise<void> {
  const store = useEditor.getState();
  const generationEpoch = projectEpoch;
  if (generationWorker) {
    store.notify({ kind: 'warning', title: 'A generation task is already running', detail: 'Wait for it to finish or cancel it first.' });
    return;
  }
  if (!store.project.audio || store.audioMissing) {
    store.setTranscription({ state: 'FAILED', progress: 0, error: 'Import or relink the original audio track before generating subtitles.', message: 'Audio is required.' });
    return;
  }
  const projectId = store.project.id;
  const audioHash = store.project.audio.contentHash;
  if (!decoded && !(await hydrateAudioFromStorage())) {
    const latest = useEditor.getState();
    if (generationEpoch === projectEpoch && latest.project.id === projectId && latest.project.audio?.contentHash === audioHash) {
      store.setTranscription({ state: 'FAILED', progress: 0, error: 'The project audio could not be loaded from local storage.', message: 'Audio is unavailable.' });
    }
    return;
  }
  if (generationEpoch !== projectEpoch) return;
  const latestBeforeModel = useEditor.getState();
  if (latestBeforeModel.project.id !== projectId || latestBeforeModel.project.audio?.contentHash !== audioHash) {
    store.setTranscription({ state: 'CANCELLED', progress: 0, message: 'The project audio changed before transcription started.', error: null });
    return;
  }
  let modelBundle: SelectedWhisperModel;
  try {
    modelBundle = await selectBundledWhisperModel(model);
  } catch (error) {
    const latest = useEditor.getState();
    if (generationEpoch === projectEpoch && latest.project.id === projectId && latest.project.audio?.contentHash === audioHash) {
      const detail = error instanceof Error ? error.message : String(error);
      store.setTranscription({ state: 'FAILED', progress: 0, message: 'The bundled Whisper model is unavailable.', error: detail, result: null });
      store.notify({ kind: 'error', title: 'Subtitle generation failed', detail });
    }
    return;
  }
  if (generationEpoch !== projectEpoch) return;
  const latestBeforeWorker = useEditor.getState();
  if (latestBeforeWorker.project.id !== projectId || latestBeforeWorker.project.audio?.contentHash !== audioHash) {
    store.setTranscription({ state: 'CANCELLED', progress: 0, message: 'The project audio changed before transcription started.', error: null });
    return;
  }
  const audio = decoded;
  if (!audio) return;
  const id = newId('asr');
  let worker: Worker;
  try {
    worker = new Worker(new URL('./workers/transcribe.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    store.setTranscription({ state: 'FAILED', progress: 0, message: 'The local transcription worker could not start.', error: detail, result: null });
    store.notify({ kind: 'error', title: 'Subtitle generation failed', detail });
    return;
  }
  const samples = audio.pcm.slice();
  generationWorker = worker;
  activeGenerationId = id;
  activeGenerationKind = 'transcription';
  store.setTranscription({ state: 'PREPARING', progress: 0, message: 'Preparing local transcription…', error: null, result: null });

  worker.onmessage = (event: MessageEvent<WhisperWorkerMessage>) => {
    const message = event.data;
    if (message.id !== id || activeGenerationId !== id || activeGenerationKind !== 'transcription') return;
    const current = useEditor.getState();

    if (message.type === 'MODEL_READY') {
      if (message.version && message.url && message.bundleId) {
        rememberInstalledModel('whisper', model, {
          version: message.version,
          url: message.url,
          bundleId: message.bundleId,
          bytes: message.bytes ?? modelBundle.bytes,
          sha256: message.sha256 ?? modelBundle.sha256
        });
      }
      return;
    }
    if (message.type === 'STATUS') {
      const state: GenerationState = message.state === 'DOWNLOADING' ? 'DOWNLOADING' : message.state === 'LOADING' ? 'LOADING' : 'RUNNING';
      const progress = message.state === 'LOADING' ? Math.max(current.transcription.progress, 0.72) : current.transcription.progress;
      store.setTranscription({ state, progress, message: message.message ?? 'Transcribing audio…', error: null });
      return;
    }
    if (message.type === 'DOWNLOAD_PROGRESS') {
      const ratio = message.total && message.total > 1 ? Math.max(0, Math.min(1, message.loaded! / message.total)) : 1;
      store.setTranscription({
        state: 'DOWNLOADING',
        progress: message.total && message.total > 1 ? ratio * 0.68 : Math.max(current.transcription.progress, 0.68),
        message: message.total && message.total > 1 ? `Loading bundled Whisper model · ${bytesProgress(message.loaded ?? 0, message.total)}` : 'Whisper model is cached locally.',
        error: null
      });
      return;
    }
    if (message.type === 'TRANSCRIBE_PROGRESS') {
      const fraction = Math.max(0, Math.min(1, message.progress ?? 0));
      store.setTranscription({ state: 'RUNNING', progress: 0.72 + fraction * 0.28, message: `Transcribing · ${Math.round(fraction * 100)}%`, error: null });
      return;
    }
    if (message.type === 'ERROR') {
      showGenerationError('transcription', id, message.message ?? 'The local Whisper model could not transcribe this audio.');
      finishGenerationWorker(worker, id);
      return;
    }
    if (message.type === 'CANCELLED') {
      store.setTranscription({ state: 'CANCELLED', progress: 0, message: 'Transcription cancelled.', error: null });
      finishGenerationWorker(worker, id);
      return;
    }
    if (message.type !== 'RESULT') return;

    finishGenerationWorker(worker, id);
    const latest = useEditor.getState();
    if (latest.project.id !== projectId || latest.project.audio?.contentHash !== audioHash) {
      store.setTranscription({ state: 'CANCELLED', progress: 0, message: 'The project audio changed before transcription finished.', error: null, result: null });
      return;
    }
    const durationUs = latest.project.audio?.durationUs ?? audio.durationUs;
    let cues = whisperSegmentsToCues(message.segments ?? [], durationUs);
    if (cues.length === 0 && message.text) {
      const fallback = untimedTranscriptCue(message.text, durationUs);
      if (fallback) cues = [fallback];
    }
    if (cues.length === 0) {
      store.setTranscription({ state: 'FAILED', progress: 0, message: 'No speech was detected.', error: 'Whisper returned no readable lyric lines.', result: null });
      return;
    }
    store.setTranscription({
      state: 'COMPLETE',
      progress: 1,
      message: `Transcript ready · ${cues.length} timed line${cues.length === 1 ? '' : 's'}${message.language ? ` · ${message.language}` : ''}`,
      error: null,
      result: { cues, language: message.language ?? null }
    });
  };

  worker.onerror = (event) => {
    showGenerationError('transcription', id, event.message || 'The transcription worker stopped unexpectedly.');
    finishGenerationWorker(worker, id);
  };
  worker.postMessage({ type: 'TRANSCRIBE', id, samples, sampleRate: audio.sampleRate, model, modelBundle, language }, [samples.buffer]);
}

export function cancelTranscription(): void {
  if (activeGenerationKind === 'transcription') stopActiveGeneration();
}

export async function applyGeneratedTranscript(): Promise<void> {
  const store = useEditor.getState();
  const result = store.transcription.result;
  if (!result || result.cues.length === 0) return;
  store.setLyricsFromTranscript(result.cues);
  store.setTranscription({ state: 'IDLE', progress: 0, message: '', error: null, result: null });
  store.notify({ kind: 'success', title: 'Generated subtitles applied', detail: 'The transcript is a single undoable lyrics edit. Review the timings before exporting.' });
  await persist();
}

export function dismissGeneratedTranscript(): void {
  useEditor.getState().setTranscription({ state: 'IDLE', progress: 0, message: '', error: null, result: null });
}

/** Load the generated WAV asset for playback/export after a project is reopened. */
export async function hydrateVoiceoverFromStorage(): Promise<boolean> {
  const store = useEditor.getState();
  const projectId = store.project.id;
  const runtimeEpoch = projectEpoch;
  const meta = store.project.voiceover;
  if (!meta) {
    voiceoverAudio = null;
    store.setVoiceoverJob({ state: 'IDLE', progress: 0, message: '', error: null, available: false });
    syncVoiceoverPlayback();
    return false;
  }
  const isCurrentVoiceover = () => {
    const current = useEditor.getState();
    return projectEpoch === runtimeEpoch && current.project.id === projectId && current.project.voiceover?.assetId === meta.assetId;
  };
  if (voiceoverAudio?.assetId === meta.assetId) {
    store.setVoiceoverJob({ state: 'COMPLETE', progress: 1, message: 'Generated voiceover is available locally.', error: null, available: true });
    syncVoiceoverPlayback();
    return true;
  }

  try {
    const payload = await getAssetPayload(meta.assetId);
    if (!isCurrentVoiceover()) return false;
    if (!payload) {
      store.setVoiceoverJob({ state: 'IDLE', progress: 0, message: 'Generated audio is not stored in this browser. Regenerate it to restore the voiceover.', error: null, available: false });
      syncVoiceoverPlayback();
      return false;
    }
    const buffer = payload instanceof ArrayBuffer ? payload : await payload.arrayBuffer();
    if (!isCurrentVoiceover()) return false;
    const wav = decodeWav(buffer);
    const mono = wav.channels === 1 ? wav.samples : (() => {
      const frames = Math.floor(wav.samples.length / wav.channels);
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        for (let channel = 0; channel < wav.channels; channel += 1) sum += wav.samples[frame * wav.channels + channel] ?? 0;
        samples[frame] = sum / wav.channels;
      }
      return samples;
    })();
    voiceoverAudio = { pcm: mono, sampleRate: wav.sampleRate, assetId: meta.assetId };
    engineVoiceoverAssetId = null;
    store.setVoiceoverJob({ state: 'COMPLETE', progress: 1, message: 'Generated voiceover is available locally.', error: null, available: true });
    syncVoiceoverPlayback();
    return true;
  } catch (error) {
    if (!isCurrentVoiceover()) return false;
    store.setVoiceoverJob({ state: 'FAILED', progress: 0, message: 'Generated voiceover could not be read.', error: error instanceof Error ? error.message : String(error), available: false });
    syncVoiceoverPlayback();
    return false;
  }
}

/** Synthesize the timed lyric lines as one locally stored voiceover track. */
export async function generateVoiceover(voiceId: string): Promise<void> {
  const store = useEditor.getState();
  const token = reserveGenerationStart();
  if (!token) {
    store.notify({ kind: 'warning', title: 'A generation task is already starting or running', detail: 'Wait for it to finish or cancel it first.' });
    return;
  }
  try {
    await runVoiceoverGeneration(voiceId);
  } finally {
    releaseGenerationStart(token);
  }
}

async function runVoiceoverGeneration(voiceId: string): Promise<void> {
  const store = useEditor.getState();
  if (generationWorker) {
    store.notify({ kind: 'warning', title: 'A generation task is already running', detail: 'Wait for it to finish or cancel it first.' });
    return;
  }
  const project = store.project;
  const lines = project.lyrics.lines
    .filter((line) => line.text.trim().length > 0 && !isInstrumentalMarker(line.text))
    .map((line) => ({ text: line.text, startUs: Math.max(0, line.start) }));
  if (lines.length === 0) {
    store.setVoiceoverJob({ state: 'FAILED', progress: 0, message: 'Add readable lyric lines before generating speech.', error: 'There are no lines to speak.' });
    return;
  }
  const projectId = project.id;
  const generationEpoch = projectEpoch;
  const sourceSignature = voiceoverSourceSignature(project.lyrics.lines);
  const durationUs = Math.max(project.audio?.durationUs ?? 0, ...project.lyrics.lines.map((line) => line.end));
  let modelBundle: SelectedPiperModel;
  try {
    modelBundle = await selectBundledPiperModel(voiceId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const current = useEditor.getState();
    if (current.project.id === projectId && projectEpoch === generationEpoch) {
      store.setVoiceoverJob({ state: 'FAILED', progress: 0, message: 'The bundled Piper voice is unavailable.', error: detail, available: false });
      store.notify({ kind: 'error', title: 'Speech generation failed', detail });
    }
    return;
  }
  const latestBeforeWorker = useEditor.getState();
  if (latestBeforeWorker.project.id !== projectId || projectEpoch !== generationEpoch || voiceoverSourceSignature(latestBeforeWorker.project.lyrics.lines) !== sourceSignature) {
    if (latestBeforeWorker.project.id === projectId && projectEpoch === generationEpoch) {
      store.setVoiceoverJob({ state: 'CANCELLED', progress: 0, message: 'Lyrics changed before speech generation started.', error: null });
    }
    return;
  }
  if (generationWorker) {
    store.notify({ kind: 'warning', title: 'A generation task is already running', detail: 'Wait for it to finish or cancel it first.' });
    return;
  }
  const id = newId('tts');
  let worker: Worker;
  try {
    worker = new Worker(new URL('./workers/voiceover.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    store.setVoiceoverJob({ state: 'FAILED', progress: 0, message: 'The local speech worker could not start.', error: detail, available: false });
    store.notify({ kind: 'error', title: 'Speech generation failed', detail });
    return;
  }
  const isCurrentGeneration = () => projectEpoch === generationEpoch && useEditor.getState().project.id === projectId;
  generationWorker = worker;
  activeGenerationId = id;
  activeGenerationKind = 'voiceover';
  store.setVoiceoverJob({ state: 'PREPARING', progress: 0, message: 'Preparing local speech generation…', error: null });

  const fail = (message: string) => {
    showGenerationError('voiceover', id, message);
    finishGenerationWorker(worker, id);
  };

  worker.onmessage = (event: MessageEvent<VoiceoverWorkerMessage>) => {
    const message = event.data;
    if (message.id !== id || activeGenerationId !== id || activeGenerationKind !== 'voiceover') return;
    if (message.type === 'MODEL_READY') {
      if (modelBundle.allowFetch && message.version && message.url && message.bundleId) {
        rememberInstalledModel('piper', voiceId, {
          version: message.version,
          url: message.url,
          bundleId: message.bundleId,
          bytes: message.bytes ?? modelBundle.bytes
        });
      }
      return;
    }
    if (message.type === 'STATUS') {
      const state: GenerationState = message.state === 'DOWNLOADING' ? 'DOWNLOADING' : message.state === 'SYNTHESIZING' ? 'RUNNING' : 'PREPARING';
      const progress = message.state === 'SYNTHESIZING' ? Math.max(useEditor.getState().voiceoverJob.progress, 0.25) : useEditor.getState().voiceoverJob.progress;
      store.setVoiceoverJob({ state, progress, message: message.message ?? 'Generating speech…', error: null });
      return;
    }
    if (message.type === 'MODEL_PROGRESS') {
      const ratio = message.total && message.total > 1 ? Math.max(0, Math.min(1, (message.loaded ?? 0) / message.total)) : 0;
      store.setVoiceoverJob({
        state: 'DOWNLOADING',
        progress: message.total && message.total > 1 ? ratio * 0.25 : Math.max(useEditor.getState().voiceoverJob.progress, 0.08),
        message: message.total && message.total > 1 ? `Downloading voice model · ${bytesProgress(message.loaded ?? 0, message.total)}` : 'Loading the cached voice model…',
        error: null
      });
      return;
    }
    if (message.type === 'LINE_PROGRESS') {
      const completed = message.completed ?? 0;
      const total = Math.max(1, message.total ?? 1);
      store.setVoiceoverJob({ state: 'RUNNING', progress: 0.25 + (completed / total) * 0.7, message: `Generating line ${completed} of ${total}…`, error: null });
      return;
    }
    if (message.type === 'ERROR') {
      fail(message.message ?? 'Piper could not generate this voiceover.');
      return;
    }
    if (message.type === 'CANCELLED') {
      store.setVoiceoverJob({ state: 'CANCELLED', progress: 0, message: 'Speech generation cancelled.', error: null });
      finishGenerationWorker(worker, id);
      return;
    }
    if (message.type !== 'RESULT') return;

    finishGenerationWorker(worker, id);
    void (async () => {
      try {
        const latest = useEditor.getState();
        if (!isCurrentGeneration()) return;
        if (voiceoverSourceSignature(latest.project.lyrics.lines) !== sourceSignature) {
          throw new Error('Lyrics changed while speech was being generated. Run generation again for the updated text or timings.');
        }
        const pcm = message.pcm;
        const sampleRate = message.sampleRate;
        if (!pcm || !sampleRate || pcm.length === 0) throw new Error('Speech generation returned no audio.');
        store.setVoiceoverJob({ state: 'SAVING', progress: 0.96, message: 'Saving the WAV locally…', error: null });
        const wav = encodeWav(pcm, sampleRate, 1);
        const contentHash = await sha256Hex(await wav.arrayBuffer());
        const latestAfterHash = useEditor.getState();
        if (!isCurrentGeneration()) return;
        if (voiceoverSourceSignature(latestAfterHash.project.lyrics.lines) !== sourceSignature) {
          throw new Error('Lyrics changed while the voiceover was being saved. Run generation again for the updated text or timings.');
        }
        const fileName = suggestedFileName(latestAfterHash.project, '-voiceover.wav');
        const record: AssetRecord = {
          id: `vo_${contentHash.slice(0, 24)}`,
          kind: 'audio',
          fileName,
          mimeType: 'audio/wav',
          bytes: wav.size,
          contentHash,
          createdAt: Date.now()
        };
        const saved = await saveAsset(record, wav);
        const latestAfterSave = useEditor.getState();
        if (!isCurrentGeneration()) return;
        if (voiceoverSourceSignature(latestAfterSave.project.lyrics.lines) !== sourceSignature) {
          throw new Error('Lyrics changed while the voiceover was being saved. Run generation again for the updated text or timings.');
        }

        const meta: VoiceoverMeta = {
          assetId: saved.id,
          fileName: saved.fileName,
          mimeType: saved.mimeType,
          bytes: saved.bytes,
          contentHash: saved.contentHash,
          sampleRate,
          durationUs: message.durationUs ?? Math.round((pcm.length / sampleRate) * 1_000_000),
          voiceId,
          sourceSignature,
          enabled: true,
          musicGain: 0.25,
          speechGain: 1,
          createdAt: Date.now()
        };
        voiceoverAudio = { pcm, sampleRate, assetId: saved.id };
        engineVoiceoverAssetId = null;
        store.commit('Generate speech voiceover', (p) => ({ ...p, voiceover: meta }));
        store.setVoiceoverJob({ state: 'COMPLETE', progress: 1, message: `Generated speech for ${message.lineCount ?? lines.length} lines.`, error: null, available: true });
        store.notify({ kind: 'success', title: 'Voiceover generated', detail: 'Preview with Play, adjust the mix below, or include it in the video export.' });
        await persist();
      } catch (error) {
        if (!isCurrentGeneration()) return;
        const currentMeta = useEditor.getState().project.voiceover;
        const oldAudioStillAvailable = !!currentMeta && voiceoverAudio?.assetId === currentMeta.assetId;
        store.setVoiceoverJob({ state: 'FAILED', progress: 0, message: 'Speech generation could not be saved.', error: error instanceof Error ? error.message : String(error), available: oldAudioStillAvailable });
        store.notify({ kind: 'error', title: 'Could not save voiceover', detail: error instanceof Error ? error.message : String(error) });
      }
    })();
  };

  worker.onerror = (event) => fail(event.message || 'The speech worker stopped unexpectedly.');
  worker.postMessage({ type: 'SPEAK', id, voiceId, lines, durationUs, modelBundle });
}

export function cancelVoiceoverGeneration(): void {
  if (activeGenerationKind === 'voiceover') stopActiveGeneration();
}

export function downloadGeneratedVoiceover(): void {
  const store = useEditor.getState();
  const meta = store.project.voiceover;
  if (!meta || voiceoverAudio?.assetId !== meta.assetId) {
    store.notify({ kind: 'warning', title: 'Voiceover audio is unavailable', detail: 'Regenerate speech in this browser to download its WAV file.' });
    return;
  }
  downloadBlob(encodeWav(voiceoverAudio.pcm, voiceoverAudio.sampleRate, 1), meta.fileName);
}

export async function removeGeneratedVoiceover(): Promise<void> {
  const store = useEditor.getState();
  const removed = store.project.voiceover;
  if (!removed) return;
  store.commit('Remove generated voiceover', (project) => ({ ...project, voiceover: null }));
  if (voiceoverAudio?.assetId === removed.assetId) voiceoverAudio = null;
  store.setVoiceoverJob({ state: 'IDLE', progress: 0, message: '', error: null, available: false });
  await persist();
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
  importController?.abort();
  exportController?.abort();
  const controller = new AbortController();
  exportController = controller;
  const signal = controller.signal;
  const exportProjectId = project.id;
  const exportEpoch = projectEpoch;
  const isCurrentExport = () => exportController === controller && projectEpoch === exportEpoch && useEditor.getState().project.id === exportProjectId;

  store.setRender({ state: 'QUEUED', progress: 0, framesDone: 0, framesTotal: 0, etaSeconds: 0, error: null, result: null });
  edge.track('export_started', { bucket: `${project.export.width}x${project.export.height}` });

  try {
    const audioSupported = await checkAudioEncoderSupport(decoded.sampleRate, decoded.channels);
    if (signal.aborted || !isCurrentExport()) throw new ExportError('Export was cancelled.', 'CANCELLED');
    const voiceoverMeta = project.voiceover;
    const voiceoverCurrent = isVoiceoverCurrent(project) && voiceoverAudio?.assetId === voiceoverMeta?.assetId;
    const includeVoiceover = !!voiceoverMeta?.enabled && voiceoverCurrent && !!voiceoverAudio;
    if (voiceoverMeta?.enabled && !voiceoverCurrent) {
      store.notify({
        kind: 'warning',
        title: 'Generated speech is out of date or unavailable',
        detail: 'This export will use the original audio only. Regenerate speech to match the current lyrics, or reopen the project in the browser where its voiceover is stored.'
      });
    }
    const exportRangeStartUs = project.export.rangeStartUs;
    const exportRangeEndUs = Math.min(project.export.rangeEndUs, project.audio.durationUs);
    const voiceoverMixed = project.export.includeAudio && includeVoiceover && !!voiceoverMeta && !!voiceoverAudio;
    const audioForExport = voiceoverMixed && voiceoverMeta && voiceoverAudio
      ? mixVoiceover({
          music: decoded.interleaved,
          musicSampleRate: decoded.sampleRate,
          channels: decoded.channels,
          voice: voiceoverAudio.pcm,
          voiceSampleRate: voiceoverAudio.sampleRate,
          voiceTimelineOffsetUs: voiceoverTimelineOffsetUs(project),
          musicGain: voiceoverMeta.musicGain,
          voiceGain: voiceoverMeta.speechGain,
          rangeStartUs: exportRangeStartUs,
          rangeEndUs: exportRangeEndUs
        })
      : decoded.interleaved;

    if (project.export.includeAudio && !audioSupported) {
      store.notify({
        kind: 'warning',
        title: 'Audio will be exported separately',
        detail: 'This browser has no AAC encoder, so you will get a silent MP4 plus a WAV file containing the selected music and voiceover mix. Mux them in any editor, or use Chrome or Edge for a single file.'
      });
    }

    const output = await exportVideo({
      scene,
      interleaved: project.export.includeAudio && audioSupported ? audioForExport : null,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      width: project.export.width,
      height: project.export.height,
      fps: project.export.fps,
      videoBitrate: project.export.videoBitrate,
      audioBitrate: project.export.audioBitrate,
      codec: project.export.codec,
      includeAudio: project.export.includeAudio && audioSupported,
      rangeStartUs: exportRangeStartUs,
      rangeEndUs: exportRangeEndUs,
      audioStartUs: voiceoverMixed ? exportRangeStartUs : 0,
      renderOptions: { measure, showHeat: false },
      signal,
      onProgress: (progress) => {
        if (!isCurrentExport()) return;
        store.setRender({
          state: progress.state,
          progress: progress.framesTotal > 0 ? progress.framesDone / progress.framesTotal : 0,
          framesDone: progress.framesDone,
          framesTotal: progress.framesTotal,
          etaSeconds: Math.round(progress.etaSeconds),
          error: null
        });
      }
    });

    if (signal.aborted || !isCurrentExport()) throw new ExportError('Export was cancelled.', 'CANCELLED');
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
      const startSample = voiceoverMixed ? 0 : Math.floor((exportRangeStartUs / 1_000_000) * decoded.sampleRate);
      const endSample = voiceoverMixed
        ? Math.floor(audioForExport.length / decoded.channels)
        : Math.floor((exportRangeEndUs / 1_000_000) * decoded.sampleRate);
      downloadBlob(encodeWav(audioForExport, decoded.sampleRate, decoded.channels, startSample, endSample), suggestedFileName(project, '.wav'));
    }

    edge.track('export_completed', { bucket: `${project.export.width}x${project.export.height}`, outcome: 'success' });
    store.notify({ kind: 'success', title: 'Export complete', detail: `${fileName} — ${output.frames} frames.` });
  } catch (error) {
    if (signal.aborted || !isCurrentExport()) {
      if (projectEpoch === exportEpoch && useEditor.getState().project.id === exportProjectId) store.setRender({ state: 'CANCELLED', error: appError('CANCELLED') });
      return;
    }
    const code: ErrorCode =
      error instanceof ExportError ? error.code === 'OUT_OF_MEMORY' ? 'OUT_OF_MEMORY' : error.code === 'CANCELLED' ? 'CANCELLED' : 'ENCODER_FAILED' : 'ENCODER_FAILED';
    store.setRender({ state: 'FAILED', error: appError(code, error instanceof Error ? error.message : String(error)) });
    edge.track('export_failed', { bucket: code, outcome: 'failure' });
  }
}

export function cancelExport(): void {
  exportController?.abort();
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
  const referenced = assets.filter((a) => a.id === store.project.audio?.assetId || a.id === store.project.audio?.peaksAssetId || a.id === store.project.voiceover?.assetId);
  const file = buildProjectFile(store.project, referenced);
  downloadText(serialiseProjectFile(file), suggestedFileName(store.project, '.vidlyricsproject'), 'application/json');
  store.notify({
    kind: 'info',
    title: 'Project exported',
    detail: 'Project files do not embed audio binaries. You will be asked to re-link the original song; generated speech can be re-created if its local WAV is not already stored in this browser.'
  });
  getEdgeClient().track('project_exported');
}

export async function importProjectFile(file: File): Promise<void> {
  const store = useEditor.getState();
  try {
    const text = await file.text();
    const { project, report } = loadProjectJson(JSON.parse(text));
    const audioMissing = project.audio ? !(await getAssetPayload(project.audio.assetId)) : false;
    resetProjectRuntime();
    store.replaceProject(project, { audioMissing });
    if (audioMissing) {
      store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
      await hydrateVoiceoverFromStorage();
    } else if (project.audio) {
      await hydrateAudioFromStorage();
    } else {
      await hydrateVoiceoverFromStorage();
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
  resetProjectRuntime();
  store.replaceProject(loaded.project, { audioMissing: loaded.audioMissing });
  if (loaded.audioMissing) {
    store.setMedia({ state: 'IDLE', stage: 'idle', progress: 0, error: appError('IMPORT_MISSING_ASSET') });
    await hydrateVoiceoverFromStorage();
  } else if (loaded.project.audio) {
    await hydrateAudioFromStorage();
  } else {
    await hydrateVoiceoverFromStorage();
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
  projectEpoch += 1;
  importController?.abort();
  exportController?.abort();
  stopActiveGeneration(false);
  engine?.dispose();
  engine = null;
  decoded = null;
  voiceoverAudio = null;
  engineVoiceoverAssetId = null;
}

export async function storageSummary() {
  return estimateStorage();
}

export { newId };
