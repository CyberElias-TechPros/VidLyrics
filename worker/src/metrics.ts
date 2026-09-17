import { METRIC_EVENTS, type MetricEvent, type MetricPayload } from './types';

/**
 * Server-side enforcement of the privacy contract.
 *
 * The app promises that nothing but enumerated counters leaves the device. A
 * promise made only in client code is not a guarantee — a modified client, a
 * future refactor, or a browser extension could all send more than intended. So
 * the endpoint validates on the way in and drops anything it does not recognise.
 *
 * This is the only place in the system where the "no content, no identifiers"
 * claim is actually enforced rather than asserted, which makes it worth testing
 * properly.
 */

/** Hard cap, matching the client's batch limit. A larger body is rejected whole. */
export const MAX_BATCH = 20;

/**
 * Buckets are coarse by contract: `1080x1920`, `wasm`, `chromium`.
 * A precise value could fingerprint a device, and a long string could carry
 * content, so both length and character set are restricted.
 */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,31}$/;

export interface SanitiseResult {
  accepted: MetricPayload[];
  /** Number dropped, so the caller can report it without echoing content. */
  rejected: number;
  /** Reason when the whole payload was refused rather than trimmed. */
  invalid?: string;
}

const EVENT_SET: ReadonlySet<string> = new Set(METRIC_EVENTS);

export function sanitiseMetrics(raw: unknown): SanitiseResult {
  if (raw === null || typeof raw !== 'object') return { accepted: [], rejected: 0, invalid: 'expected an object' };

  const candidate = raw as { events?: unknown };
  if (!Array.isArray(candidate.events)) return { accepted: [], rejected: 0, invalid: 'expected an events array' };
  if (candidate.events.length > MAX_BATCH) {
    return { accepted: [], rejected: candidate.events.length, invalid: `batch larger than ${MAX_BATCH}` };
  }

  const accepted: MetricPayload[] = [];
  let rejected = 0;

  for (const entry of candidate.events) {
    const clean = sanitiseEvent(entry);
    if (clean) accepted.push(clean);
    else rejected += 1;
  }

  return { accepted, rejected };
}

/** Validate one event. Returns null for anything that is not a bare counter. */
export function sanitiseEvent(entry: unknown): MetricPayload | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const value = entry as Record<string, unknown>;
  if (typeof value.event !== 'string' || !EVENT_SET.has(value.event)) return null;

  const clean: MetricPayload = { event: value.event as MetricEvent };

  if (value.bucket !== undefined) {
    if (typeof value.bucket !== 'string' || !BUCKET_PATTERN.test(value.bucket)) return null;
    if (looksLikeContent(value.bucket)) return null;
    clean.bucket = value.bucket;
  }

  if (value.outcome !== undefined) {
    if (value.outcome !== 'success' && value.outcome !== 'failure') return null;
    clean.outcome = value.outcome;
  }

  // Any other key is an unrecognised channel. Reject the event rather than
  // stripping the key, so a client that starts sending content fails loudly in
  // its own telemetry instead of being silently truncated here.
  const known = ['event', 'bucket', 'outcome'];
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) return null;
  }

  return clean;
}

/**
 * Cheap structural guard against content sneaking into a bucket value.
 *
 * The character set already blocks most of it; this catches the shapes that are
 * unmistakably content or identifiers, so a future loosening of the pattern
 * cannot quietly reopen the channel.
 */
export function looksLikeContent(value: string): boolean {
  if (value.length > 32) return true;
  if (/\s/.test(value)) return true; // content has spaces, buckets do not
  if (/@|\.\.|\/|\\|:\/\//.test(value)) return true; // emails, paths, URLs
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)) return true; // UUIDs
  if (/^[0-9a-f]{32,}$/i.test(value)) return true; // hashes
  return false;
}
