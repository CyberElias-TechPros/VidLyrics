import { buildConfig, resolveModel } from './manifest';
import { sanitiseMetrics, MAX_BATCH } from './metrics';
import type { Env, HttpResult, HttpRequest } from './types';

/**
 * Routing for the single permitted Cloudflare Worker.
 *
 * The scope here is deliberately small. There is no database, no object store,
 * no queue and no user content of any kind, because hosting user audio would
 * turn a local-only tool into a host of unlicensed music with DMCA obligations
 * attached. What is here is: a capability manifest, a liveness probe, a
 * validated anonymous counter sink, and a caching/CORS pass-through for model
 * files.
 *
 * The router is a pure function over a plain request description so it can be
 * tested in plain Node. `index.ts` is the only file that touches the runtime.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** CORS is a wildcard because nothing here is credentialed or user-specific. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
};

/**
 * Model files are content-addressed by hash, so they can be cached forever.
 * `Cross-Origin-Resource-Policy: cross-origin` is what lets a page running with
 * `Cross-Origin-Embedder-Policy: require-corp` load them at all — without it the
 * fetch fails and cross-origin isolation is lost.
 */
const MODEL_CACHE_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable'
};

function json(status: number, payload: unknown, extra: Record<string, string> = {}): HttpResult {
  return { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extra }, body: JSON.stringify(payload) };
}

function text(status: number, body: string, extra: Record<string, string> = {}): HttpResult {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS, ...extra }, body };
}

export async function handle(request: HttpRequest, env: Env): Promise<HttpResult> {
  const url = new URL(request.url, 'https://worker.local');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: { ...CORS_HEADERS }, body: null };
  }

  if (path === '/api/health') return handleHealth(env);
  if (path === '/api/config') return handleConfig(env);
  if (path === '/api/metrics') return await handleMetrics(request, env);
  if (path.startsWith('/models/')) return await handleModel(path, env);

  return json(404, {
    error: 'not_found',
    detail: `No route for ${path}. This worker serves /api/health, /api/config, /api/metrics and /models/:id only.`
  });
}

function handleHealth(env: Env): HttpResult {
  return json(200, { ok: true, version: env.VERSION ?? 'dev' }, { 'cache-control': 'no-store' });
}

function handleConfig(env: Env): HttpResult {
  // metricsEnabled reports whether a sink is configured. Telling the client
  // metrics are on when they are discarded would be a lie about retention.
  return json(
    200,
    buildConfig(env.VERSION ?? 'dev', Boolean(env.METRICS_SINK)),
    { 'cache-control': 'no-store' }
  );
}

async function handleMetrics(request: HttpRequest, env: Env): Promise<HttpResult> {
  if (request.method !== 'POST') return text(405, 'Metrics are POST-only.');

  let parsed: unknown;
  try {
    parsed = request.body ? JSON.parse(request.body) : null;
  } catch {
    return json(400, { error: 'invalid_json', accepted: 0, rejected: 0 });
  }

  const result = sanitiseMetrics(parsed);
  if (result.invalid) {
    return json(422, { error: 'rejected', detail: result.invalid, accepted: 0, rejected: result.rejected });
  }

  if (result.accepted.length > 0 && env.METRICS_SINK) {
    // Forwarded without any added fields. No IP, no user agent, no referer:
    // this function receives none of them and must not invent them.
    await forward(env.METRICS_SINK, result.accepted);
  }

  return json(
    200,
    {
      accepted: result.accepted.length,
      rejected: result.rejected,
      // Explicit, so retention is observable rather than assumed.
      retained: env.METRICS_SINK ? 'forwarded' : 'none'
    },
    { 'cache-control': 'no-store' }
  );
}

/** Best-effort forwarding. A sink outage must not turn into a client error. */
async function forward(sink: string, events: unknown): Promise<void> {
  try {
    await fetch(sink, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(2000)
    });
  } catch {
    /* counted as accepted upstream; the loss is the operator's to notice */
  }
}

async function handleModel(path: string, env: Env): Promise<HttpResult> {
  const id = path.slice('/models/'.length);
  const model = resolveModel(id);
  if (!model) {
    return json(404, {
      error: 'unknown_model',
      detail: `No model with id "${id}". Model ids are validated against the manifest, so this endpoint is not an open proxy.`
    });
  }

  if (!env.MODEL_ORIGIN) {
    return json(503, {
      error: 'model_origin_unconfigured',
      detail: `Model "${id}" is listed but MODEL_ORIGIN is not set, so there is nothing to serve.`
    });
  }

  // `model.url` comes from the manifest in code, never from the request, so the
  // upstream path is not attacker-controlled.
  const upstream = new URL(model.url, env.MODEL_ORIGIN);
  try {
    const response = await fetch(upstream.toString(), {
      cf: { cacheTtl: 86_400, cacheEverything: true },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      return json(502, { error: 'upstream_failed', detail: `Upstream answered ${response.status}.` });
    }
    const body = await response.arrayBuffer();
    return {
      status: 200,
      headers: { ...MODEL_CACHE_HEADERS, 'content-type': 'application/octet-stream' },
      body
    };
  } catch {
    return json(504, { error: 'upstream_timeout', detail: 'The model host did not respond in time.' });
  }
}

export const ROUTE_LIMITS = { maxMetricsBatch: MAX_BATCH };
