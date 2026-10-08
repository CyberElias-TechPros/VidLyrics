import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEditor } from '../../state/store';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { DesignPanel, ExportPanel, LyricsPanel } from './Panels';
import { formatTimecode, usFromMs } from '../../core/time';
import { tapProgress } from '../../core/timing/tap';
import {
  cancelExport, importAudioFile, relinkAudioFile, importProjectFile, loadStoredProject, persist,
  runExport, seekTo, togglePlayback, nudgePlayhead, disposeSession,
  setLoopRegion, clearLoopRegion
} from '../../media/session';
import { listProjects, deleteProject, garbageCollectAssets } from '../../storage/projectRepo';
import { useHotkeys, useModifierHotkeys } from '../../lib/hooks';
import { RECOVERY_LABELS } from '../../core/errors';
import { classifyFile, validateAudioFile, validateLyricsText } from '../../core/validation/files';
import { parseLyrics } from '../../core/lyrics/parse';

/**
 * The editor shell.
 *
 * Every interaction path — mouse, keyboard, drag, file drop — converges on the
 * same store commands, so a keyboard-only user and a mouse user get identical
 * results and identical undo history.
 */

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['T', 'Tap-sync the current line'],
  ['Z', 'Undo last tap'],
  ['J / K', 'Previous / next line'],
  ['← / →', 'Nudge playhead 100 ms'],
  ['Shift + ← / →', 'Nudge 1 second'],
  ['[ / ]', 'Nudge selected line start / end'],
  ['I / O', 'Set loop in / out at the playhead'],
  ['L', 'Clear loop'],
  ['+ / −', 'Zoom timeline in / out'],
  ['G', 'Toggle safe-area guides'],
  ['H', 'Toggle confidence heat'],
  ['E', 'Export video'],
  ['Ctrl/⌘ + Z', 'Undo'],
  ['Ctrl/⌘ + Shift + Z', 'Redo']
];

