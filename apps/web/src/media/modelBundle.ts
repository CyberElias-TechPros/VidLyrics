export interface BundledModelChunk {
  url: string;
  bytes: number;
  sha256: string;
}

export interface BundledModelFile {
  /** Logical URL used as the model-cache key. */
  url: string;
  bytes: number;
  sha256: string;
  contentType: string;
  chunks: BundledModelChunk[];
}

export interface BundledWhisperModel extends BundledModelFile {
  version: string;
}

export interface BundledPiperVoice {
  version: string;
  upstreamPath: string;
  bytes: number;
  onnx: BundledModelFile;
  config: BundledModelFile;
  license: BundledModelFile;
}

export interface BundledModelManifest {
  schemaVersion: 1;
  bundleId: string;
  generatedAt: string;
  whisper: Record<'tiny' | 'base', BundledWhisperModel>;
  piper: Record<string, BundledPiperVoice>;
  licenses: { whisper: BundledModelFile };
}

export interface SelectedWhisperModel {
  id: 'tiny' | 'base';
  version: string;
  bundleId: string;
  url: string;
  bytes: number;
  sha256: string;
  contentType: string;
  chunks: BundledModelChunk[];
  allowFetch: boolean;
  updateAccepted: boolean;
  previousUrl?: string;
}

export interface SelectedPiperModel extends BundledPiperVoice {
  voiceId: string;
  bundleId: string;
  allowFetch: boolean;
  updateAccepted: boolean;
  previousVersion?: string;
}

interface InstalledModel {
  version: string;
  bundleId: string;
  url: string;
  bytes: number;
  sha256?: string;
}

const MANIFEST_URL = '/models/manifest.json';
const INSTALLED_KEY_PREFIX = 'vidlyrics-installed-model-v1:';
const WHISPER_CACHE_NAME = 'vidlyrics-whisper-models-v1';
const LEGACY_WHISPER_URLS = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
} as const;

let manifestPromise: Promise<BundledModelManifest> | null = null;

async function loadManifest(): Promise<BundledModelManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) {
        throw new Error('This app release does not include the bundled speech models. Run the full model-pack build before deploying.');
      }
      const value = await response.json() as Partial<BundledModelManifest>;
      if (value.schemaVersion !== 1 || !value.bundleId || !value.whisper?.tiny || !value.whisper?.base || !value.piper || !value.licenses?.whisper) {
        throw new Error('The bundled model manifest is invalid. Rebuild the app model pack.');
      }
      return value as BundledModelManifest;
    }).catch((error: unknown) => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

function installedModelMetaUrl(kind: 'whisper' | 'piper', id: string): string {
  return new URL(`/__vidlyrics-model-meta__/${kind}/${encodeURIComponent(id)}`, window.location.href).href;
}

function parseInstalledModel(raw: string | null): InstalledModel | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InstalledModel>;
    if (typeof parsed.version !== 'string' || typeof parsed.url !== 'string') return null;
    return {
      version: parsed.version,
      bundleId: typeof parsed.bundleId === 'string' ? parsed.bundleId : 'legacy',
      url: parsed.url,
      bytes: typeof parsed.bytes === 'number' ? parsed.bytes : 0,
      sha256: typeof parsed.sha256 === 'string' ? parsed.sha256 : undefined
    };
  } catch {
    return null;
  }
}

async function readInstalled(kind: 'whisper' | 'piper', id: string): Promise<InstalledModel | null> {
  try {
    const local = parseInstalledModel(localStorage.getItem(`${INSTALLED_KEY_PREFIX}${kind}:${id}`));
    if (local) return local;
  } catch {
    // Continue with Cache Storage when localStorage is disabled.
  }
  try {
    const cache = await caches.open(WHISPER_CACHE_NAME);
    const response = await cache.match(installedModelMetaUrl(kind, id));
    return parseInstalledModel(response ? await response.text() : null);
  } catch {
    return null;
  }
}

