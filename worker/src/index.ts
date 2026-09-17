import { handle } from './router';
import type { Env } from './types';

/**
 * Worker entry point.
 *
 * This file is intentionally the thinnest possible adapter: it converts the
 * runtime's `Request` into the plain description the router takes, and its
 * result back into a `Response`. All logic lives in `router.ts`, which is pure
 * and therefore testable in plain Node.
 *
 * Security headers for the app itself (COOP/COEP, CSP) are not set here — the
 * app is static and served from Pages, where `public/_headers` owns them. This
 * worker only serves JSON and model bytes.
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const body = request.method === 'POST' ? await request.text() : null;
    const result = await handle(
      { method: request.method, url: request.url, body },
      env ?? {}
    );
    return new Response(result.body, { status: result.status, headers: result.headers });
  }
} satisfies ExportedHandler<Env>;