export function Editor() {
  const store = useEditor();
  const { project, media, render, tap, tapActive, playheadUs, playing, panel, dirty, notices } = store;
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const lyricInputRef = useRef<HTMLInputElement | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* --------------------------- autosave --------------------------- */

  useEffect(() => {
    if (!dirty) return;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => void persist(), 2000);
    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, [dirty, project]);

  // Flush on unload. IndexedDB writes started in `beforeunload` are not
  // guaranteed to finish, which is why the debounced write above is the primary
  // mechanism and this is only the last chance.
  useEffect(() => {
    const onUnload = () => void persist();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => () => disposeSession(), []);

  /* --------------------------- shortcuts --------------------------- */

  const selectedLine = useMemo(
    () => project.lyrics.lines.find((l) => l.id === store.selectedIds[0]) ?? null,
    [project.lyrics.lines, store.selectedIds]
  );

  const jumpToLine = (delta: number) => {
    const lines = [...project.lyrics.lines].sort((a, b) => a.start - b.start);
    if (lines.length === 0) return;
    let index = lines.findIndex((l) => l.id === selectedLine?.id);
    if (index === -1) index = lines.findIndex((l) => playheadUs < l.start);
    const next = lines[Math.max(0, Math.min(lines.length - 1, index + delta))];
    if (next) {
      store.setSelection([next.id]);
      seekTo(next.start);
    }
  };

  useHotkeys({
    ' ': () => void togglePlayback(),
    t: () => {
      if (!tapActive) return;
      store.tapAt(useEditor.getState().playheadUs);
    },
    z: () => {
      if (tapActive) store.tapUndo();
    },
    j: () => jumpToLine(-1),
    k: () => jumpToLine(1),
    ArrowLeft: () => nudgePlayhead(-usFromMs(100)),
    ArrowRight: () => nudgePlayhead(usFromMs(100)),
    '[': () => selectedLine && store.nudgeLine(selectedLine.id, 'start', -usFromMs(50)),
    ']': () => selectedLine && store.nudgeLine(selectedLine.id, 'end', usFromMs(50)),
    i: () => setLoopRegion(playheadUs, project.audio?.durationUs ?? playheadUs + usFromMs(5000)),
    o: () => setLoopRegion(useEditor.getState().loop?.startUs ?? 0, playheadUs),
    l: () => clearLoopRegion(),
    '+': () => store.setZoom(project.ui.zoomPxPerSecond * 1.25),
    '-': () => store.setZoom(project.ui.zoomPxPerSecond / 1.25),
    g: () => store.setShowGuides(!store.showGuides),
    h: () => store.setShowHeat(!store.showHeat),
    e: () => void runExport(),
    '?': () => setShowShortcuts(true)
  });

  useModifierHotkeys({
    z: () => store.undo(),
    'shift+z': () => store.redo(),
    s: () => void persist()
  });

  /* --------------------------- file input --------------------------- */

  const onAudioFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const current = useEditor.getState();
    if (current.audioMissing && current.project.audio) {
      await relinkAudioFile(file, current.project.audio.contentHash);
      return;
    }
    await importAudioFile(file);
  };

  const onProjectFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await importProjectFile(file);
  };

  const onLyricFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (classifyFile(file.name, file.type) === 'audio') {
      await importAudioFile(file);
      return;
    }
    const text = await file.text();
    const validity = validateLyricsText(text);
    if (!validity.ok) {
      store.notify({ kind: 'error', title: 'No lyrics found', detail: 'That file had no readable lyric lines.' });
      return;
    }
    const parsed = parseLyrics(text, file.name);
    if (parsed.lines.length > 0 && parsed.lines.some((l) => l.start !== null)) {
      // Reconstruct an LRC-style text so existing timings survive the round trip.
      const reconstructed = parsed.lines
        .map((l) => `[${Math.floor((l.start ?? 0) / 60_000_000)}:${String(Math.floor(((l.start ?? 0) / 1_000_000) % 60)).padStart(2, '0')}.${String(Math.floor(((l.start ?? 0) / 10_000) % 100)).padStart(2, '0')}]${l.text}`)
        .join('\n');
      store.setLyricsFromText(reconstructed, 'file', file.name);
    } else {
      store.setLyricsFromText(text, 'file', file.name);
    }
    for (const warning of parsed.warnings) {
      store.notify({ kind: 'warning', title: 'Import note', detail: warning });
    }
    store.notify({ kind: 'success', title: `${parsed.lines.length} lines imported`, detail: `Detected as ${parsed.format.toUpperCase()}.` });
  };

  /* --------------------------- drag & drop --------------------------- */

  const [dragOver, setDragOver] = useState(false);
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const kind = classifyFile(file.name, file.type);
    if (kind === 'audio' || kind === 'unknown') void onAudioFiles(event.dataTransfer.files);
    else if (kind === 'lyrics') void onLyricFiles(event.dataTransfer.files);
    else if (kind === 'project') void onProjectFiles(event.dataTransfer.files);
    else store.notify({ kind: 'warning', title: 'Unsupported drop', detail: 'Choose an audio file, lyrics file, or VidLyrics project.' });
  };

  const busy = render.state === 'RENDERING' || render.state === 'ENCODING' || render.state === 'PREPARING' || render.state === 'MUXING' || render.state === 'QUEUED';
  const relinkingAudio = media.state === 'IMPORTING' || media.state === 'DECODING' || media.state === 'ANALYZING';

  return (
    <div
      className="ed"
      data-panel-open={panelOpen ? 'true' : 'false'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input ref={audioInputRef} type="file" accept="audio/*,video/*,application/octet-stream,.mp3,.mp2,.wav,.flac,.m4a,.m4b,.aac,.ogg,.opus,.aiff,.aif,.aifc,.caf,.amr,.gsm,.wma,.ape,.wv,.tta,.mpc,.dsf,.dff,.eac3,.ac3,.dts,.qoa,.mod,.xm,.s3m,.it,.mpa,.m1a,.m2a,.mkv,.mka,.avi,.mov,.m4v,.3gp,.3g2" className="sr-only" onChange={(e) => { void onAudioFiles(e.target.files); e.currentTarget.value = ''; }} />
      <input ref={projectInputRef} type="file" accept=".vidlyricsproject,.vlsp,.json" className="sr-only" onChange={(e) => void onProjectFiles(e.target.files)} />
      <input ref={lyricInputRef} type="file" accept=".lrc,.srt,.vtt,.ass,.ssa,.txt,.json" className="sr-only" onChange={(e) => void onLyricFiles(e.target.files)} />

      {/* ---------------- top bar ---------------- */}
      <header className="ed-top">
        <Link to="/" className="mkt-brand" style={{ fontSize: 'var(--step-0)', flex: 'none' }} aria-label="Back to home">
          <svg width="20" height="20" viewBox="0 0 26 26" aria-hidden="true">
            <rect x="1" y="9" width="3" height="8" rx="1.5" fill="currentColor" opacity="0.55" />
            <rect x="6" y="5" width="3" height="16" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="11" y="2" width="3" height="22" rx="1.5" fill="#ffb454" />
            <rect x="16" y="7" width="3" height="12" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="21" y="10" width="3" height="6" rx="1.5" fill="currentColor" opacity="0.55" />
          </svg>
        </Link>
        <div className="ed-title-field">
          <input
            className="ed-title-input"
            value={project.meta.title}
            placeholder="Untitled project"
            onChange={(e) => store.setMeta({ title: e.target.value })}
            aria-label="Project title"
          />
          <input
            className="ed-artist-input"
            value={project.meta.artist}
            placeholder="Artist"
            onChange={(e) => store.setMeta({ artist: e.target.value })}
            aria-label="Artist"
          />
        </div>
        <span className="ed-save" data-dirty={dirty ? 'true' : 'false'} role="status">
          {dirty ? 'Saving…' : 'Saved locally'}
        </span>
        <div className="ed-top-actions">
          <button className="btn btn-sm btn-ghost" onClick={() => store.undo()} disabled={!store.canUndo()} title={store.undoLabel() ?? 'Nothing to undo'}>
            Undo
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => store.redo()} disabled={!store.canRedo()} title={store.redoLabel() ?? 'Nothing to redo'}>
            Redo
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => audioInputRef.current?.click()}>
            Audio
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => lyricInputRef.current?.click()}>
            Lyrics
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => projectInputRef.current?.click()}>
            Open
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowProjects(true)}>
            Projects
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void runExport()} disabled={busy || hasExportBlockers(project)}>
            {busy ? 'Rendering…' : 'Export video'}
          </button>
        </div>
      </header>

      {/* ---------------- rail ---------------- */}
      <nav className="ed-rail" aria-label="Tools">
        <button className="ed-rail-btn" aria-pressed={panel === 'lyrics'} title="Lyrics" onClick={() => { store.setPanel('lyrics'); setPanelOpen(true); }}>≡</button>
        <button className="ed-rail-btn" aria-pressed={panel === 'design'} title="Design" onClick={() => { store.setPanel('design'); setPanelOpen(true); }}>◐</button>
        <button className="ed-rail-btn" aria-pressed={panel === 'export'} title="Export" onClick={() => { store.setPanel('export'); setPanelOpen(true); }}>↧</button>
        <span className="ed-rail-sep" />
        <button className="ed-rail-btn" aria-pressed={store.showGuides} title="Safe-area guides (G)" onClick={() => store.setShowGuides(!store.showGuides)}>▣</button>
        <button className="ed-rail-btn" aria-pressed={store.showHeat} title="Confidence heat (H)" onClick={() => store.setShowHeat(!store.showHeat)}>◔</button>
        <button className="ed-rail-btn" aria-pressed={tapActive} title="Tap-sync (T)" onClick={() => (tapActive ? store.stopTapSync() : store.startTapSync())}>⏺</button>
        <span className="ed-rail-sep" />
        <button className="ed-rail-btn" title="Keyboard shortcuts (?)" onClick={() => setShowShortcuts(true)}>?</button>
      </nav>

      {/* ---------------- stage ---------------- */}
      <main className="ed-stage">
        {store.audioMissing && project.audio ? (
          <div className="ed-empty" style={{ gridRow: '1 / 3', placeSelf: 'center' }} role="alert">
            <h2>Re-link your audio</h2>
            <p>
              This project still has its lyrics and timing, but the original track “{project.audio.fileName}”
              is not available in this browser. Select the same audio file to restore playback and keep
              the existing timing aligned; VidLyrics verifies it by content hash.
            </p>
            {relinkingAudio ? <p className="ed-hint" role="status">Verifying and loading the selected audio locally…</p> : null}
            {media.state === 'FAILED' && media.error ? (
              <div className="ed-banner" data-kind="error" style={{ textAlign: 'left', maxWidth: 460 }}>
                <h3>{media.error.title}</h3>
                <p>{media.error.detail}</p>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => audioInputRef.current?.click()} disabled={relinkingAudio}>{relinkingAudio ? 'Relinking…' : 'Re-link'}</button>
              <button className="btn btn-ghost" onClick={() => lyricInputRef.current?.click()}>Import lyrics</button>
              <button className="btn btn-ghost" onClick={() => projectInputRef.current?.click()}>Open project</button>
            </div>
          </div>
        ) : media.error || (!project.audio && media.state !== 'READY') ? (
          <div className="ed-empty" style={{ gridRow: '1 / 3', placeSelf: 'center' }}>
            <h2>Start with a track</h2>
            <p>
              Drop an audio file anywhere on this window, or choose one below. Everything that happens
              next — decode, analyse, time, render, encode — happens on this device.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => audioInputRef.current?.click()}>Choose audio</button>
              <button className="btn btn-ghost" onClick={() => lyricInputRef.current?.click()}>Import lyrics</button>
              <button className="btn btn-ghost" onClick={() => projectInputRef.current?.click()}>Open project</button>
            </div>
            {media.error ? (
              <div className="ed-banner" data-kind="error" style={{ textAlign: 'left', maxWidth: 460 }}>
                <h3>{media.error.title}</h3>
                <p>{media.error.detail}</p>
                <div className="ed-banner-actions">
                  {media.error.recovery.map((route) => (
                    <button
                      key={route}
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        if (route === 'try-different-file') audioInputRef.current?.click();
                        else if (route === 'manual-tap-sync') store.startTapSync();
                        else if (route === 'retry') store.setMedia({ error: null });
                        else if (route === 'remove-project') void (async () => { setShowProjects(true); setProjects(await listProjects()); })();
                        else if (route === 'documentation') window.location.assign('/support');
                      }}
                    >
                      {RECOVERY_LABELS[route]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Preview />
        )}
        {project.audio ? <Timeline /> : null}
      </main>

      {/* ---------------- panel ---------------- */}
      <aside className="ed-panel" aria-label="Inspector">
        <div className="ed-tabs" role="tablist">
          {(['lyrics', 'design', 'export'] as const).map((tab) => (
            <button key={tab} className="ed-tab" role="tab" aria-selected={panel === tab} onClick={() => store.setPanel(tab)}>
              {tab}
            </button>
          ))}
          <button className="ed-tab" style={{ flex: 'none', paddingInline: 10 }} onClick={() => setPanelOpen(false)} aria-label="Close panel">✕</button>
        </div>
        <div className="ed-panel-body">
          {panel === 'lyrics' ? <LyricsPanel /> : null}
          {panel === 'design' ? <DesignPanel /> : null}
          {panel === 'export' ? <ExportPanel /> : null}
        </div>
      </aside>

      {/* ---------------- transport ---------------- */}
      <footer className="ed-transport">
        <button className="ed-transport-btn" onClick={() => seekTo(0)} title="Go to start" aria-label="Go to start">⏮</button>
        <button className="ed-transport-btn" data-primary="true" onClick={() => void togglePlayback()} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="ed-time mono">
          {formatTimecode(playheadUs, true, project.export.fps)} <small>/ {formatTimecode(project.audio?.durationUs ?? 0)}</small>
        </span>
        <input
          className="ed-scrub"
          type="range"
          min={0}
          max={Math.max(1, project.audio?.durationUs ?? 1)}
          step={1000}
          value={Math.min(playheadUs, project.audio?.durationUs ?? 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Scrub playhead"
        />
        <span className="ed-transport-spacer" />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          {media.state === 'READY' ? 'Audio ready' : media.state}
        </span>
        {busy ? (
          <button className="btn btn-sm btn-ghost" onClick={() => cancelExport()}>Cancel render</button>
        ) : null}
      </footer>

      {/* ---------------- tap-sync ---------------- */}
      {tapActive ? (
        <div className="ed-tap" role="region" aria-label="Tap-sync">
          <div className="ed-tap-head">
            <div>
              <strong>Tap-sync</strong>{' '}
              <span className="ed-hint">
                Press <span className="ed-tap-key">T</span> at the start of each line while the track plays.
                {tap.taps.length} of {project.lyrics.lines.length} marked.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => void togglePlayback()}>{playing ? 'Pause' : 'Play'}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => store.tapUndo()} disabled={tap.taps.length === 0}>Undo tap (Z)</button>
              <button className="btn btn-sm btn-ghost" onClick={() => store.tapReset()}>Reset</button>
              <button className="btn btn-sm btn-primary" onClick={() => store.applyTapTimings()} disabled={tap.taps.length === 0}>Apply timings</button>
              <button className="btn btn-sm btn-ghost" onClick={() => store.stopTapSync()}>Close</button>
            </div>
          </div>
          <div className="ed-tap-progress">
            <i style={{ width: `${Math.round(tapProgress(tap, project.lyrics.lines.length) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {/* ---------------- toasts ---------------- */}
      <div className="ed-toasts" role="status" aria-live="polite">
        {notices.map((notice) => (
          <div key={notice.id} className="ed-toast" data-kind={notice.kind}>
            <strong>{notice.title}</strong>
            {notice.detail ? <p>{notice.detail}</p> : null}
            <button className="ed-icon-btn" style={{ justifySelf: 'end' }} onClick={() => store.dismissNotice(notice.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>

      {/* ---------------- shortcuts ---------------- */}
      {showShortcuts ? (
        <div className="ed-modal-backdrop" onClick={() => setShowShortcuts(false)}>
          <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <p className="ed-hint">A full sync can be completed without touching the mouse. Shortcuts are ignored while a text field has focus, so editing lyrics is safe.</p>
            <table className="compare">
              <tbody>
                {SHORTCUTS.map(([key, description]) => (
                  <tr key={key}>
                    <td><span className="ed-tap-key">{key}</span></td>
                    <td>{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowShortcuts(false)}>Close</button>
          </div>
        </div>
      ) : null}

      {/* ---------------- projects ---------------- */}
      {showProjects ? (
        <div className="ed-modal-backdrop" onClick={() => setShowProjects(false)}>
          <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Projects" onClick={(e) => e.stopPropagation()}>
            <h2>Projects</h2>
            <p className="ed-hint">Stored in this browser. Nothing is uploaded. Export a project file to keep a copy elsewhere.</p>
            <div style={{ display: 'grid', gap: 6, maxHeight: '40svh', overflowY: 'auto' }}>
              {projects.length === 0 ? <p className="ed-hint">No saved projects yet.</p> : null}
              {projects.map((p) => (
                <div key={p.id} className="ed-row" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 4 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</strong>
                    <span className="ed-hint">
                      {p.lineCount} lines · {p.hasAudio ? 'audio linked' : 'no audio'} · {new Date(p.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-ghost" onClick={async () => { await loadStoredProject(p.id); setShowProjects(false); }}>Open</button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={async () => {
                        await deleteProject(p.id);
                        await garbageCollectAssets();
                        setProjects(await listProjects());
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => { store.newProject(); setShowProjects(false); }}>New project</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowProjects(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {dragOver ? (
        <div className="ed-modal-backdrop" style={{ pointerEvents: 'none' }}>
          <div className="ed-modal" style={{ textAlign: 'center', pointerEvents: 'none' }}>
            <h2>Drop to import</h2>
            <p className="ed-hint">Audio files are decoded locally. Lyric files are parsed, never uploaded.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Keep the export button honest: never offer a render that cannot succeed. */
function hasExportBlockers(project: ReturnType<typeof useEditor.getState>['project']): boolean {
  return project.lyrics.lines.length === 0 || !project.audio;
}

