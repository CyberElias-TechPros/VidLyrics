import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrefersReducedMotion, useReveal, useScrolled } from '../../lib/hooks';
import { smoothNoise } from '../../core/render/easing';
import { SUBTITLE_FORMATS } from '../../core/export/subtitles';
import { EXPORT_PRESETS } from '../../core/design/tokens';
import { THEMES } from '../../core/design/tokens';

/**
 * Marketing surface.
 *
 * The composition is derived from the product: a waveform, a playhead, a
 * timeline and type appearing in time. Nothing here is a stock hero-plus-cards
 * layout, because none of those say "lyric video".
 *
 * Performance rules this component must not break:
 *   - the hero canvas is the only continuously animating element
 *   - all animation is transform/opacity, so LCP and CLS are unaffected
 *   - every word is in the DOM for crawlers and screen readers
 */

const DEMO_LINE = ['Every', 'word', 'lands', 'exactly', 'on', 'the', 'beat'];

function HeroWave() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const barCount = () => Math.max(28, Math.floor(width / 9));

    const draw = (timeSec: number) => {
      ctx.clearRect(0, 0, width, height);
      const count = barCount();
      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (count - 1)) / count);
      const midY = height * 0.58;
      const playhead = reduced ? 0.42 : ((timeSec * 0.045) % 1);

      for (let i = 0; i < count; i += 1) {
        const x = i * (barWidth + gap);
        const t = i / count;

        // Two octaves of value noise plus a decaying envelope produce something
        // that reads as music rather than as a random bar chart.
        const envelope = Math.sin(Math.PI * t) ** 0.6;
        const wave =
          0.55 + 0.45 * smoothNoise(t * 9 + timeSec * 0.35, 1) * smoothNoise(t * 23 - timeSec * 0.2, 7);
        const distance = Math.abs(t - playhead);
        // Bars near the playhead light up: the visual argument for the product.
        const excite = reduced ? 0 : Math.max(0, 1 - distance * 9) * 0.9;
        const magnitude = Math.max(0.03, envelope * wave * 0.5 + excite);
        const barHeight = Math.max(2, magnitude * height * 0.46);

        const warm = Math.max(0, 1 - distance * 5);
        ctx.fillStyle =
          warm > 0.02
            ? `rgba(255, ${Math.round(150 + warm * 60)}, ${Math.round(80 + warm * 40)}, ${0.35 + warm * 0.6})`
            : `rgba(255, 255, 255, ${0.05 + magnitude * 0.14})`;
        ctx.fillRect(x, midY - barHeight, barWidth, barHeight * 2);
      }

      if (!reduced) {
        ctx.fillStyle = 'rgba(255, 107, 129, 0.85)';
        ctx.fillRect(playhead * width - 0.5, 0, 1.5, height);
      }
    };

    if (reduced) {
      draw(0);
    } else {
      const loop = (time: number) => {
        draw(time / 1000);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reduced]);

  return <canvas ref={canvasRef} className="hero-wave" aria-hidden="true" />;
}

