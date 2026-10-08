/// <reference lib="webworker" />
import { configureWasm, initWhisper } from '@fugood/node-whisper-wasm';
import whisperSingleJsUrl from '@fugood/node-whisper-wasm/wasm/whisper-node.js?url';
import whisperSingleWasmUrl from '@fugood/node-whisper-wasm/wasm/whisper-node.wasm?url';
import whisperThreadsJsUrl from '@fugood/node-whisper-wasm/wasm/whisper-node.threads.js?url';
import whisperThreadsWasmUrl from '@fugood/node-whisper-wasm/wasm/whisper-node.threads.wasm?url';
import { resampleMono } from '../../core/audio/resample';
import { bundledFileResponse } from '../bundledFileStream';
import type { SelectedWhisperModel } from '../modelBundle';

const MODEL_CACHE_NAME = 'vidlyrics-whisper-models-v1';
type ModelSize = 'tiny' | 'base';
type IncomingMessage =
  | { type: 'TRANSCRIBE'; id: string; samples: Float32Array; sampleRate: number; model: ModelSize; modelBundle: SelectedWhisperModel; language: string | null }
  | { type: 'CANCEL'; id: string };

type OutgoingMessage =
  | { type: 'STATUS'; id: string; state: 'DOWNLOADING' | 'LOADING' | 'TRANSCRIBING'; message: string }
  | { type: 'MODEL_READY'; id: string; version: string; url: string; bundleId: string; bytes: number; sha256: string }
  | { type: 'DOWNLOAD_PROGRESS'; id: string; loaded: number; total: number }
  | { type: 'TRANSCRIBE_PROGRESS'; id: string; progress: number }
  | { type: 'RESULT'; id: string; language: string | null; text: string; segments: { text: string; t0: number; t1: number }[] }
  | { type: 'ERROR'; id: string; message: string }
  | { type: 'CANCELLED'; id: string };

const useThreads = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
configureWasm({
  worker: false,
  threads: useThreads,
  jsPath: useThreads ? whisperThreadsJsUrl : whisperSingleJsUrl,
  wasmPath: useThreads ? whisperThreadsWasmUrl : whisperSingleWasmUrl
});

let activeId: string | null = null;
let activeAbort: AbortController | null = null;
let activeTranscription: { stop: () => Promise<void> } | null = null;
let cancelled = false;

function send(message: OutgoingMessage): void {
  self.postMessage(message);
}

async function cacheModelWithProgress(id: string, model: SelectedWhisperModel): Promise<string> {
  if (!('caches' in self) || typeof caches.open !== 'function') {
    throw new Error('This browser does not support model caching. Use a current browser with site storage enabled.');
  }

  const cache = await caches.open(MODEL_CACHE_NAME);
  const cacheKey = new URL(model.url, self.location.href).href;
  const cached = await cache.match(cacheKey);
  if (cached) {
    send({ type: 'DOWNLOAD_PROGRESS', id, loaded: model.bytes, total: model.bytes });
    return cacheKey;
  }
  if (!model.allowFetch) {
    throw new Error('The saved Whisper model is no longer available in browser storage. Approve the bundled model update to download it again.');
  }

  send({ type: 'STATUS', id, state: 'DOWNLOADING', message: 'Loading the bundled Whisper model from this app…' });
  activeAbort = new AbortController();
  const response = bundledFileResponse(model, activeAbort.signal);
  if (!response.body) throw new Error('The bundled model could not be read.');

  // Tee the stream so Cache Storage writes the model directly to disk while the
  // second reader reports progress. The release pack is split into small static
  // files, then reconstructed into one Cache Storage entry for whisper.cpp.
  const [cacheStream, progressStream] = response.body.tee();
  const cacheWrite = cache.put(cacheKey, new Response(cacheStream, {
    headers: { 'content-type': model.contentType, 'content-length': String(model.bytes) }
  }));
  const reader = progressStream.getReader();
  let loaded = 0;
  try {
    while (true) {
      if (cancelled) throw new DOMException('Cancelled', 'AbortError');
      const next = await reader.read();
      if (next.done) break;
      loaded += next.value.byteLength;
      send({ type: 'DOWNLOAD_PROGRESS', id, loaded, total: model.bytes });
    }
    await cacheWrite;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    activeAbort = null;
  }
  send({ type: 'DOWNLOAD_PROGRESS', id, loaded, total: model.bytes });
  return cacheKey;
}

async function runTranscription(message: Extract<IncomingMessage, { type: 'TRANSCRIBE' }>): Promise<void> {
  activeId = message.id;
  cancelled = false;
  let context: Awaited<ReturnType<typeof initWhisper>> | null = null;
  try {
    const modelUrl = message.modelBundle.url;
    const cacheKey = await cacheModelWithProgress(message.id, message.modelBundle);
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');

    send({ type: 'STATUS', id: message.id, state: 'LOADING', message: 'Loading Whisper in this browser…' });
    context = await initWhisper({
      filePath: modelUrl,
      useGpu: false,
      maxModelBytes: 300 * 1024 * 1024,
      modelCacheName: MODEL_CACHE_NAME,
      modelCacheKey: cacheKey,
      cacheModel: true,
      worker: false
    });
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');
    if (message.modelBundle.previousUrl && message.modelBundle.previousUrl !== modelUrl) {
      await caches.open(MODEL_CACHE_NAME).then((cache) => cache.delete(new URL(message.modelBundle.previousUrl!, self.location.href).href));
    }
    send({
      type: 'MODEL_READY', id: message.id, version: message.modelBundle.version,
      url: modelUrl, bundleId: message.modelBundle.bundleId,
      bytes: message.modelBundle.bytes, sha256: message.modelBundle.sha256
    });

    send({ type: 'STATUS', id: message.id, state: 'TRANSCRIBING', message: 'Listening for lyric lines…' });
    const audio = resampleMono(message.samples, message.sampleRate, 16_000);
    const options = {
      maxThreads: Math.max(1, Math.min(4, Number(navigator.hardwareConcurrency) || 2)),
      tokenTimestamps: false,
      ...(message.language && message.language !== 'auto' ? { language: message.language } : {}),
      onProgress: (progress: number) => {
        const normalized = progress > 1 ? progress / 100 : progress;
        send({ type: 'TRANSCRIBE_PROGRESS', id: message.id, progress: Math.max(0, Math.min(1, normalized)) });
      }
    };
    const operation = context.transcribeData(audio, options);
    activeTranscription = operation;
    const result = await operation.promise;
    activeTranscription = null;
    if (cancelled || result.isAborted) throw new DOMException('Cancelled', 'AbortError');

    send({
      type: 'RESULT',
      id: message.id,
      language: result.language ?? null,
      text: result.result,
      segments: result.segments.map((segment) => ({ text: segment.text, t0: segment.t0, t1: segment.t1 }))
    });
  } catch (error) {
    if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
      send({ type: 'CANCELLED', id: message.id });
    } else {
      send({ type: 'ERROR', id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    activeAbort = null;
    activeTranscription = null;
    await context?.release().catch(() => undefined);
    activeId = null;
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === 'CANCEL') {
    if (activeId === message.id) {
      cancelled = true;
      activeAbort?.abort();
      void activeTranscription?.stop().catch(() => undefined);
    }
    return;
  }
  void runTranscription(message);
};
