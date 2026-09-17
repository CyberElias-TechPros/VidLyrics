import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { detectCapabilities, probeCodecs, summariseSupport, type Capabilities, type SupportSummary } from '../../media/capability';
import { readMetricsConsent, writeMetricsConsent, getEdgeClient } from '../../backend/edge';
import { estimateStorage } from '../../storage/idb';

/**
 * Browser support, measured on the actual device.
 *
 * A static support table goes stale and, worse, tells a user their browser can
 * do something it cannot. This page probes the real APIs and reports what THIS
 * machine can do — including the specific degradations, not a vague "limited".
 */

export function SupportPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [codecs, setCodecs] = useState<{ h264: boolean; vp9: boolean; av1: boolean } | null>(null);
  const [summary, setSummary] = useState<SupportSummary | null>(null);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof estimateStorage>>>(null);
  const [metrics, setMetrics] = useState(readMetricsConsent());
  const [health, setHealth] = useState<{ ok: boolean; latencyMs: number } | null>(null);

  useEffect(() => {
    document.title = 'Browser support — Lyrics Video Studio';
    const caps = detectCapabilities();
    setCapabilities(caps);
    void probeCodecs().then((result) => {
      setCodecs({ h264: result.h264, vp9: result.vp9, av1: result.av1 });
      setSummary(summariseSupport(caps, { h264: result.h264, vp9: result.vp9, av1: result.av1 }));
    });
    void estimateStorage().then(setStorage);
    void getEdgeClient().health().then((result) => setHealth({ ok: result.ok, latencyMs: result.latencyMs }));
  }, []);

  const rows: [string, boolean | null, string][] = [
    ['WebCodecs (local MP4 export)', capabilities?.webCodecs ?? null, 'Without it, video export is unavailable. Subtitles and project files still export.'],
    ['H.264 encoder', codecs?.h264 ?? null, 'The codec every platform accepts without re-encoding.'],
    ['VP9 encoder', codecs?.vp9 ?? null, 'Fallback codec when H.264 is missing.'],
    ['Web Audio', capabilities?.webAudio ?? null, 'Required to decode and play audio.'],
    ['IndexedDB', capabilities?.indexedDb ?? null, 'Required for projects to survive a reload.'],
    ['Web Workers', capabilities?.webWorkers ?? null, 'Keeps decoding and analysis off the main thread.'],
    ['OffscreenCanvas', capabilities?.offscreenCanvas ?? null, 'Used for off-thread rendering where available.'],
    ['Cross-origin isolated', capabilities?.crossOriginIsolated ?? null, 'Enables SharedArrayBuffer and threaded WASM.'],
    ['WebGPU', capabilities?.webGpu ?? null, 'Speeds up model-backed alignment. WASM SIMD is the fallback.'],
    ['Intl.Segmenter', capabilities?.intlSegmenter ?? null, 'Grapheme-accurate karaoke fill for emoji and CJK.'],
    ['Service Worker', capabilities?.serviceWorker ?? null, 'Offline availability of the app shell.'],
    ['File System Access', capabilities?.fileSystemAccess ?? null, 'Optional direct save-to-disk.'],
    ['Secure context (HTTPS)', capabilities?.isSecureContext ?? null, 'Several browser APIs are disabled without it.']
  ];

  return (
    <div className="prose">
      <p><Link to="/" style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>← Lyrics Video Studio</Link></p>
      <h1>What this device can do</h1>
      <p className="updated">Measured live in your browser, not a compatibility table</p>

      <p>
        Every feature in this app runs on your hardware, so support depends on what your browser
        exposes. Rather than publish a table that goes stale, this page probes the actual APIs and
        reports what is available here.
      </p>

      {!summary ? <p className="ed-hint">Probing browser capabilities…</p> : null}

      {summary?.blockers.length ? (
        <div className="ed-banner" data-kind="error" style={{ marginBlock: 'var(--sp-5)' }}>
          <h3>What will not work here</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)' }}>
            {summary.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <p style={{ marginTop: 8 }}>
            Manual tap-sync, previewing, and subtitle and project export still work. For local MP4
            export use a Chromium-based browser such as Chrome, Edge, Opera or Brave.
          </p>
        </div>
      ) : null}

      {summary?.degradations.length ? (
        <div className="ed-banner" style={{ marginBlock: 'var(--sp-5)' }}>
          <h3>What will work, with a caveat</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)' }}>
            {summary.degradations.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      ) : null}

      <h2>Capability probe</h2>
      <table>
        <thead>
          <tr><th>Capability</th><th>Status</th><th>Why it matters</th></tr>
        </thead>
        <tbody>
          {rows.map(([name, ok, why]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                {ok === null ? (
                  <span className="ed-hint">checking…</span>
                ) : ok ? (
                  <span className="tick">Available</span>
                ) : (
                  <span className="cross">Missing</span>
                )}
              </td>
              <td style={{ color: 'var(--text-dim)' }}>{why}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>This device</h2>
      <ul>
        <li>CPU threads reported: {capabilities?.hardwareConcurrency ?? 'unknown'}</li>
        <li>Device memory: {capabilities?.deviceMemoryGb ? `${capabilities.deviceMemoryGb} GB` : 'not reported'}</li>
        <li>Touch input: {capabilities?.isTouchDevice ? 'yes' : 'no'}</li>
        <li>
          Browser storage: {storage ? `${(storage.usageBytes / 1048576).toFixed(1)} MB used of ${(storage.quotaBytes / 1048576).toFixed(0)} MB available` : 'unknown'}
        </li>
        <li>Optional edge service: {health ? (health.ok ? `reachable in ${health.latencyMs} ms` : 'unreachable — the app works without it') : 'checking…'}</li>
      </ul>

      <h2>Practical limits</h2>
      <ul>
        <li>A three-minute song is the design target and the case everything is tuned for.</li>
        <li>
          Beyond roughly six minutes at 1080p, a single export can exceed what one browser tab can
          hold. Use the range export in the Export panel instead of attempting the whole track.
        </li>
        <li>
          Keep the tab in the foreground during a long export. Browsers throttle timers in background
          tabs, which stalls the render loop.
        </li>
        <li>
          4K export works but is slow and memory-hungry. 1080p is the right default for almost every
          destination.
        </li>
      </ul>

      <h2>Anonymous usage counts</h2>
      <p>
        The app can send batched counters of enumerated events — for example <code>export_completed</code>{' '}
        with a coarse bucket like <code>1080x1920</code>. It never contains audio, lyrics, filenames or
        any identifier, and no feature depends on it.
      </p>
      <label className="ed-row" style={{ maxWidth: 320 }}>
        <span>Send anonymous usage counts</span>
        <input
          type="checkbox"
          checked={metrics}
          onChange={(e) => {
            writeMetricsConsent(e.target.checked);
            setMetrics(e.target.checked);
          }}
        />
      </label>

      <h2>Still stuck?</h2>
      <p>
        Read the <Link to="/guide">guide</Link>, which covers each workflow and every failure mode with
        its recovery path. Manual tap-sync is always available and needs no special support at all.
      </p>
    </div>
  );
}
