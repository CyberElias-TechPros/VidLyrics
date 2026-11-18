/// <reference lib="webworker" />
import { TtsSession, stored as storedPiperModels } from '@mintplex-labs/piper-tts-web';
import { bundledFileResponse } from '../bundledFileStream';
import type { SelectedPiperModel } from '../modelBundle';
import piperDataUrl from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';
import piperWasmUrl from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';
// onnxruntime-web ships these files but does not export their package subpath.
import onnxSimdWasmUrl from '../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm?url';
import onnxThreadedSimdWasmUrl from '../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import { decodeWav } from '../../core/audio/wav';
import { resampleMono } from '../../core/audio/resample';
import { stitchSequentialVoiceClips, type SequentialClipInput } from '../../core/audio/voiceover';

interface VoiceLine {
  id: string;
  text: string;
  startUs: number;
  speaker?: 'A' | 'B' | null;
}

type IncomingMessage =
  | {
      type: 'SPEAK';
      id: string;
      voiceId: string;
      voiceIdB?: string | null;
      mode?: 'timed' | 'sequential';
      pauseUs?: number;
      lines: VoiceLine[];
      durationUs: number;
      modelBundle: SelectedPiperModel;
      modelBundleB?: SelectedPiperModel | null;
    }
  | { type: 'CANCEL'; id: string };

type OutgoingMessage =
  | { type: 'STATUS'; id: string; state: 'PREPARING' | 'DOWNLOADING' | 'SYNTHESIZING'; message: string }
  | { type: 'MODEL_PROGRESS'; id: string; loaded: number; total: number }
  | { type: 'MODEL_READY'; id: string; voiceId: string; version: string; url: string; bundleId: string; bytes: number }
  | { type: 'LINE_PROGRESS'; id: string; completed: number; total: number }
  | {
      type: 'RESULT';
      id: string;
      pcm: Float32Array;
      sampleRate: number;
      durationUs: number;
      lineCount: number;
      cues?: { lineId: string; startUs: number; endUs: number }[];
    }
  | { type: 'ERROR'; id: string; message: string }
  | { type: 'CANCELLED'; id: string };

let activeId: string | null = null;
let cancelled = false;

function send(message: OutgoingMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function ensureCapacity(current: Float32Array, needed: number): Float32Array {
  if (needed <= current.length) return current;
  let capacity = Math.max(1024, current.length);
  while (capacity < needed) capacity = Math.max(capacity * 2, needed);
  const expanded = new Float32Array(capacity);
  expanded.set(current);
  return expanded;
}

function toMono(samples: Float32Array, channels: number): Float32Array {
  if (channels === 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) sum += samples[frame * channels + channel] ?? 0;
    mono[frame] = sum / channels;
  }
  return mono;
}

const PIPER_MODEL_ORIGIN = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/';
const PIPER_FILES = (voiceId: string) => [`${voiceId}.onnx`, `${voiceId}.onnx.json`];

async function hasCompleteStoredVoice(voiceId: string): Promise<boolean> {
  try {
    const models = await storedPiperModels();
    if (!models.includes(voiceId)) return false;
    const root = await navigator.storage.getDirectory();
    const piper = await root.getDirectoryHandle('piper');
    for (const name of PIPER_FILES(voiceId)) await piper.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

interface PiperBackup {
  directoryName: string;
  files: string[];
}

async function backupStoredVoice(voiceId: string, previousVersion: string): Promise<PiperBackup | null> {
  const root = await navigator.storage.getDirectory();
  const piper = await root.getDirectoryHandle('piper');
  const directoryName = `vidlyrics-piper-backup-${voiceId}-${previousVersion.replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'old'}`;
  const backup = await root.getDirectoryHandle(directoryName, { create: true });
  const files: string[] = [];
  try {
    for (const name of PIPER_FILES(voiceId)) {
      const source = await (await piper.getFileHandle(name)).getFile();
      const destination = await backup.getFileHandle(name, { create: true });
      const writable = await destination.createWritable();
      await writable.write(source);
      await writable.close();
      files.push(name);
    }
  } catch {
    await root.removeEntry(directoryName, { recursive: true }).catch(() => undefined);
    return null;
  }
  return files.length === PIPER_FILES(voiceId).length ? { directoryName, files } : null;
}

async function removeStoredVoice(voiceId: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const piper = await root.getDirectoryHandle('piper', { create: true });
  for (const name of PIPER_FILES(voiceId)) await piper.removeEntry(name).catch(() => undefined);
}

async function restoreStoredVoice(voiceId: string, backup: PiperBackup): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const piper = await root.getDirectoryHandle('piper', { create: true });
  const source = await root.getDirectoryHandle(backup.directoryName);
  await removeStoredVoice(voiceId);
  for (const name of backup.files) {
    const file = await (await source.getFileHandle(name)).getFile();
    const destination = await piper.getFileHandle(name, { create: true });
    const writable = await destination.createWritable();
    await writable.write(file);
    await writable.close();
  }
  await root.removeEntry(backup.directoryName, { recursive: true }).catch(() => undefined);
}

async function removeVoiceBackup(backup: PiperBackup): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(backup.directoryName, { recursive: true }).catch(() => undefined);
}

