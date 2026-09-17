/**
 * Shared types for the edge service.
 *
 * These deliberately mirror `apps/web/src/backend/edge.ts` by hand rather than
 * importing from it. The client and the server are deployed separately and must
 * be able to be versioned apart; a shared import would couple the app bundle to
 * the worker build.
 */

export interface ModelManifestEntry {
  id: string;
  label: string;
  url: string;
  sizeBytes: number;
  license: string;
  wasmCompatible: boolean;
}

export interface EdgeConfig {
  version: string;
  models: ModelManifestEntry[];
  metricsEnabled: boolean;
  supportUrl: string;
  docsUrl: string;
}

/**
 * Enumerated, never free-text. A free-text field is a channel for content, and
 * content is exactly what this endpoint must never receive.
 */
export const METRIC_EVENTS = [
  'project_created',
  'audio_imported',
  'lyrics_imported',
  'lyrics_pasted',
  'tap_sync_started',
  'tap_sync_completed',
  'auto_align_started',
  'auto_align_low_confidence',
  'export_started',
  'export_completed',
  'export_failed',
  'subtitle_exported',
  'project_exported',
  'project_imported',
  'theme_changed',
  'aspect_changed'
] as const;

export type MetricEvent = (typeof METRIC_EVENTS)[number];

export interface MetricPayload {
  event: MetricEvent;
  bucket?: string;
  outcome?: 'success' | 'failure';
}

/** Bindings. Every one is optional: the worker must run unconfigured. */
export interface Env {
  /** Deployment version, injected by the deploy pipeline. */
  VERSION?: string;
  /**
   * Upstream origin model files are proxied from. Without it, model requests
   * answer 503 with an explanation rather than silently failing.
   */
  MODEL_ORIGIN?: string;
  /**
   * Optional destination for accepted counters. Without it, counters are
   * validated and discarded — the contract is still enforced, nothing is kept.
   * There is no KV, D1 or Durable Object here by design.
   */
  METRICS_SINK?: string;
}

/** A plain response description, so routing is testable without the runtime. */
/** Body is bytes for model pass-through, text for everything else. */
export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string | ArrayBuffer | null;
}

/** The minimal request surface the router needs. */
export interface HttpRequest {
  method: string;
  url: string;
  body: string | null;
}
