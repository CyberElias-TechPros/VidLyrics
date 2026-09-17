import { describe, it, expect } from 'vitest';
import { sanitiseEvent, sanitiseMetrics, looksLikeContent, MAX_BATCH } from '../src/metrics';

/**
 * The privacy contract, tested as a contract.
 *
 * The client promises that only enumerated counters leave the device. These
 * tests pin what the server accepts, because that is the only place the promise
 * is enforced rather than asserted.
 */

describe('sanitiseEvent', () => {
  it('accepts a bare enumerated counter', () => {
    expect(sanitiseEvent({ event: 'export_completed' })).toEqual({ event: 'export_completed' });
  });

  it('accepts a coarse bucket and a boolean outcome', () => {
    expect(sanitiseEvent({ event: 'export_completed', bucket: '1080x1920', outcome: 'success' })).toEqual({
      event: 'export_completed',
      bucket: '1080x1920',
      outcome: 'success'
    });
  });

  it('rejects an event name that is not in the enumeration', () => {
    expect(sanitiseEvent({ event: 'lyrics_text' })).toBeNull();
    expect(sanitiseEvent({ event: '' })).toBeNull();
    expect(sanitiseEvent({ event: 'EXPORT_COMPLETED' })).toBeNull();
  });

  it('rejects a missing or non-string event', () => {
    expect(sanitiseEvent({})).toBeNull();
    expect(sanitiseEvent({ event: 42 })).toBeNull();
    expect(sanitiseEvent(null)).toBeNull();
    expect(sanitiseEvent('export_completed')).toBeNull();
    expect(sanitiseEvent([1, 2])).toBeNull();
  });

  it('rejects any unrecognised key rather than silently stripping it', () => {
    expect(sanitiseEvent({ event: 'audio_imported', fileName: 'my song.mp3' })).toBeNull();
    expect(sanitiseEvent({ event: 'audio_imported', title: 'Song' })).toBeNull();
    expect(sanitiseEvent({ event: 'audio_imported', ip: '1.2.3.4' })).toBeNull();
  });

  it('rejects a bucket with spaces, which is content and not a bucket', () => {
    expect(sanitiseEvent({ event: 'lyrics_pasted', bucket: 'i love this song' })).toBeNull();
  });

  it('rejects a bucket that looks like an identifier', () => {
    expect(sanitiseEvent({ event: 'audio_imported', bucket: 'user@example.com' })).toBeNull();
    expect(sanitiseEvent({ event: 'audio_imported', bucket: 'https://x.test/a' })).toBeNull();
    expect(sanitiseEvent({ event: 'audio_imported', bucket: '550e8400-e29b-41d4-a716-446655440000' })).toBeNull();
  });

  it('rejects an over-long bucket', () => {
    expect(sanitiseEvent({ event: 'theme_changed', bucket: 'a'.repeat(64) })).toBeNull();
  });

  it('rejects an outcome that is not a boolean label', () => {
    expect(sanitiseEvent({ event: 'export_failed', outcome: 'maybe' })).toBeNull();
    expect(sanitiseEvent({ event: 'export_failed', outcome: true })).toBeNull();
  });

  it('rejects uppercase buckets, keeping the alphabet small and checkable', () => {
    expect(sanitiseEvent({ event: 'theme_changed', bucket: 'Nocturne' })).toBeNull();
    expect(sanitiseEvent({ event: 'theme_changed', bucket: 'nocturne' })).toEqual({
      event: 'theme_changed',
      bucket: 'nocturne'
    });
  });
});

describe('sanitiseMetrics', () => {
  it('splits a batch into accepted and rejected without failing the whole request', () => {
    const result = sanitiseMetrics({
      events: [{ event: 'export_completed' }, { event: 'not_a_real_event' }, { event: 'tap_sync_started' }]
    });
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toBe(1);
    expect(result.invalid).toBeUndefined();
  });

  it('refuses a body that is not an object with an events array', () => {
    expect(sanitiseMetrics(null).invalid).toBeTruthy();
    expect(sanitiseMetrics([]).invalid).toBeTruthy();
    expect(sanitiseMetrics({ events: 'nope' }).invalid).toBeTruthy();
    expect(sanitiseMetrics({ counters: [] }).invalid).toBeTruthy();
  });

  it('refuses an oversized batch whole rather than trimming it', () => {
    const events = Array.from({ length: MAX_BATCH + 1 }, () => ({ event: 'theme_changed' }));
    const result = sanitiseMetrics({ events });
    expect(result.invalid).toContain(String(MAX_BATCH));
    expect(result.accepted).toHaveLength(0);
  });

  it('accepts an empty batch', () => {
    expect(sanitiseMetrics({ events: [] })).toEqual({ accepted: [], rejected: 0 });
  });

  it('accepts exactly the batch limit', () => {
    const events = Array.from({ length: MAX_BATCH }, () => ({ event: 'theme_changed' }));
    expect(sanitiseMetrics({ events }).accepted).toHaveLength(MAX_BATCH);
  });
});

describe('looksLikeContent', () => {
  it('flags the shapes that are unmistakably content or identifiers', () => {
    expect(looksLikeContent('first verse of the song')).toBe(true);
    expect(looksLikeContent('user@example.com')).toBe(true);
    expect(looksLikeContent('../../etc/passwd')).toBe(true);
    expect(looksLikeContent('https://example.com/x')).toBe(true);
    expect(looksLikeContent('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(looksLikeContent('a'.repeat(33))).toBe(true);
  });

  it('passes the coarse buckets the app actually sends', () => {
    for (const bucket of ['1080x1920', 'wasm', 'webgpu', 'chromium', 'success', '4k']) {
      expect(looksLikeContent(bucket), bucket).toBe(false);
    }
  });
});