export function rememberInstalledModel(
  kind: 'whisper' | 'piper',
  id: string,
  model: { version: string; bundleId: string; url: string; bytes: number; sha256?: string }
): void {
  const serialized = JSON.stringify(model);
  try {
    localStorage.setItem(`${INSTALLED_KEY_PREFIX}${kind}:${id}`, serialized);
  } catch {
    // Cache Storage below remains the authoritative fallback in private contexts.
  }
  try {
    if (typeof caches !== 'undefined') {
      void caches.open(WHISPER_CACHE_NAME).then((cache) => cache.put(
        installedModelMetaUrl(kind, id),
        new Response(serialized, { headers: { 'content-type': 'application/json' } })
      )).catch(() => undefined);
    }
  } catch {
    // The engine remains usable even if neither browser metadata store is writable.
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit >= 2 ? 1 : 0)} ${units[unit]}`;
}

function confirmUpdate(label: string, bytes: number, previousAvailable: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  const fallback = previousAvailable
    ? 'Cancel keeps using the model already stored in this browser.'
    : 'The older local copy is no longer available; canceling means this model cannot run until an update is approved.';
  return window.confirm(
    `A newer bundled ${label} model is available (${formatBytes(bytes)}).\n\n` +
    `Allow VidLyrics to fetch this update from its own app bundle? ${fallback}`
  );
}

async function hasWhisperModel(url: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(WHISPER_CACHE_NAME);
    return !!await cache.match(url);
  } catch {
    return false;
  }
}

async function findLegacyWhisperModel(id: 'tiny' | 'base'): Promise<InstalledModel | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(WHISPER_CACHE_NAME);
    const url = LEGACY_WHISPER_URLS[id];
    const response = await cache.match(url);
    if (!response) return null;
    return {
      version: 'legacy',
      bundleId: 'legacy',
      url,
      bytes: Number(response.headers.get('content-length') ?? 0)
    };
  } catch {
    return null;
  }
}

async function hasStoredPiperModel(voiceId: string): Promise<boolean> {
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') return false;
    const root = await navigator.storage.getDirectory();
    const piper = await root.getDirectoryHandle('piper');
    await piper.getFileHandle(`${voiceId}.onnx`);
    await piper.getFileHandle(`${voiceId}.onnx.json`);
    return true;
  } catch {
    return false;
  }
}

export async function selectBundledWhisperModel(id: 'tiny' | 'base'): Promise<SelectedWhisperModel> {
  const manifest = await loadManifest();
  const model = manifest.whisper[id];
  const installed = await readInstalled('whisper', id) ?? await findLegacyWhisperModel(id);
  const needsUpdate = !!installed && installed.version !== model.version;
  const previousAvailable = installed ? await hasWhisperModel(installed.url) : false;
  const approved = needsUpdate ? confirmUpdate(`Whisper ${id === 'tiny' ? 'Tiny' : 'Base'}`, model.bytes, previousAvailable) : false;

  if (needsUpdate && !approved && installed) {
    if (!previousAvailable) throw new Error('The previous Whisper model is no longer available. Approve the bundled update to restore transcription.');
    return {
      id,
      version: installed.version,
      bundleId: installed.bundleId,
      url: installed.url,
      bytes: installed.bytes,
      sha256: installed.sha256 ?? '',
      contentType: 'application/octet-stream',
      chunks: [],
      allowFetch: false,
      updateAccepted: false
    };
  }

  return {
    ...model,
    id,
    bundleId: manifest.bundleId,
    allowFetch: true,
    updateAccepted: needsUpdate && approved,
    ...(installed ? { previousUrl: installed.url } : {})
  };
}

export async function selectBundledPiperModel(voiceId: string): Promise<SelectedPiperModel> {
  const manifest = await loadManifest();
  const model = manifest.piper[voiceId];
  if (!model) throw new Error(`The bundled release does not contain the “${voiceId}” Piper voice.`);
  const installed = await readInstalled('piper', voiceId);
  const legacyPresent = installed ? false : await hasStoredPiperModel(voiceId);
  const previous = installed ?? (legacyPresent ? {
    version: 'legacy',
    bundleId: 'legacy',
    url: '',
    bytes: model.bytes
  } : null);
  const needsUpdate = !!previous && previous.version !== model.version;
  const previousAvailable = !!previous && await hasStoredPiperModel(voiceId);
  const approved = needsUpdate ? confirmUpdate(`Piper ${voiceId}`, model.bytes, previousAvailable) : false;
  if (needsUpdate && !approved && !previousAvailable) {
    throw new Error('The previous Piper voice model is no longer available. Approve the bundled update to restore text-to-speech.');
  }

  return {
    ...model,
    voiceId,
    bundleId: manifest.bundleId,
    allowFetch: !(needsUpdate && !approved),
    updateAccepted: needsUpdate && approved,
    ...(needsUpdate && previous ? { previousVersion: previous.version } : {})
  };
}
