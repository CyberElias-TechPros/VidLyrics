import { describe, it, expect, vi, afterEach } from 'vitest';
import { handle } from '../src/router';
import type { Env, HttpRequest } from '../src/types';

/**
 * Routing, headers and degradation.
 *
 * The router is pure over a plain request description, so these run in Node
 * without the Workers runtime.
 */

function request(method: string, path: string, body: string | null = null): HttpRequest {
  return { method, url: `https://edge.example.com${path}`, body };
}

const unconfigured: Env = {};

describe('/api/health', () => {
  it('answers 200 with a version, and is never cached', async () => {
    const result = await handle(request('GET', '/api/health'), { VERSION: '1.2.3' });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ ok: true, version: '1.2.3' });
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('reports a dev version when VERSION is not injected', async () => {
    const result = await handle(request('GET', '/api/health'), unconfigured);
    expect(JSON.parse(result.body as string).version).toBe('dev');
  });
});

describe('/api/config', () => {
  it('returns a manifest shaped like the client expects', async () => {
    const result = await handle(request('GET', '/api/config'), { VERSION: '1.0.0' });
    const config = JSON.parse(result.body as string);
    expect(config).toEqual({
      version: '1.0.0',
      models: [],
      metricsEnabled: false,
      supportUrl: '/support',
      docsUrl: '/guide'
    });
  });

  it('is honest that no models are offered in this build', async () => {
    const result = await handle(request('GET', '/api/config'), unconfigured);
    expect(JSON.parse(result.body as string).models).toEqual([]);
  });

  it('reports metrics as disabled when there is no sink to retain them', async () => {
    const without = await handle(request('GET', '/api/config'), unconfigured);
    expect(JSON.parse(without.body as string).metricsEnabled).toBe(false);

    const withSink = await handle(request('GET', '/api/config'), { METRICS_SINK: 'https://sink.test/i' });
    expect(JSON.parse(withSink.body as string).metricsEnabled).toBe(true);
  });
});

describe('/api/metrics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a clean batch and says what it did with it', async () => {
    const result = await handle(
      request('POST', '/api/metrics', JSON.stringify({ events: [{ event: 'export_completed', bucket: '1080x1920' }] })),
      unconfigured
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ accepted: 1, rejected: 0, retained: 'none' });
  });

  it('states plainly when nothing was retained', async () => {
    const result = await handle(
      request('POST', '/api/metrics', JSON.stringify({ events: [{ event: 'theme_changed' }] })),
      unconfigured
    );
    expect(JSON.parse(result.body as string).retained).toBe('none');
  });

  it('counts rejected events without echoing their content back', async () => {
    const result = await handle(
      request('POST', '/api/metrics', JSON.stringify({ events: [{ event: 'lyrics_pasted', text: 'secret lyric' }] })),
      unconfigured
    );
    expect(result.status).toBe(200);
    const body = result.body as string;
    expect(JSON.parse(body)).toEqual({ accepted: 0, rejected: 1, retained: 'none' });
    expect(body).not.toContain('secret lyric');
  });

  it('refuses malformed JSON with 400', async () => {
    const result = await handle(request('POST', '/api/metrics', '{not json'), unconfigured);
    expect(result.status).toBe(400);
  });

  it('refuses a body that is not a batch with 422', async () => {
    const result = await handle(request('POST', '/api/metrics', JSON.stringify({ event: 'theme_changed' })), unconfigured);
    expect(result.status).toBe(422);
  });

  it('rejects anything but POST', async () => {
    expect((await handle(request('GET', '/api/metrics'), unconfigured)).status).toBe(405);
  });

  it('forwards accepted events to the sink when one is configured', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await handle(
      request('POST', '/api/metrics', JSON.stringify({ events: [{ event: 'tap_sync_completed' }] })),
      { METRICS_SINK: 'https://sink.test/ingest' }
    );

    expect(JSON.parse(result.body as string)).toEqual({ accepted: 1, rejected: 0, retained: 'forwarded' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sink.test/ingest');
    expect(JSON.parse(init.body as string)).toEqual({ events: [{ event: 'tap_sync_completed' }] });
  });

  it('does not forward rejected events', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await handle(
      request('POST', '/api/metrics', JSON.stringify({ events: [{ event: 'bogus_event' }] })),
      { METRICS_SINK: 'https://sink.test/ingest' }
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still answers 200 when the sink is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sink down'); }));
    const result = await handle(
      request('POST', '/api/metrics', JSON.stringify({ events: [{ event: 'export_started' }] })),
      { METRICS_SINK: 'https://sink.test/ingest' }
    );
    expect(result.status).toBe(200);
  });
});

describe('/models/:id', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers 404 for an unknown id instead of proxying it upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await handle(request('GET', '/models/whisper-tiny'), { MODEL_ORIGIN: 'https://models.test' });

    expect(result.status).toBe(404);
    expect(JSON.parse(result.body as string).error).toBe('unknown_model');
    // The whole point: an unknown id never reaches the upstream origin, so this
    // endpoint cannot be turned into an open proxy by changing the path.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a traversal attempt without touching the upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Percent-encoded so URL normalisation cannot collapse it before the router
    // sees it; the router must reject it on the manifest check alone.
    const result = await handle(request('GET', '/models/%2e%2e%2f%2e%2e%2fsecret'), {
      MODEL_ORIGIN: 'https://models.test'
    });

    expect(result.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is honest that the manifest is empty in this build', async () => {
    const result = await handle(request('GET', '/models/whisper-tiny'), unconfigured);
    expect(result.status).toBe(404);
  });
});

describe('headers and routing', () => {
  it('answers preflight with 204 and permissive CORS', async () => {
    const result = await handle(request('OPTIONS', '/api/metrics'), unconfigured);
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe('*');
    expect(result.headers['access-control-allow-headers']).toBe('content-type');
  });

  it('allows any origin, which is safe only because nothing here is credentialed', async () => {
    for (const path of ['/api/health', '/api/config', '/api/metrics']) {
      const result = await handle(request('GET', path), unconfigured);
      expect(result.headers['access-control-allow-origin'], path).toBe('*');
    }
  });

  it('ignores trailing slashes', async () => {
    expect((await handle(request('GET', '/api/health/'), unconfigured)).status).toBe(200);
  });

  it('returns a 404 that names the routes this worker actually has', async () => {
    const result = await handle(request('GET', '/api/upload'), unconfigured);
    expect(result.status).toBe(404);
    const detail = JSON.parse(result.body as string).detail as string;
    expect(detail).toContain('/api/health');
    expect(detail).toContain('/models/:id');
  });

  it('has no route that accepts media, which is the constraint the design rests on', async () => {
    for (const path of ['/upload', '/api/upload', '/api/audio', '/api/render', '/api/projects']) {
      expect((await handle(request('POST', path, 'binary'), unconfigured)).status, path).toBe(404);
    }
  });
});
