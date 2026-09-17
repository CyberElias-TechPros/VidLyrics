/**
 * Runtime capability detection.
 *
 * Every degradation in this app is decided here, once, and surfaced in the UI
 * as an honest capability panel. A feature that silently does nothing is worse
 * than a feature that says it cannot run.
 */

export interface Capabilities {
  webCodecs: boolean;
  webCodecsH264: boolean;
  webCodecsVp9: boolean;
  offscreenCanvas: boolean;
  webAudio: boolean;
  indexedDb: boolean;
  storageEstimate: boolean;
  webGpu: boolean;
  webWorkers: boolean;
  fileSystemAccess: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  serviceWorker: boolean;
  broadcastChannel: boolean;
  intlSegmenter: boolean;
  mediaRecorder: boolean;
  isSecureContext: boolean;
  isTouchDevice: boolean;
  isIos: boolean;
  isSafari: boolean;
  isFirefox: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
}

function has(path: string): boolean {
  try {
    return path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], globalThis) !== undefined;
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  const g = globalThis as Record<string, unknown>;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  const isIos = /iP(hone|ad|od)/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return {
    webCodecs: has('VideoEncoder') && has('VideoDecoder'),
    webCodecsH264: false, // resolved asynchronously by probeCodecs()
    webCodecsVp9: false,
    offscreenCanvas: has('OffscreenCanvas'),
    webAudio: has('AudioContext') || has('webkitAudioContext'),
    indexedDb: has('indexedDB'),
    storageEstimate: typeof navigator !== 'undefined' && !!navigator.storage?.estimate,
    webGpu: has('navigator.gpu'),
    webWorkers: has('Worker'),
    fileSystemAccess: has('window.showOpenFilePicker'),
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    sharedArrayBuffer: has('SharedArrayBuffer'),
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    broadcastChannel: has('BroadcastChannel'),
    intlSegmenter: typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function',
    mediaRecorder: has('MediaRecorder'),
    isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : false,
    isTouchDevice: typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0,
    isIos,
    isSafari,
    isFirefox,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    deviceMemoryGb: typeof navigator !== 'undefined' ? ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null) : null
  };
}

/** Ask the encoder what it can actually do, rather than guessing from the UA. */
export async function probeCodecs(): Promise<{ h264: boolean; vp9: boolean; av1: boolean; preferred: 'h264' | 'vp9' | 'av1' | null }> {
  const result = { h264: false, vp9: false, av1: false, preferred: null as 'h264' | 'vp9' | 'av1' | null };
  if (typeof VideoEncoder === 'undefined') return result;

  const test = async (codec: string, hardwareAcceleration: 'prefer-hardware' | 'prefer-software') => {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, width: 320, height: 240, bitrate: 500_000, framerate: 30, hardwareAcceleration });
      return support.supported === true;
    } catch {
      return false;
    }
  };

  result.h264 = (await test('avc1.42001f', 'prefer-hardware')) || (await test('avc1.42001f', 'prefer-software'));
  result.vp9 = (await test('vp09.00.10.08', 'prefer-hardware')) || (await test('vp09.00.10.08', 'prefer-software'));
  result.av1 = await test('av01.0.04M.08', 'prefer-software');
  // H.264 first: it is what every platform accepts without a re-encode.
  result.preferred = result.h264 ? 'h264' : result.vp9 ? 'vp9' : result.av1 ? 'av1' : null;
  return result;
}

/** A single decision object the UI can render as a support matrix. */
export interface SupportSummary {
  canExportMp4: boolean;
  canPreview: boolean;
  canAutoAlign: boolean;
  canPersistProjects: boolean;
  canWorkOffline: boolean;
  threadedWasm: boolean;
  blockers: string[];
  degradations: string[];
}

export function summariseSupport(capabilities: Capabilities, codecs: { h264: boolean; vp9: boolean; av1: boolean }): SupportSummary {
  const blockers: string[] = [];
  const degradations: string[] = [];

  const canExportMp4 = capabilities.webCodecs && (codecs.h264 || codecs.vp9);
  if (!capabilities.webCodecs) blockers.push('WebCodecs is unavailable, so local MP4 export cannot run in this browser.');
  else if (!codecs.h264 && !codecs.vp9) blockers.push('No supported video codec was found on this device.');

  if (!capabilities.webAudio) blockers.push('Web Audio is unavailable, so audio cannot be decoded or played.');
  if (!capabilities.indexedDb) degradations.push('IndexedDB is unavailable — projects will not survive a reload.');
  if (!capabilities.crossOriginIsolated) degradations.push('The page is not cross-origin isolated, so threaded WASM and SharedArrayBuffer are disabled.');
  if (!capabilities.webGpu) degradations.push('WebGPU is unavailable — automatic alignment will use the slower WASM path.');
  if (!capabilities.isSecureContext) degradations.push('This page is not served over HTTPS, so several browser APIs are disabled.');
  if (capabilities.isIos) degradations.push('iOS Safari may stop a long export when the tab is backgrounded. Keep it visible.');

  return {
    canExportMp4,
    canPreview: capabilities.webAudio && capabilities.offscreenCanvas !== undefined,
    canAutoAlign: capabilities.webWorkers,
    canPersistProjects: capabilities.indexedDb,
    canWorkOffline: capabilities.serviceWorker && capabilities.indexedDb,
    threadedWasm: capabilities.crossOriginIsolated && capabilities.sharedArrayBuffer,
    blockers,
    degradations
  };
}

/** Rough render-throughput expectation, used for the ETA shown before export. */
export function realtimeFactor(capabilities: Capabilities): number {
  const cores = capabilities.hardwareConcurrency;
  if (capabilities.isTouchDevice) return 6;
  if (cores >= 12) return 1.8;
  if (cores >= 8) return 2.4;
  return 3.5;
}
