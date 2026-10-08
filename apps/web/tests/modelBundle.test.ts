import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledFileResponse } from '../src/media/bundledFileStream';
import type { BundledModelFile } from '../src/media/modelBundle';

const text = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

afterEach(() => vi.unstubAllGlobals());

describe('release model bundle streams', () => {
  it('reassembles integrity-checked chunks into a model response in order', async () => {
    const first = text.encode('bundled-');
    const second = text.encode('model-bytes');
    const files = new Map([
      ['/models/v1/model.part-000', first],
      ['/models/v1/model.part-001', second]
    ]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const value = files.get(String(input));
      return value ? new Response(value) : new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const file: BundledModelFile = {
      url: '/models/v1/model',
      bytes: first.byteLength + second.byteLength,
      sha256: 'whole-file-hash-is-recorded-in-manifest',
      contentType: 'application/octet-stream',
      chunks: [
        { url: '/models/v1/model.part-000', bytes: first.byteLength, sha256: await sha256(first) },
        { url: '/models/v1/model.part-001', bytes: second.byteLength, sha256: await sha256(second) }
      ]
    };

    const response = bundledFileResponse(file);
    expect(response.headers.get('content-length')).toBe(String(file.bytes));
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([...first, ...second]));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([...files.keys()]);
  });

  it('rejects a chunk that fails its manifest checksum', async () => {
    const bytes = text.encode('tampered model part');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const file: BundledModelFile = {
      url: '/models/v1/model', bytes: bytes.byteLength, sha256: '', contentType: 'application/octet-stream',
      chunks: [{ url: '/models/v1/model.part', bytes: bytes.byteLength, sha256: 'not-the-right-hash' }]
    };
    await expect(bundledFileResponse(file).arrayBuffer()).rejects.toThrow(/integrity check/);
  });

  it('rejects a manifest whose declared size disagrees with its chunks', () => {
    expect(() => bundledFileResponse({
      url: '/models/v1/model', bytes: 10, sha256: '', contentType: 'application/octet-stream',
      chunks: [{ url: '/models/v1/model.part', bytes: 9, sha256: '' }]
    })).toThrow(/inconsistent file size/);
  });
});