/** The signature moment: a lyric line fills itself karaoke-style, in time. */
function KineticLyric() {
  const [index, setIndex] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setIndex(DEMO_LINE.length);
      return;
    }
    const id = setInterval(() => {
      setIndex((i) => (i >= DEMO_LINE.length ? 0 : i + 1));
    }, 260);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <div className="hero-demo">
      <span className="hero-demo-time" aria-hidden="true">
        00:{String(Math.floor(index * 0.26)).padStart(2, '0')}.00
      </span>
      <p className="hero-demo-line" aria-label="Every word lands exactly on the beat">
        {DEMO_LINE.map((word, i) => (
          <b key={word} data-on={i < index ? 'true' : 'false'} aria-hidden="true">
            {word}
          </b>
        ))}
      </p>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lede,
  className = '',
  children
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lede?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, visible } = useReveal();
  return (
    <section id={id} className={`section ${className}`}>
      <div ref={ref} className="reveal" data-visible={visible ? 'true' : 'false'}>
        <header className="section-head">
          {eyebrow ? <span className="section-eyebrow">{eyebrow}</span> : null}
          <h2 className="section-title">{title}</h2>
          {lede ? <p className="section-lede">{lede}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

const PIPELINE = [
  {
    step: '01',
    title: 'Drop in the audio',
    body:
      'MP3, WAV, FLAC, M4A, OGG. The file is decoded in a worker, so the interface stays responsive while a peak map and a spectral envelope are built for the waveform, the visualizer and beat detection.'
  },
  {
    step: '02',
    title: 'Bring your own lyrics',
    body:
      'Paste text, or import LRC, enhanced LRC, SRT, VTT, ASS, JSON or a previous project. Timings you already have are kept; structural tags like [Chorus] are read as sections.'
  },
  {
    step: '03',
    title: 'Put the words in time',
    body:
      'Tap one key per line while the track plays and timestamps come from the audio clock, not the wall clock. Or let timing be estimated from lyric weight, then correct it by dragging on the waveform.'
  },
  {
    step: '04',
    title: 'Make it look like a record',
    body:
      'Eight art-directed themes, karaoke fill modes, album-safe typography, safe-area guides per platform, intro and outro cards, and a beat-reactive visualizer driven by the track itself.'
  },
  {
    step: '05',
    title: 'Export the video',
    body:
      'WebCodecs encodes offline at a constant frame rate — never a realtime capture — so the file matches the preview frame for frame. Subtitles and the project file export alongside it.'
  }
];

const FAQS = [
  {
    q: 'Does my audio get uploaded anywhere?',
    a: 'No. Decoding, analysis, rendering and encoding all happen in this browser tab. There is no server-side media pipeline to upload to. You can verify it yourself: open the network tab, import a track, export a video, and the only requests are for the page itself.'
  },
  {
    q: 'Do I need an account?',
    a: 'No. Projects are stored in your browser with IndexedDB, and you can export a project file to keep or move them. An account would only add friction to a workflow that never leaves your device.'
  },
  {
    q: 'Where do the lyrics come from?',
    a: 'From you. Lyrics are licensed separately from recordings, so this app never fetches, scrapes or bundles a lyrics database. You paste them, import a subtitle file, or type them in.'
  },
  {
    q: 'Why does export need Chrome or Edge?',
    a: 'Local MP4 export uses WebCodecs, which Safari and Firefox do not expose. On those browsers you can still sync, preview, and export subtitles and project files — and manual tap-sync works everywhere. Nothing is hidden: the support page lists exactly what your browser can do.'
  },
  {
    q: 'What is tap-sync, and why is it the default recovery path?',
    a: 'You play the track and press one key at the start of each line. It needs no model, no download and no GPU, it works in every browser and every language, and it is exact. Whenever an automated step is unavailable or unconvincing, tap-sync is one keystroke away.'
  },
  {
    q: 'How long is too long?',
    a: 'A three-minute song is the design target. Beyond roughly six minutes at high resolution a single export can exceed what one browser tab can hold in memory, so the editor offers a range export instead of failing halfway through.'
  },
  {
    q: 'Is it really free?',
    a: 'The entire core workflow runs on your hardware, so there is no per-video compute cost to recover. The only server is an optional edge worker that serves model files and counts anonymous events — it holds no user media.'
  }
];

export function Landing() {
  const scrolled = useScrolled(10);

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    document.title = 'Lyrics Video Studio — synced lyric videos, entirely in your browser';
  }, []);

  return (
    <div className="mkt">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="mkt-nav" data-scrolled={scrolled ? 'true' : 'false'} aria-label="Main">
        <Link to="/" className="mkt-brand">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <rect x="1" y="9" width="3" height="8" rx="1.5" fill="currentColor" opacity="0.55" />
            <rect x="6" y="5" width="3" height="16" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="11" y="2" width="3" height="22" rx="1.5" fill="#ffb454" />
            <rect x="16" y="7" width="3" height="12" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="21" y="10" width="3" height="6" rx="1.5" fill="currentColor" opacity="0.55" />
          </svg>
          <span>
            Lyrics<span style={{ color: 'var(--amber)' }}>Video</span>
          </span>
        </Link>
        <ul className="mkt-nav-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#privacy">Privacy</a></li>
          <li><a href="#formats">Formats</a></li>
          <li><a href="#faq">FAQ</a></li>
          <li><a href="/support">Support</a></li>
        </ul>
        <Link to="/app" className="btn btn-primary btn-sm">
          Open the studio
        </Link>
      </nav>

      <main id="main">
        <header className="hero">
          <HeroWave />
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-vignette" aria-hidden="true" />

          <div>
            <span className="hero-eyebrow">Runs entirely on your device</span>
            <h1 className="hero-title">
              <span className="ln"><span>Lyrics that</span></span>
              <span className="ln"><span>land on <em>time</em>,</span></span>
              <span className="ln"><span>in <span className="accent">minutes</span>.</span></span>
            </h1>
            <p className="hero-sub">
              Drop in a track and your lyrics. Tap along once, pick a look, export an MP4 and the
              subtitle files. No upload, no render queue, no account — your audio never leaves the
              machine it came from.
            </p>
            <div className="hero-cta">
              <Link to="/app" className="btn btn-primary btn-lg">
                Start a lyric video
              </Link>
              <a href="#how" className="btn btn-ghost btn-lg">
                See how it works
              </a>
            </div>

            <div className="hero-proof">
              <span><strong>100%</strong> client-side</span>
              <span><strong>0</strong> files uploaded</span>
              <span><strong>MP4 + LRC + SRT + VTT + ASS</strong></span>
              <span><strong>Free</strong>, no account</span>
            </div>
          </div>

          <KineticLyric />
        </header>

        <Section
          id="how"
          eyebrow="The pipeline"
          title="Five steps, and one of them is optional."
          lede="Automated timing is a convenience, not a dependency. If it is unavailable, unconvincing or simply not to your taste, manual tap-sync gets you the same result."
        >
          <dl className="pipeline">
            {PIPELINE.map((item) => (
              <div className="pipeline-step" key={item.step}>
                <dt>{item.step}</dt>
                <dd>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          id="privacy"
          className="privacy"
          eyebrow="Privacy by architecture"
          title="Your audio never leaves your device — and that is verifiable, not a promise."
          lede="Most tools that claim privacy still upload media to a queue. This one has no media pipeline to upload to, because every stage runs in your browser tab."
        >
          <div className="privacy-grid">
            {[
              { t: 'Decoding', ok: true, d: 'AudioContext inside the tab. The bytes are read once from disk and stay in memory.' },
              { t: 'Analysis', ok: true, d: 'Peaks, spectral envelope and beat detection run in a worker on your CPU.' },
              { t: 'Rendering', ok: true, d: 'Canvas 2D frames, generated offline at a constant frame rate.' },
              { t: 'Encoding', ok: true, d: 'WebCodecs on your hardware encoder. The MP4 is assembled locally.' },
              { t: 'Storage', ok: true, d: 'IndexedDB on this device. Export a project file if you want a copy.' },
              { t: 'Media upload', ok: false, d: 'There is no endpoint that accepts audio. Not disabled — absent.' }
            ].map((row) => (
              <article className="privacy-card" key={row.t}>
                <h3>
                  <span className={row.ok ? 'tick' : 'cross'} aria-hidden="true">{row.ok ? '✓' : '✕'}</span>{' '}
                  {row.t}
                </h3>
                <p>{row.d}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section
          id="formats"
          eyebrow="What comes out"
          title="One project, every format you need to post it."
          lede="The same timeline exports to video and to every subtitle format that matters. Nothing is re-timed on the way out."
        >
          <table className="compare">
            <caption className="sr-only">Export formats and aspect presets</caption>
            <thead>
              <tr>
                <th scope="col">Output</th>
                <th scope="col">Formats</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Video</td>
                <td>MP4 (H.264 + AAC)</td>
                <td>Offline constant-frame-rate encode. Frame-accurate, matches the preview exactly.</td>
              </tr>
              <tr>
                <td>Lyric timings</td>
                <td>{SUBTITLE_FORMATS.filter((f) => f.id !== 'json').map((f) => f.label).join(', ')}</td>
                <td>Enhanced LRC carries per-word timing; ASS carries karaoke fill tags.</td>
              </tr>
              <tr>
                <td>Data</td>
                <td>Timed JSON</td>
                <td>Line and word timings, sections, confidence and instrumental regions. Declares its time unit.</td>
              </tr>
              <tr>
                <td>Project</td>
                <td>.vidlyricsproject</td>
                <td>Schema-versioned, with forward migrations. Re-link the audio on import.</td>
              </tr>
            </tbody>
          </table>

          <div className="ed-aspects" style={{ marginTop: 'var(--sp-6)' }}>
            {EXPORT_PRESETS.filter((p) => p.id !== 'custom').map((preset) => (
              <div className="ed-aspect" key={preset.id} aria-label={`${preset.label}, ${preset.width} by ${preset.height}`}>
                <i
                  style={{
                    width: `${Math.max(14, Math.round((preset.width / preset.height) * 26))}px`,
                    height: '26px'
                  }}
                />
                <span>{preset.label}</span>
              </div>
            ))}
          </div>

          <p className="ed-hint" style={{ marginTop: 'var(--sp-5)', maxWidth: '62ch' }}>
            Vertical presets reserve the space platform UI covers, so lyrics stay clear of captions and
            buttons instead of sitting under them.
          </p>
        </Section>

        <Section
          id="themes"
          eyebrow="Art direction"
          title="Themes with an opinion."
          lede="Each theme is a full composition — type, colour, motion and karaoke behaviour chosen together, rather than a palette you assemble yourself."
        >
          <div className="ed-themes">
            {THEMES.map((theme) => (
              <article className="ed-theme" key={theme.id} style={{ cursor: 'default' }}>
                <span className="ed-theme-swatch" style={{ background: theme.background.colors[0] }}>
                  {theme.swatches.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span className="ed-theme-name">
                  <strong style={{ display: 'block', color: 'var(--text)' }}>{theme.name}</strong>
                  {theme.category}
                </span>
              </article>
            ))}
          </div>
        </Section>

        <Section id="faq" eyebrow="Questions" title="The things people ask before trusting a tool with their master.">
          <div className="faq">
            {FAQS.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <div className="faq-body">{item.a}</div>
              </details>
            ))}
          </div>
        </Section>

        <section className="final">
          <h2>Your track is already on your computer.</h2>
          <p className="section-lede" style={{ margin: '0 auto var(--sp-6)', maxWidth: '52ch' }}>
            Nothing to upload, nothing to wait for. Open the studio and the first frame is rendered
            before you finish reading this sentence.
          </p>
          <Link to="/app" className="btn btn-primary btn-lg">
            Open the studio
          </Link>
        </section>
      </main>

      <footer className="mkt-footer">
        <div>
          <h4>Product</h4>
          <ul>
            <li><Link to="/app">Open the studio</Link></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#formats">Export formats</a></li>
          </ul>
        </div>
        <div>
          <h4>Resources</h4>
          <ul>
            <li><Link to="/guide">Guide</Link></li>
            <li><Link to="/support">Browser support</Link></li>
            <li><Link to="/guide#keyboard">Keyboard shortcuts</Link></li>
          </ul>
        </div>
        <div>
          <h4>Legal</h4>
          <ul>
            <li><Link to="/legal/terms">Terms of service</Link></li>
            <li><Link to="/legal/privacy">Privacy</Link></li>
            <li><Link to="/legal/takedown">Takedown policy</Link></li>
            <li><Link to="/legal/licenses">Open-source licences</Link></li>
          </ul>
        </div>
        <div className="mkt-footer-bottom">
          <span>© {new Date().getFullYear()} Lyrics Video Studio</span>
          <span>Processing is local. Rights in your content are yours to clear.</span>
        </div>
      </footer>
    </div>
  );
}

/** FAQ structured data, rendered alongside the visible FAQ it describes. */
export function FaqJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
