/**
 * Edge service client.
 *
 * The Cloudflare Worker is an OPTIONAL convenience layer. Nothing in the core
 * product depends on it, and that is a deliberate architectural decision rather
 * than an omission: the app's entire value proposition is that audio never
 * leaves the device, so a server that the product cannot work without would
 * contradict the product.
 *
 * The Worker does exactly three things:
 *   1. Serves model files with correct CORS/CORP headers and long-lived caching
 *   2. Accepts anonymous, aggregate-only counters (no content, no identifiers)
 *   3. Reports a capability manifest so the app can tell the user, honestly,
 *      what will and will not work on their device
 *
 * Every call degrades to a no-op offline. A failed call must never surface as an
 * error in the editor.
 */

export interface ModelManifestEntry {
  id: string;
  label: string;
  url: string;
  sizeBytes: number;
  license: string;
  /** True when the model can run on the WASM fallback path. */
  wasmCompatible: boolean;
}

export interface EdgeConfig {
  version: string;
  models: ModelManifestEntry[];
  metricsEnabled: boolean;
  supportUrl: string;
  docsUrl: string;
}

export const DEFAULT_CONFIG: EdgeConfig = {
  version: '0',
  models: [],
  metricsEnabled: false,
  supportUrl: '/support',
  docsUrl: '/docs'
};

/** Metric events are enumerated, not free-text: free text could carry content. */
export type MetricEvent =
  | 'project_created'
  | 'audio_imported'
  | 'lyrics_imported'
  | 'lyrics_pasted'
  | 'tap_sync_started'
  | 'tap_sync_completed'
  | 'auto_align_started'
  | 'auto_align_low_confidence'
  | 'export_started'
  | 'export_completed'
  | 'export_failed'
  | 'subtitle_exported'
  | 'project_exported'
  | 'project_imported'
  | 'theme_changed'
  | 'aspect_changed';

export interface MetricPayload {
  event: MetricEvent;
  /** Coarse buckets only. Precise values could fingerprint a device. */
  bucket?: string;
  /** True/false outcomes, never identifiers or content. */
  outcome?: 'success' | 'failure';
}

export interface EdgeClientOptions {
  baseUrl?: string;
  /** Disabled entirely when the user opts out of anonymous usage counts. */
  metricsEnabled?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const METRIC_BATCH_INTERVAL_MS = 15_000;
const METRIC_BATCH_LIMIT = 20;

export class EdgeClient {
  private queue: MetricPayload[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private config: EdgeConfig = DEFAULT_CONFIG;
  private readonly baseUrl: string;
  private readonly metricsEnabled: boolean;
  private readonly fetchImpl: typeof fetch;
  /** Count of consecutive failures; used to stop hammering a dead service. */
  private failures = 0;

  constructor(options: EdgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api').replace(/\/$/, '');
    this.metricsEnabled = options.metricsEnabled ?? true;
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  /**
   * Load the capability/config manifest.
   * Returns the offline default on any failure — the app never blocks on this.
   */
  async getConfig(): Promise<EdgeConfig> {
    if (this.failures > 3) return this.config;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/config`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        // Keep this request out of any cache the browser cannot revalidate.
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`config ${response.status}`);
      const data = (await response.json()) as EdgeConfig;
      this.config = { ...DEFAULT_CONFIG, ...data };
      this.failures = 0;
      return this.config;
    } catch {
      this.failures += 1;
      return this.config;
    }
  }

  /** Liveness probe used by the support page. */
  async health(): Promise<{ ok: boolean; latencyMs: number; version?: string }> {
    const start = Date.now();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { cache: 'no-store' });
      if (!response.ok) return { ok: false, latencyMs: Date.now() - start };
      const data = (await response.json().catch(() => ({}))) as { version?: string };
      return { ok: true, latencyMs: Date.now() - start, version: data.version };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  /** Queue an anonymous counter. Never throws, never blocks the UI. */
  track(event: MetricEvent, extra: Omit<MetricPayload, 'event'> = {}): void {
    if (!this.metricsEnabled) return;
    if (this.queue.length >= METRIC_BATCH_LIMIT) return;
    this.queue.push({ event, ...extra });
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, METRIC_BATCH_INTERVAL_MS);
  }

  /** Send queued counters. Fire-and-forget by design. */
  async flush(): Promise<void> {
    if (this.queue.length === 0 || !this.metricsEnabled || this.failures > 3) return;
    const batch = this.queue.splice(0, METRIC_BATCH_LIMIT);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true
      });
      if (!response.ok) throw new Error(`metrics ${response.status}`);
      this.failures = 0;
    } catch {
      this.failures += 1;
      // Re-queue at most once; a dead service must not grow an unbounded queue.
      if (this.queue.length < METRIC_BATCH_LIMIT) this.queue.unshift(...batch);
    }
  }

  /** Absolute model URL through the Worker, so CORP/CORS headers are correct. */
  modelUrl(modelId: string): string | null {
    return this.config.models.find((m) => m.id === modelId)?.url ?? null;
  }

  get currentConfig(): EdgeConfig {
    return this.config;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }
}

/** Reads the persisted opt-out. Defaults to ON because the counts are anonymous. */
export function readMetricsConsent(): boolean {
  try {
    return localStorage.getItem('vidlyrics:metrics') !== 'off';
  } catch {
    return true;
  }
}

export function writeMetricsConsent(enabled: boolean): void {
  try {
    localStorage.setItem('vidlyrics:metrics', enabled ? 'on' : 'off');
  } catch {
    /* storage may be unavailable in private mode; consent is then not persisted */
  }
}

let singleton: EdgeClient | null = null;

export function getEdgeClient(): EdgeClient {
  if (!singleton) {
    singleton = new EdgeClient({ baseUrl: '/api', metricsEnabled: readMetricsConsent() });
  }
  return singleton;
}