function installBundledPiperFetch(modelBundle: SelectedPiperModel): () => void {
  const originalFetch = globalThis.fetch;
  const rewrites = new Map<string, SelectedPiperModel['onnx']>([
    [`${PIPER_MODEL_ORIGIN}${modelBundle.upstreamPath}`, modelBundle.onnx],
    [`${PIPER_MODEL_ORIGIN}${modelBundle.upstreamPath}.json`, modelBundle.config]
  ]);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(PIPER_MODEL_ORIGIN)) {
      const file = rewrites.get(url);
      if (!file || !modelBundle.allowFetch) {
        return Promise.reject(new Error('A Piper model update was not approved for download.'));
      }
      return Promise.resolve(bundledFileResponse(file, init?.signal ?? undefined));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

async function loadPiperSession(
  jobId: string,
  voiceId: string,
  modelBundle: SelectedPiperModel
): Promise<Awaited<ReturnType<typeof TtsSession.create>>> {
  const voiceAlreadyStored = await hasCompleteStoredVoice(voiceId);
  if (!modelBundle.allowFetch && !voiceAlreadyStored) {
    throw new Error('The previous Piper voice copy is no longer available in browser storage. Approve the bundled model update to restore it.');
  }
  let backup: PiperBackup | null = null;
  if (modelBundle.updateAccepted && voiceAlreadyStored && modelBundle.previousVersion) {
    backup = await backupStoredVoice(voiceId, modelBundle.previousVersion);
    if (!backup) throw new Error('Could not safely stage the existing voice model for update. Free some browser storage and try again.');
    await removeStoredVoice(voiceId);
  }

  const wasmPaths = {
    // ONNX Runtime accepts a filename-to-URL map. Keep both threaded and
    // single-thread SIMD binaries same-origin so Piper never falls back to a CDN.
    onnxWasm: {
      'ort-wasm-simd-threaded.wasm': onnxThreadedSimdWasmUrl,
      'ort-wasm-simd.wasm': onnxSimdWasmUrl
    } as unknown as string,
    piperData: piperDataUrl,
    piperWasm: piperWasmUrl
  };
  const restoreFetch = installBundledPiperFetch(modelBundle);
  let session: Awaited<ReturnType<typeof TtsSession.create>>;
  try {
    session = await TtsSession.create({
      voiceId,
      wasmPaths,
      progress: (progress) => {
        if (progress.url.startsWith('tts://')) return;
        if (progress.total > 0) {
          send({ type: 'STATUS', id: jobId, state: 'DOWNLOADING', message: `Loading bundled voice ${voiceId}…` });
        }
        send({ type: 'MODEL_PROGRESS', id: jobId, loaded: progress.loaded, total: progress.total });
      }
    });
  } catch (error) {
    if (backup) await restoreStoredVoice(voiceId, backup).catch(() => undefined);
    backup = null;
    throw error;
  } finally {
    restoreFetch();
  }
  if (backup) {
    await removeVoiceBackup(backup);
    backup = null;
  }
  if (modelBundle.allowFetch) {
    send({
      type: 'MODEL_READY',
      id: jobId,
      voiceId,
      version: modelBundle.version,
      url: modelBundle.onnx.url,
      bundleId: modelBundle.bundleId,
      bytes: modelBundle.bytes
    });
  }
  return session;
}

async function runSpeech(message: Extract<IncomingMessage, { type: 'SPEAK' }>): Promise<void> {
  activeId = message.id;
  cancelled = false;
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      throw new Error('This browser does not support local voice-model storage. Use a current browser with site storage enabled.');
    }
    if (message.lines.length === 0) throw new Error('There are no script or lyric lines to speak.');

    send({ type: 'STATUS', id: message.id, state: 'PREPARING', message: 'Loading the bundled local speech engine…' });
    const sessionA = await loadPiperSession(message.id, message.voiceId, message.modelBundle);
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');

    const needsSecondVoice =
      !!message.voiceIdB &&
      message.voiceIdB !== message.voiceId &&
      !!message.modelBundleB &&
      message.lines.some((line) => line.speaker === 'B' && line.text.trim().length > 0);
    const sessionB = needsSecondVoice && message.voiceIdB && message.modelBundleB
      ? await loadPiperSession(message.id, message.voiceIdB, message.modelBundleB)
      : null;
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');

    const lines = message.lines.filter((line) => line.text.trim().length > 0);
    if (lines.length === 0) throw new Error('There are no readable script or lyric lines to speak.');
    const mode = message.mode ?? 'timed';
    send({
      type: 'STATUS',
      id: message.id,
      state: 'SYNTHESIZING',
      message: mode === 'sequential'
        ? `Synthesizing & timing ${lines.length} scenes…`
        : `Generating speech for ${lines.length} lines…`
    });

    if (mode === 'sequential') {
      let sampleRate = 0;
      const clips: SequentialClipInput[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (cancelled) throw new DOMException('Cancelled', 'AbortError');
        const line = lines[index];
        if (!line) continue;
        const activeSession = line.speaker === 'B' && sessionB ? sessionB : sessionA;
        const wavBlob = await activeSession.predict(line.text);
        const wav = decodeWav(await wavBlob.arrayBuffer());
        const rawMono = toMono(wav.samples, wav.channels);
        if (sampleRate === 0) sampleRate = wav.sampleRate;
        const mono = wav.sampleRate === sampleRate ? rawMono : resampleMono(rawMono, wav.sampleRate, sampleRate);
        clips.push({ lineId: line.id, samples: mono });
        send({ type: 'LINE_PROGRESS', id: message.id, completed: index + 1, total: lines.length });
      }
      if (cancelled) throw new DOMException('Cancelled', 'AbortError');
      const stitched = stitchSequentialVoiceClips(clips, sampleRate || 22_050, {
        pauseUs: Math.max(0, message.pauseUs ?? 300_000)
      });
      send(
        {
          type: 'RESULT',
          id: message.id,
          pcm: stitched.pcm,
          sampleRate: stitched.sampleRate,
          durationUs: stitched.durationUs,
          lineCount: lines.length,
          cues: stitched.cues
        },
        [stitched.pcm.buffer]
      );
      return;
    }

    let sampleRate = 0;
    let maxFrames = 0;
    let track: Float32Array<ArrayBufferLike> = new Float32Array(0);
    const timedCues: { lineId: string; startUs: number; endUs: number }[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      if (cancelled) throw new DOMException('Cancelled', 'AbortError');
      const line = lines[index];
      if (!line) continue;
      const activeSession = line.speaker === 'B' && sessionB ? sessionB : sessionA;
      const wavBlob = await activeSession.predict(line.text);
      const wav = decodeWav(await wavBlob.arrayBuffer());
      const rawMono = toMono(wav.samples, wav.channels);
      if (sampleRate === 0) {
        sampleRate = wav.sampleRate;
        maxFrames = Math.max(0, Math.ceil((Math.max(0, message.durationUs) * sampleRate) / 1_000_000));
        track = new Float32Array(maxFrames);
      }
      const mono = wav.sampleRate === sampleRate ? rawMono : resampleMono(rawMono, wav.sampleRate, sampleRate);
      const startFrame = Math.max(0, Math.round((Math.max(0, line.startUs) * sampleRate) / 1_000_000));
      const endFrame = startFrame + mono.length;
      track = ensureCapacity(track, endFrame);
      maxFrames = Math.max(maxFrames, endFrame);
      for (let sample = 0; sample < mono.length; sample += 1) {
        track[startFrame + sample] = (track[startFrame + sample] ?? 0) + (mono[sample] ?? 0);
      }
      timedCues.push({
        lineId: line.id,
        startUs: Math.round((startFrame / sampleRate) * 1_000_000),
        endUs: Math.round((endFrame / sampleRate) * 1_000_000)
      });
      send({ type: 'LINE_PROGRESS', id: message.id, completed: index + 1, total: lines.length });
    }

    if (cancelled) throw new DOMException('Cancelled', 'AbortError');
    const pcm = track.slice(0, maxFrames);
    for (let index = 0; index < pcm.length; index += 1) {
      pcm[index] = Math.max(-1, Math.min(1, pcm[index] ?? 0));
    }
    send({
      type: 'RESULT',
      id: message.id,
      pcm,
      sampleRate,
      durationUs: Math.round((pcm.length / sampleRate) * 1_000_000),
      lineCount: lines.length,
      cues: timedCues
    }, [pcm.buffer]);
  } catch (error) {
    if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
      send({ type: 'CANCELLED', id: message.id });
    } else {
      send({ type: 'ERROR', id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    activeId = null;
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === 'CANCEL') {
    if (activeId === message.id) cancelled = true;
    return;
  }
  void runSpeech(message);
};
