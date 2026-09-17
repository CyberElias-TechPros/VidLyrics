import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

/**
 * Legal pages are rendered as real routes with real content.
 *
 * The product's legal posture depends on them: because processing is local, the
 * app cannot verify rights in user content, so responsibility has to be placed
 * clearly in the user's hands, and there has to be a route for a takedown
 * request even though nothing is hosted.
 */

const DOCS: Record<string, { title: string; updated: string; body: React.ReactNode }> = {
  terms: {
    title: 'Terms of service',
    updated: '2026-09-16',
    body: (
      <>
        <p>
          Lyrics Video Studio is a browser application. Audio decoding, lyric timing, rendering and
          video encoding all run on your device. We operate no media processing service and store no
          user content.
        </p>
        <h2>1. Your content, your responsibility</h2>
        <p>
          You supply the audio and the lyrics. You are solely responsible for holding the rights
          necessary to use them, including any synchronisation, mechanical or master-use licences, and
          for how you distribute what you export. Lyrics are licensed separately from recordings, so
          rights to a recording do not by themselves grant rights to its lyrics.
        </p>
        <h2>2. What we do not do</h2>
        <ul>
          <li>We do not fetch, scrape, cache or bundle lyrics from any third-party database.</li>
          <li>We do not accept uploads of audio, video or lyric files.</li>
          <li>We do not host, transcode or distribute your exports.</li>
          <li>We do not run cloud rendering or cloud transcription.</li>
        </ul>
        <h2>3. The software</h2>
        <p>
          The application is provided as-is, without warranty of any kind. Browser APIs evolve and
          differ between vendors; export capability in particular depends on WebCodecs support in your
          browser. No output format, render time or timing accuracy is guaranteed for any specific
          track.
        </p>
        <h2>4. Acceptable use</h2>
        <p>
          Do not use the application to infringe the rights of others, and do not attempt to subvert
          its privacy guarantees by directing it at third-party services.
        </p>
        <h2>5. Liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for any loss arising from use of
          the application, including loss of project data. Projects live in your browser storage, which
          your browser may clear; export a project file for anything you need to keep.
        </p>
        <h2>6. Changes</h2>
        <p>These terms may be updated. The revision date is shown above.</p>
      </>
    )
  },
  privacy: {
    title: 'Privacy',
    updated: '2026-09-16',
    body: (
      <>
        <p>
          This application has no user accounts, no login, and no server-side storage of your content.
          There is nothing to breach, because there is nothing collected.
        </p>
        <h2>What stays on your device</h2>
        <ul>
          <li>Your audio file and its decoded samples</li>
          <li>Waveform peaks, spectral envelope and detected beat grid</li>
          <li>Your lyrics, timings, sections and design choices</li>
          <li>Projects, held in IndexedDB in this browser</li>
        </ul>
        <h2>What leaves your device</h2>
        <ul>
          <li>
            Nothing during normal use. Open your browser’s network panel while importing, editing and
            exporting to confirm: the only requests are for the page itself.
          </li>
          <li>
            If anonymous usage counts are enabled, a batched counter is sent to an edge endpoint. It
            contains only enumerated event names and coarse buckets such as “1080x1920” or “success”.
            It never contains audio, lyrics, filenames, titles or any identifier. You can turn it off
            in the support page, and it is not required for any feature.
          </li>
          <li>
            If automatic alignment models are downloaded, that is a normal file download from the
            content endpoint. No query about your content is sent.
          </li>
        </ul>
        <h2>Storage and deletion</h2>
        <p>
          Your browser may evict site storage under pressure. Deleting a project in the app removes it
          from IndexedDB, and unreferenced audio assets are collected at the same time. Clearing your
          browser’s site data removes everything.
        </p>
        <h2>Children</h2>
        <p>
          No personal data is collected from anyone, so there is no child-specific data handling to
          describe.
        </p>
      </>
    )
  },
  takedown: {
    title: 'Takedown policy',
    updated: '2026-09-16',
    body: (
      <>
        <p>
          This application does not host, cache or distribute any user content. Audio and lyrics are
          processed on the user’s own device and never transmitted to us. Consequently there is no
          stored copy for us to remove, and no user-generated content on our infrastructure.
        </p>
        <h2>If your work appears in a video made with this tool</h2>
        <p>
          The video was produced and published by the user, on their own account with whatever platform
          they chose. A takedown request should be directed to that platform, which is the party
          hosting the infringing material.
        </p>
        <h2>If you believe we are hosting something</h2>
        <p>
          If you have evidence that content is being served from our infrastructure, send the URL, a
          description of the work, and your contact details to the address below. We will investigate
          and remove anything that is genuinely ours to remove.
        </p>
        <h2>Repeat-infringer policy</h2>
        <p>
          Because we hold no accounts and no content, there is no account to terminate. Where a
          distribution of this software is used for infringement, the appropriate remedy is against the
          distributor or the hosting platform.
        </p>
      </>
    )
  },
  licenses: {
    title: 'Open-source licences',
    updated: '2026-09-16',
    body: (
      <>
        <p>
          Every dependency shipped to the browser is listed here with its licence. Nothing with a
          licence that would restrict redistribution or embedding in exported video is included.
        </p>
        <table>
          <thead>
            <tr><th>Package</th><th>Licence</th><th>Used for</th></tr>
          </thead>
          <tbody>
            <tr><td>react, react-dom</td><td>MIT</td><td>UI rendering</td></tr>
            <tr><td>react-router-dom</td><td>MIT</td><td>Routing</td></tr>
            <tr><td>zustand</td><td>MIT</td><td>Editor state</td></tr>
            <tr><td>zod</td><td>MIT</td><td>Runtime validation of imported projects</td></tr>
            <tr><td>mp4-muxer</td><td>BSD-3-Clause</td><td>MP4 container muxing during export</td></tr>
            <tr><td>vite, @vitejs/plugin-react</td><td>MIT</td><td>Build tooling (not shipped)</td></tr>
            <tr><td>vitest</td><td>MIT</td><td>Tests (not shipped)</td></tr>
            <tr><td>wrangler, @cloudflare/workers-types</td><td>MIT / Apache-2.0</td><td>Edge worker tooling</td></tr>
          </tbody>
        </table>
        <h2>Fonts</h2>
        <p>
          No font files are shipped or loaded from a network. The application uses system font stacks,
          so nothing is redistributed and no font licence is implicated. If you load your own font from
          disk, you are responsible for confirming that its licence permits embedding in exported video.
        </p>
        <h2>AI models</h2>
        <p>
          No model weights are bundled in this build. Where model-backed alignment is added, the model
          and its licence will be listed here before it is offered, and the download will be labelled
          with its size and licence at the point of download.
        </p>
      </>
    )
  }
};

export function LegalPage() {
  const { doc } = useParams();
  const entry = doc ? DOCS[doc] : undefined;

  useEffect(() => {
    if (entry) document.title = `${entry.title} — Lyrics Video Studio`;
  }, [entry]);

  if (!entry) {
    return (
      <div className="prose">
        <h1>Document not found</h1>
        <p><Link to="/">Back to home</Link></p>
      </div>
    );
  }

  return (
    <div className="prose">
      <p>
        <Link to="/" style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>← Lyrics Video Studio</Link>
      </p>
      <h1>{entry.title}</h1>
      <p className="updated">Last updated {entry.updated}</p>
      {entry.body}
    </div>
  );
}
