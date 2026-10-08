import type { BundledModelFile } from './modelBundle';

async function checkedChunk(chunk: BundledModelFile['chunks'][number], signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(chunk.url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Bundled model part failed to load (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== chunk.bytes) throw new Error('A bundled model part has an unexpected size. The app update may be incomplete.');
  if (globalThis.crypto?.subtle && chunk.sha256) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    if (actual !== chunk.sha256) throw new Error('A bundled model part failed its integrity check. Reload the app before trying again.');
  }
  return new Uint8Array(bytes);
}

/** Stream a large model from individually hosted, integrity-checked release chunks. */
export function bundledFileResponse(file: BundledModelFile, signal?: AbortSignal): Response {
  if (file.chunks.length === 0) throw new Error('No model bundle parts were provided.');
  const totalBytes = file.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  if (totalBytes !== file.bytes) throw new Error('The bundled model manifest has an inconsistent file size.');

  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted) {
        controller.error(new DOMException('Model download cancelled.', 'AbortError'));
        return;
      }
      if (index >= file.chunks.length) {
        controller.close();
        return;
      }
      try {
        const chunk = file.chunks[index];
        if (!chunk) throw new Error('The bundled model manifest is missing a chunk.');
        controller.enqueue(await checkedChunk(chunk, signal));
        index += 1;
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      index = file.chunks.length;
    }
  });
  return new Response(body, {
    headers: {
      'content-type': file.contentType,
      'content-length': String(file.bytes)
    }
  });
}
