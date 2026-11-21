import { useEffect } from 'react';
import { Link } from 'react-router-dom';

/**
 * The guide is real content, not filler.
 *
 * It documents the workflows that exist in the build, and — just as importantly
 * — the failure modes and the recovery path for each. An app whose only
 * documentation is the happy path is not finished.
 */

const SECTIONS = [
  {
    id: 'start',
    title: 'Start a project',
    body: (
      <>
        <p>
          Open <Link to="/app">the studio</Link> and drop an audio file anywhere in the window, or use
          the Audio button. MP3, WAV, FLAC, M4A, AAC and OGG all decode in every modern browser. The
          file is read once, hashed, decoded in a worker, and stored in your browser so reopening the
          project does not decode it again.
        </p>
        <p>
          A project is created immediately and autosaved as you work. There is no save button to
          remember and no account to sign into.
        </p>
      </>
    )
  },
  {
    id: 'video-script',
    title: 'Turn an AI script into a narrated video',
    body: (
      <ol>
        <li>Choose <strong>Script to video</strong> in the studio. Paste a complete VidLyrics JSON spec and choose <strong>Apply &amp; narrate</strong>, or paste plain prose and choose <strong>Build &amp; narrate</strong>. VidLyrics generates speech locally and times each scene to it. No microphone or audio file is needed.</li>
        <li>Check the scene count and click scenes on the timeline to preview them. The headline, kicker, subtext, bullets and chart labels are visual; <code>narration</code> is the spoken script. To edit it without JSON, expand the selected scene’s layout controls.</li>
        <li>If you applied scenes without narration, choose <strong>Auto-time scenes to speech</strong> and <strong>Generate &amp; sync speech</strong>. Before synthesis, automatic timings are estimates. Without a song or generated speech, the video is silent.</li>
        <li>Preview the outro, then export. Use <strong>Projects</strong> to reopen local work or export the project to keep a backup. If a spec fails validation, correct the reported field and try again; the previous timeline stays intact.</li>
      </ol>
    )
  },
  {
    id: 'lyrics',
    title: 'Bring the lyrics',
    body: (
      <>
        <p>
          Use your own lyric text, timed captions or the local speech model. The studio does not fetch lyrics from third-party databases. Use recordings and lyrics you have permission to publish.
        </p>
        <ul>
          <li><strong>Create lyric video draft</strong> — with an empty timeline and a song loaded, generate timed lines and an editable visual treatment locally. Use Review uncertain timings to correct estimated word boundaries.</li>
          <li><strong>Paste text</strong> — one line per lyric. Structural tags such as <code>[Chorus]</code> or <code>(Verse 2)</code> are read as sections.</li>
          <li><strong>Import a file</strong> — LRC, enhanced LRC, SRT, VTT, ASS, JSON or a previous project file. Existing timings are kept.</li>
        </ul>
        <p>
          When a file carries no timings, the editor estimates them from lyric weight so you have
          something to correct rather than a blank timeline. Estimated timings are marked with low
          confidence and coloured accordingly.
        </p>
      </>
    )
  },
  {
    id: 'sync',
    title: 'Put the words in time',
    body: (
      <>
        <p>Three routes, in order of reliability:</p>
        <ol>
          <li>
            <strong>Tap-sync.</strong> Press the tap button in the tool rail, play the track, and press{' '}
            <code>T</code> at the start of each line. Timestamps come from the audio clock, not the wall
            clock, so there is no drift. <code>Z</code> undoes a mistap. Works in every browser and every
            language, with no download.
          </li>
          <li>
            <strong>Auto-timing.</strong> Estimates each line’s duration from its syllable weight across
            the track, then applies lead-in, gap-filling and a minimum readable duration. Good as a
            starting point; rarely final.
          </li>
          <li>
            <strong>Direct editing.</strong> Drag a block to move it, drag its edges to trim it, or select
            it and use <code>[</code> and <code>]</code> to nudge 50 ms at a time.
          </li>
        </ol>
      </>
    )
  },
  {
    id: 'design',
    title: 'Design the video',
    body: (
      <>
        <p>
          The Design panel holds themes, aspect ratio, karaoke behaviour, type, background motion and
          motion transitions. A theme is a complete composition rather than a colour palette, so picking
          one is usually enough.
        </p>
        <p>
          Vertical presets reserve the space platform UI covers — TikTok’s right-hand rail, Instagram’s
          caption area — so lyrics stay clear of them. Turn on safe-area guides with <code>G</code> to see
          the boundary.
        </p>
      </>
    )
  },
  {
    id: 'export',
    title: 'Export',
    body: (
      <>
        <p>
          Export encodes offline at a constant frame rate: each frame is rendered, then handed to the
          hardware encoder with an exact timestamp. This is why the file matches the preview frame for
          frame, and why a slow machine produces a correct file rather than a stuttery one.
        </p>
        <p>
          AAC encoders introduce roughly 1024 samples of priming. The exporter compensates for it, so
          audio does not land early against the video.
        </p>
        <p>
          The studio tries your selected video codec first and tells you if it needs to use another. AAC audio is preferred for compatibility. If it is unavailable, the studio tries Opus for a
          48 kHz mono or stereo track (narration is resampled if needed). Older players may not
          support MP4/Opus. If neither encoder works, the studio exports a silent MP4 and a separate WAV.
        </p>
      </>
    )
  },
  {
    id: 'keyboard',
    title: 'Keyboard shortcuts',
    body: (
      <>
        <p>A complete sync can be done without a mouse.</p>
        <table>
          <tbody>
            {[
              ['Space', 'Play / pause'],
              ['T', 'Tap-sync the current line'],
              ['Z', 'Undo last tap'],
              ['J / K', 'Previous / next line'],
              ['← / →', 'Nudge playhead 100 ms'],
              ['Shift + ← / →', 'Nudge 1 second'],
              ['[ / ]', 'Nudge selected line start / end by 50 ms'],
              ['I / O', 'Set loop in / out at the playhead'],
              ['L', 'Clear loop'],
              ['+ / −', 'Zoom timeline'],
              ['G', 'Safe-area guides'],
              ['H', 'Confidence heat'],
              ['E', 'Export'],
              ['Ctrl/⌘ + Z', 'Undo'],
              ['Ctrl/⌘ + Shift + Z', 'Redo']
            ].map(([key, description]) => (
              <tr key={key}>
                <td><code>{key}</code></td>
                <td>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Shortcuts are ignored while a text field has focus, so editing lyrics cannot trigger them.</p>
      </>
    )
  },
  {
    id: 'failures',
    title: 'When something goes wrong',
    body: (
      <>
        <p>Every failure has a designed recovery. None of them is a dead end.</p>
        <table>
          <thead>
            <tr><th>Failure</th><th>What happens</th><th>Recovery</th></tr>
          </thead>
          <tbody>
            {[
              ['Unsupported or corrupt audio', 'Format guidance and a list of what works', 'Re-export from your music software as WAV or MP3'],
              ['File too large', 'Blocked before decoding, with the practical ceiling explained', 'Export a shorter range, or use a smaller file'],
              ['WebCodecs missing', 'Export is refused with an explanation; the project stays intact', 'Use a Chromium browser, or export subtitles instead'],
              ['Out of memory mid-export', 'The render stops cleanly with timings untouched', 'Lower the resolution or shorten the range'],
              ['Tab backgrounded during render', 'Detected and reported before it stalls', 'Keep the tab visible, or export in sections'],
              ['Storage quota exceeded', 'Named projects to remove, with usage figures', 'Delete old projects; unreferenced audio is collected'],
              ['Same project in two tabs', 'Warned rather than silently overwritten', 'Close the other tab, or take over explicitly'],
              ['Project from a newer version', 'Refused outright instead of silently dropping fields', 'Update the app to open it'],
              ['Audio missing after import', 'Asked to re-link, verified by content hash', 'Choose the original file; a mismatch is rejected'],
              ['Alignment unconvincing', 'Timings marked low-confidence, never presented as certain', 'Tap-sync, which is always one keystroke away']
            ].map(([failure, behaviour, recovery]) => (
              <tr key={failure}>
                <td>{failure}</td>
                <td style={{ color: 'var(--text-dim)' }}>{behaviour}</td>
                <td style={{ color: 'var(--text-dim)' }}>{recovery}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    )
  },
  {
    id: 'data',
    title: 'Your data',
    body: (
      <>
        <p>
          Projects live in IndexedDB in this browser. Export a project file to keep a copy or move it
          to another machine; on import you re-link the original audio file and the app verifies it by
          content hash, so mismatched audio cannot silently corrupt your timings.
        </p>
        <p>
          Your browser may clear site storage under pressure. Anything you need to keep should be
          exported.
        </p>
      </>
    )
  }
];

export function GuidePage() {
  useEffect(() => {
    document.title = 'Guide — Lyrics Video Studio';
  }, []);

  return (
    <div className="prose">
      <p><Link to="/" style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>← Lyrics Video Studio</Link></p>
      <h1>Guide</h1>
      <p className="updated">Everything the studio does, and what to do when it does not work</p>

      <nav aria-label="Guide sections" style={{ marginBottom: 'var(--sp-6)' }}>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {SECTIONS.map((section) => (
        <section id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          {section.body}
        </section>
      ))}
    </div>
  );
}
