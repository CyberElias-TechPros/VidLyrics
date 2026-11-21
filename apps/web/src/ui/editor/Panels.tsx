import { matchTranscript } from '../../core/timing/transcriptMatch';
import { StyleLibrary } from './StyleLibrary';
import { SceneDirector, TimingReview } from './ProductionTools';
import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/store';
import type { Line, SceneLayout, SceneTransition, VoiceoverMode } from '../../core/types';
import { isVideoSpecJson } from '../../core/spec/schema';
import { readProjectVoicePrefs } from '../../core/spec/compiler';
import type { ScriptSplitMode } from '../../core/lyrics/script';
import { THEMES, ASPECTS, EXPORT_PRESETS, getExportPreset, exportSettingsFromPreset, validateExportSettings, estimateOutputBytes, estimateRender, formatBytes, getTheme } from '../../core/design/tokens';
import { SUBTITLE_FORMATS } from '../../core/export/subtitles';
import { formatClock, formatTimecode, usToSeconds } from '../../core/time';
import { detectInstrumentalRegions } from '../../core/timing/postprocess';
import {
  importVideoSpecText, timelineDurationUs, exportSubtitle, exportProjectFile, exportVideoSpecFile, importImageAsset,
  transcribeAudio, cancelTranscription, applyGeneratedTranscript, dismissGeneratedTranscript,
  generateVoiceover, cancelVoiceoverGeneration, downloadGeneratedVoiceover, removeGeneratedVoiceover,
  isVoiceoverCurrent, seekTo
} from '../../media/session';
import { PIPER_VOICES, bundledVoice, DEFAULT_VOICE_B } from '../../core/audio/voices';

/* ------------------------------ Lyrics ------------------------------ */

const TRANSCRIPTION_LANGUAGES = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['yo', 'Yoruba'], ['ig', 'Igbo'], ['ha', 'Hausa'],
  ['fr', 'French'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['de', 'German'],
  ['it', 'Italian'], ['sw', 'Swahili'], ['zh', 'Chinese']
] as const;

function isGenerationBusy(state: string): boolean {
  return ['PREPARING', 'DOWNLOADING', 'LOADING', 'RUNNING', 'SAVING'].includes(state);
}

const SCENE_LAYOUTS: { id: SceneLayout; label: string }[] = [
  { id: 'caption', label: 'Caption / Lyric' },
  { id: 'title', label: 'Title card' },
  { id: 'stat', label: 'Hero stat' },
  { id: 'bullets', label: 'Bullet list' },
  { id: 'quote', label: 'Pull quote' },
  { id: 'code', label: 'Code window' },
  { id: 'chart', label: 'Bar chart' }
];

const SCENE_TRANSITIONS: SceneTransition[] = ['fade', 'slide', 'wipe', 'zoom', 'none'];

export function LyricsPanel() {
  const lines = useEditor((s) => s.project.lyrics.lines);
  const sections = useEditor((s) => s.project.sections);
  const playheadUs = useEditor((s) => s.playheadUs);
  const selectedIds = useEditor((s) => s.selectedIds);
  const showHeat = useEditor((s) => s.showHeat);
  const store = useEditor();
  const [query, setQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(lines.length === 0);
  const [composeMode, setComposeMode] = useState<'lyrics' | 'script'>(() =>
    store.project.audio ? 'lyrics' : 'script'
  );
  const [splitMode, setSplitMode] = useState<ScriptSplitMode>('sentences');
  const [scriptWpm, setScriptWpm] = useState(155);
  const [draft, setDraft] = useState('');
  const isSpec = useMemo(() => isVideoSpecJson(draft), [draft]);
  const [whisperModel, setWhisperModel] = useState<'tiny' | 'base'>('tiny');
  const [centre, setCentre] = useState(false);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('auto');
  const [voiceChoice, setVoiceChoice] = useState<string | null>(null);
  const [voiceChoiceB, setVoiceChoiceB] = useState<string | null>(null);
  const [voiceModeChoice, setVoiceModeChoice] = useState<VoiceoverMode | null>(null);
  const [pauseChoice, setPauseMs] = useState<number | null>(null);
  const voicePrefs = useMemo(() => readProjectVoicePrefs(store.project), [store.project]);
  const pauseMs = pauseChoice ?? voicePrefs?.pauseMs ?? 300;
  const [sceneEditorOpen, setSceneEditorOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sceneImageInputRef = useRef<HTMLInputElement | null>(null);
  const transcription = store.transcription;
  const voiceoverJob = store.voiceoverJob;
  const voiceoverMeta = store.project.voiceover;
  const timingMatches = useMemo(() => transcription.result ? matchTranscript(lines, transcription.result.cues) : null, [lines, transcription.result]);
  const hasAudioTrack = Boolean(store.project.audio);
  const hasSpeakerB = useMemo(() => lines.some((l) => l.speaker === 'B'), [lines]);
  const selectedVoiceId = bundledVoice(voiceChoice ?? voicePrefs?.voiceId ?? voiceoverMeta?.voiceId);
  const selectedVoiceIdB = bundledVoice(voiceChoiceB ?? voicePrefs?.voiceIdB ?? voiceoverMeta?.voiceIdB, DEFAULT_VOICE_B);
  const effectiveVoiceMode: VoiceoverMode =
    voiceModeChoice ?? voiceoverMeta?.mode ?? (hasAudioTrack ? 'timed' : 'sequential');
  const transcriptionBusy = isGenerationBusy(transcription.state);
  const voiceoverBusy = isGenerationBusy(voiceoverJob.state);
  const voiceoverFresh = isVoiceoverCurrent(store.project);
  const voiceoverAvailable = !!voiceoverMeta && voiceoverFresh && voiceoverJob.available;
  const selectedLine: Line | null = useMemo(
    () => lines.find((l) => l.id === selectedIds[0]) ?? null,
    [lines, selectedIds]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(({ text, scene }) => [text, scene?.kicker, scene?.subtext, scene?.narration, scene?.value,
      ...(scene?.items ?? []), ...(scene?.chart ?? []).map(bar => bar.label)
    ].some(field => field?.toLowerCase().includes(q)));
  }, [lines, query]);

  const bodyTimeUs = playheadUs - (store.project.design.intro.enabled ? store.project.design.intro.durationUs : 0) - store.project.export.globalOffsetUs;
  const currentIndex = useMemo(() => {
    let found = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (l && bodyTimeUs >= l.start && bodyTimeUs <= l.end) found = i;
    }
    return found;
  }, [lines, bodyTimeUs]);

  function applyDraft(narrate: boolean) {
    if (isSpec) {
      if (!importVideoSpecText(draft, 'Import video spec', narrate)) return;
      setVoiceChoice(null);
      setVoiceChoiceB(null);
      setPauseMs(null);
    } else if (composeMode === 'script') {
      if (!store.setScenesFromScript(draft, { mode: splitMode, wordsPerMinute: scriptWpm, pauseMs })) {
        store.notify({ kind: 'warning', title: 'No readable scenes found', detail: 'Add some script text and try again.' });
        return;
      }
      if (narrate) void generateVoiceover(selectedVoiceId, { mode: 'sequential', pauseMs, voiceIdB: selectedVoiceIdB });
    } else {
      if (!store.setLyricsFromText(draft, 'user')) return;
    }
    setDraft('');
    setPasteOpen(false);
  }

  return (
    <>
      <div className="ed-panel-section">
        <div className="ed-row">
          <span className="ed-panel-label">Script &amp; lyrics</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {lines.length} {lines.length === 1 ? 'scene' : 'scenes'}
          </span>
        </div>
        <input
          className="ed-input"
          placeholder="Search scenes or lyrics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search lyrics"
        />
        <div className="ed-row">
          <button className="btn btn-sm btn-ghost" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
            {pasteOpen ? 'Hide composer' : 'Paste script / lyrics'}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => store.generateTimings()}
            disabled={lines.length === 0}
            title="Estimate timings from reading weight or song length"
          >
            Auto-timing
          </button>
        </div>
      </div>

      {pasteOpen ? (
        <div className="ed-panel-section">
          <div className="ed-seg" role="group" aria-label="Composer mode">
            <button
              type="button"
              className="ed-seg-btn"
              aria-pressed={composeMode === 'script'}
              onClick={() => setComposeMode('script')}
            >
              Script → Scenes
            </button>
            <button
              type="button"
              className="ed-seg-btn"
              aria-pressed={composeMode === 'lyrics'}
              onClick={() => setComposeMode('lyrics')}
            >
              Song Lyrics
            </button>
          </div>
          <label className="ed-panel-label" htmlFor="lyric-paste">
            {composeMode === 'script' ? 'Paste a video script (no audio required)' : 'Paste lyrics or subtitle text'}
          </label>
          <textarea
            id="lyric-paste"
            className="ed-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              composeMode === 'script'
                ? '# Video Title\nOptional subtitle\n\nEach sentence becomes its own timed scene. Supports - bullet lists, > quotes, ```code``` fences, [Stat: 10x] callouts, and A: / B: dialogue.'
                : 'One line per lyric.\nStructural tags like [Chorus] are read as sections.'
            }
          />
          {!isSpec && composeMode === 'script' ? (
            <div className="ed-generation-controls">
              <label className="ed-field">
                <span className="ed-hint">Split by</span>
                <select
                  className="ed-select"
                  value={splitMode}
                  onChange={(e) => setSplitMode(e.target.value as ScriptSplitMode)}
                >
                  <option value="sentences">Sentences</option>
                  <option value="lines">Lines</option>
                  <option value="paragraphs">Paragraphs</option>
                </select>
              </label>
              <label className="ed-field">
                <span className="ed-hint">Pace (WPM)</span>
                <input
                  className="ed-input"
                  type="number"
                  min={80}
                  max={280}
                  step={5}
                  value={scriptWpm}
                  onChange={(e) => setScriptWpm(Number(e.target.value) || 155)}
                />
              </label>
            </div>
          ) : null}
          <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => applyDraft(false)}
              disabled={draft.trim().length === 0}
            >
              {isSpec ? 'Apply video spec' : composeMode === 'script' ? 'Build scenes' : 'Use these lyrics'}
            </button>
            {isSpec || composeMode === 'script' ? (
              <button className="btn btn-sm btn-ghost" onClick={() => applyDraft(true)}
                disabled={!draft.trim() || voiceoverBusy || transcriptionBusy}>
                {isSpec ? 'Apply & narrate' : 'Build & narrate'}
              </button>
            ) : null}
            <span className="ed-hint">
              {isSpec ? 'Video spec detected. Replaces current scenes; undo with Ctrl/⌘ + Z. Narration is spoken, not displayed.' : composeMode === 'script'
                ? 'Ready to preview, sync local TTS, or export MP4.'
                : 'Undoable with Ctrl/⌘ + Z.'}
            </span>
          </div>
        </div>
      ) : null}

      <TimingReview />
      <div className="ed-panel-section ed-generation-section">
        <span className="ed-panel-label">Generate subtitles from audio</span>
        <p className="ed-hint">Whisper models ship with this app release. First use caches the selected model locally; audio stays in this browser and is never uploaded.</p>
        <div className="ed-generation-controls">
          <label className="ed-field">
            <span className="ed-hint">Model</span>
            <select className="ed-select" value={whisperModel} onChange={(event) => setWhisperModel(event.target.value as 'tiny' | 'base')}>
              <option value="tiny">Tiny · faster, smaller download</option>
              <option value="base">Base · larger, often more accurate</option>
            </select>
          </label>
          <label className="ed-field">
            <span className="ed-hint">Language</span>
            <select className="ed-select" value={transcriptionLanguage} onChange={(event) => setTranscriptionLanguage(event.target.value)}>
              {TRANSCRIPTION_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {store.project.audio?.channels === 2 && <label className="ed-check-row"><input type="checkbox" checked={centre} onChange={e => setCentre(e.target.checked)} />Focus on centred vocals for transcription (does not modify the soundtrack)</label>}
        {hasAudioTrack && !lines.length && <button className="btn btn-sm btn-primary" disabled={store.audioMissing || transcriptionBusy || voiceoverBusy}
          onClick={() => void transcribeAudio(whisperModel, transcriptionLanguage, { centre, draft:true })}>Create lyric video draft</button>}
        <div className="ed-banner-actions">
          <button
            className="btn btn-sm btn-primary"
            disabled={!store.project.audio || store.audioMissing || transcriptionBusy || voiceoverBusy}
            onClick={() => void transcribeAudio(whisperModel, transcriptionLanguage, { centre })}
          >
            {transcriptionBusy ? 'Transcribing…' : 'Transcribe audio'}
          </button>
          {transcriptionBusy ? <button className="btn btn-sm btn-ghost" onClick={cancelTranscription}>Cancel</button> : null}
        </div>
        {!store.project.audio ? <p className="ed-hint">Import a song first to generate timed subtitles.</p> : null}
        {transcriptionBusy ? (
          <div className="ed-job-status" role="status" aria-live="polite">
            <div className="ed-row"><span>{transcription.message || 'Preparing transcription…'}</span><span>{Math.round(transcription.progress * 100)}%</span></div>
            <div className="ed-progress"><i style={{ width: `${Math.max(0, Math.min(100, transcription.progress * 100))}%` }} /></div>
          </div>
        ) : null}
        {transcription.error ? <p className="ed-generation-error" role="alert">{transcription.error}</p> : null}
        {transcription.state === 'CANCELLED' ? <p className="ed-hint" role="status">{transcription.message}</p> : null}
        {transcription.result ? (
          <div className="ed-banner" data-kind="success">
            <h3>Transcript ready · {transcription.result.cues.length} cues</h3>
            <p>Replace lyrics with these cues, or keep your words and match estimated lines to recognized phrases. Matched word times are estimates. Confirmed timings are preserved in keep mode.</p>
            <div className="ed-generated-lines">
              {transcription.result.cues.slice(0, 5).map((cue, index) => (
                <div className="ed-generated-line" key={`${cue.startUs}-${index}`}>
                  <span className="mono">{formatTimecode(cue.startUs)}</span><span>{cue.text}</span>
                </div>
              ))}
              {transcription.result.cues.length > 5 ? <span className="ed-hint">…and {transcription.result.cues.length - 5} more cues</span> : null}
            </div>
            <div className="ed-banner-actions">
              <button className="btn btn-sm btn-primary" onClick={() => void applyGeneratedTranscript()}>
                {lines.length > 0 ? `Replace ${lines.length} lyric lines` : 'Use generated subtitles'}
              </button>
              {lines.length > 0 && timingMatches && <button className="btn btn-sm btn-ghost" disabled={!timingMatches.size} onClick={() => {
                store.commit('Match existing lyrics to transcript', p => ({ ...p, lyrics: { ...p.lyrics, lines: p.lyrics.lines.map(l => timingMatches.get(l.id) ?? l) } }));
                dismissGeneratedTranscript();
              }}>Keep lyrics · match {timingMatches.size} lines</button>}
              <button className="btn btn-sm btn-ghost" onClick={dismissGeneratedTranscript}>Discard transcript</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ed-panel-section ed-generation-section">
        <span className="ed-panel-label">Local TTS voiceover &amp; sync</span>
        <p className="ed-hint">
          Piper voices run locally in your browser. The creator lists <a href="https://brycebeattie.com/files/tts/" target="_blank" rel="noreferrer">Norman and LJSpeech as public-domain models</a>. In <strong>Auto-time scenes</strong> mode, each scene’s exact duration is set from its synthesized audio.
        </p>
        <label className="ed-field">
          <span className="ed-hint">{hasSpeakerB ? 'Voice A (default / Speaker A)' : 'Voice'}</span>
          <select className="ed-select" value={selectedVoiceId} onChange={(event) => setVoiceChoice(event.target.value)}>
            {PIPER_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
          </select>
        </label>
        {hasSpeakerB ? (
          <label className="ed-field">
            <span className="ed-hint">Voice B (Speaker B)</span>
            <select className="ed-select" value={selectedVoiceIdB} onChange={(event) => setVoiceChoiceB(event.target.value)}>
              {PIPER_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
            </select>
          </label>
        ) : null}
        <div className="ed-generation-controls">
          <label className="ed-field">
            <span className="ed-hint">Timing mode</span>
            <select
              className="ed-select"
              value={effectiveVoiceMode}
              onChange={(event) => setVoiceModeChoice(event.target.value as VoiceoverMode)}
            >
              <option value="sequential">Auto-time scenes to speech</option>
              <option value="timed">Speak at current cue times</option>
            </select>
          </label>
          {effectiveVoiceMode === 'sequential' ? (
            <label className="ed-field">
              <span className="ed-hint">Pause (ms)</span>
              <input
                className="ed-input"
                type="number"
                min={0}
                max={5000}
                step={50}
                value={pauseMs}
                onChange={(e) => setPauseMs(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))}
              />
            </label>
          ) : null}
        </div>
        <div className="ed-banner-actions">
          <button
            className="btn btn-sm btn-primary"
            disabled={lines.length === 0 || voiceoverBusy || transcriptionBusy}
            onClick={() =>
              void generateVoiceover(selectedVoiceId, {
                mode: effectiveVoiceMode,
                pauseMs,
                voiceIdB: hasSpeakerB ? selectedVoiceIdB : null
              })
            }
          >
            {voiceoverBusy
              ? 'Generating speech…'
              : effectiveVoiceMode === 'sequential'
                ? 'Generate & sync speech'
                : voiceoverMeta
                  ? 'Regenerate voiceover'
                  : 'Generate voiceover'}
          </button>
          {voiceoverBusy ? <button className="btn btn-sm btn-ghost" onClick={cancelVoiceoverGeneration}>Cancel</button> : null}
        </div>
        {voiceoverBusy ? (
          <div className="ed-job-status" role="status" aria-live="polite">
            <div className="ed-row"><span>{voiceoverJob.message || 'Preparing speech…'}</span><span>{Math.round(voiceoverJob.progress * 100)}%</span></div>
            <div className="ed-progress"><i style={{ width: `${Math.max(0, Math.min(100, voiceoverJob.progress * 100))}%` }} /></div>
          </div>
        ) : null}
        {voiceoverJob.error ? <p className="ed-generation-error" role="alert">{voiceoverJob.error}</p> : null}
        {voiceoverJob.state === 'CANCELLED' ? <p className="ed-hint" role="status">{voiceoverJob.message}</p> : null}
        {voiceoverMeta ? (
          <div className="ed-voiceover-settings">
            <div className="ed-banner" data-kind={voiceoverAvailable ? 'success' : 'error'}>
              <h3>{!voiceoverFresh ? 'Voiceover needs updating' : voiceoverJob.available ? 'Voiceover ready' : 'Voiceover audio missing'}</h3>
              <p>{voiceoverFresh
                ? voiceoverJob.available
                  ? `Generated with ${voiceoverMeta.voiceId}${voiceoverMeta.voiceIdB ? ` + ${voiceoverMeta.voiceIdB}` : ''}. Spans ${voiceoverMeta.durationUs ? formatClock(voiceoverMeta.durationUs) : 'the timeline'}.`
                  : 'The voiceover audio is not in this browser. Reopen the project where it was generated or regenerate it.'
                : 'Scene text or timings changed since this voiceover was generated. Regenerate it before playback or export.'}</p>
            </div>
            <label className="ed-check-row">
              <input type="checkbox" checked={voiceoverMeta.enabled} disabled={!voiceoverAvailable} onChange={(event) => store.setVoiceoverMix({ enabled: event.target.checked })} />
              <span>Include voiceover in playback and video export</span>
            </label>
            {hasAudioTrack ? (
              <label className="ed-field">
                <span className="ed-row"><span className="ed-hint">Background track</span><span className="mono">{Math.round(voiceoverMeta.musicGain * 100)}%</span></span>
                <input className="ed-range" type="range" min="0" max="1.5" step="0.05" value={voiceoverMeta.musicGain} disabled={!voiceoverAvailable} onChange={(event) => store.setVoiceoverMix({ musicGain: Number(event.target.value) })} />
              </label>
            ) : null}
            <label className="ed-field">
              <span className="ed-row"><span className="ed-hint">Speech volume</span><span className="mono">{Math.round(voiceoverMeta.speechGain * 100)}%</span></span>
              <input className="ed-range" type="range" min="0" max="1.5" step="0.05" value={voiceoverMeta.speechGain} disabled={!voiceoverAvailable} onChange={(event) => store.setVoiceoverMix({ speechGain: Number(event.target.value) })} />
            </label>
            <div className="ed-banner-actions">
              <button className="btn btn-sm btn-ghost" disabled={!voiceoverJob.available} onClick={downloadGeneratedVoiceover}>Download WAV</button>
              <button className="btn btn-sm btn-ghost" onClick={() => void removeGeneratedVoiceover()}>Remove voiceover</button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedLine ? (
        <div className="ed-panel-section">
          <input
            ref={sceneImageInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = '';
              if (!file || !selectedLine) return;
              const asset = await importImageAsset(file);
              if (asset) {
                store.setLineScene(selectedLine.id, {
                  background: {
                    ...(selectedLine.scene?.background ?? {}),
                    kind: 'image',
                    assetId: asset.id,
                    motion: selectedLine.scene?.background?.motion ?? 0.25,
                    scrim: selectedLine.scene?.background?.scrim ?? 0.42
                  }
                });
                store.notify({ kind: 'success', title: 'Scene image attached', detail: asset.fileName });
              }
            }}
          />
          <div className="ed-row">
            <span className="ed-panel-label">Selected scene</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-expanded={sceneEditorOpen}
              onClick={() => setSceneEditorOpen((v) => !v)}
            >
              {sceneEditorOpen ? 'Collapse' : `Layout: ${selectedLine.scene?.layout ?? 'caption'}`}
            </button>
          </div>
          {sceneEditorOpen ? (
            <div className="ed-field">
              <div className="ed-generation-controls">
                <label className="ed-field">
                  <span className="ed-hint">Layout</span>
                  <select
                    className="ed-select"
                    value={selectedLine.scene?.layout ?? 'caption'}
                    onChange={(e) => store.setLineScene(selectedLine.id, { layout: e.target.value as SceneLayout })}
                    aria-label="Scene layout"
                  >
                    {SCENE_LAYOUTS.map((l) => (
                      <option key={l.id} value={l.id}>{l.label}</option>
                    ))}
                  </select>
                </label>
                <label className="ed-field">
                  <span className="ed-hint">Speaker</span>
                  <select
                    className="ed-select"
                    value={selectedLine.speaker ?? ''}
                    onChange={(e) => store.setLineSpeaker(selectedLine.id, (e.target.value || null) as 'A' | 'B' | null)}
                    aria-label="Scene speaker"
                  >
                    <option value="">Default (A)</option>
                    <option value="A">Speaker A</option>
                    <option value="B">Speaker B</option>
                  </select>
                </label>
              </div>
              <div className="ed-generation-controls">
                <label className="ed-field">
                  <span className="ed-hint">Transition</span>
                  <select
                    className="ed-select"
                    value={selectedLine.scene?.transition ?? 'fade'}
                    onChange={(e) => store.setLineScene(selectedLine.id, { transition: e.target.value as SceneTransition })}
                    aria-label="Scene transition"
                  >
                    {SCENE_TRANSITIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="ed-field">
                  <span className="ed-hint">Kicker / file</span>
                  <input
                    className="ed-input"
                    value={selectedLine.scene?.kicker ?? ''}
                    placeholder="e.g. STEP 01"
                    onChange={(e) => store.setLineScene(selectedLine.id, { kicker: e.target.value })}
                  />
                </label>
              </div>
              {selectedLine.scene?.layout === 'stat' ? (
                <label className="ed-field">
                  <span className="ed-hint">Hero stat value</span>
                  <input
                    className="ed-input"
                    value={selectedLine.scene?.value ?? ''}
                    placeholder="e.g. 100%, $0, 10x"
                    onChange={(e) => store.setLineScene(selectedLine.id, { value: e.target.value })}
                  />
                </label>
              ) : null}
              {selectedLine.scene?.layout === 'bullets' || selectedLine.scene?.layout === 'code' ? (
                <label className="ed-field">
                  <span className="ed-hint">
                    {selectedLine.scene?.layout === 'code' ? 'Code lines (one per line)' : 'Bullet items (one per line)'}
                  </span>
                  <textarea
                    className="ed-textarea mono"
                    style={{ minHeight: 88, fontSize: '0.75rem' }}
                    value={(selectedLine.scene?.items ?? []).join('\n')}
                    onChange={(e) =>
                      store.setLineScene(selectedLine.id, {
                        items: e.target.value.split('\n').filter((l) => (selectedLine.scene?.layout === 'code' ? true : l.trim().length > 0))
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="ed-field">
                <span className="ed-hint">Subtext / attribution</span>
                <input
                  className="ed-input"
                  value={selectedLine.scene?.subtext ?? ''}
                  placeholder="Optional caption below headline"
                  onChange={(e) => store.setLineScene(selectedLine.id, { subtext: e.target.value })}
                />
              </label>
              <label className="ed-field">
                <span className="ed-hint">Narration (spoken, not shown)</span>
                <textarea className="ed-textarea" maxLength={4000}
                  value={selectedLine.scene?.narration ?? ''}
                  placeholder="Optional voiceover script. Leave blank to speak the scene copy."
                  onChange={e => store.setLineScene(selectedLine.id, { narration: e.target.value || undefined })}
                />
              </label>
              <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => sceneImageInputRef.current?.click()}>
                  {selectedLine.scene?.background?.kind === 'image' ? 'Replace scene image' : 'Set scene image'}
                </button>
                {selectedLine.scene?.background?.assetId ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => store.setLineScene(selectedLine.id, { background: undefined })}
                  >
                    Clear image
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="ed-banner">
          <h3>No scenes or lyrics yet</h3>
          <p>Paste a script above, load a starter template in the <strong>Code</strong> tab, or import an audio/subtitle file.</p>
        </div>
      ) : null}

      <div className="ed-lines" ref={listRef}>
        {filtered.map((line) => {
          const conf =
            line.words.length === 0
              ? line.source === 'human' || line.source === 'tap' || line.source === 'tts'
                ? 'high'
                : 'low'
              : Math.min(...line.words.map((w) => w.confidence)) > 0.7
                ? 'high'
                : Math.min(...line.words.map((w) => w.confidence)) > 0.35
                  ? 'mid'
                  : 'low';
          const section = sections.find((s) => s.id === line.sectionId);
          const metaTags = [
            line.scene?.layout && line.scene.layout !== 'caption' ? line.scene.layout : null,
            line.speaker ? `voice ${line.speaker}` : null,
            section ? section.label : null
          ].filter(Boolean);
          return (
            <div
              key={line.id}
              className="ed-line"
              data-selected={selectedIds.includes(line.id) ? 'true' : 'false'}
              data-current={lines[currentIndex]?.id === line.id ? 'true' : 'false'}
            >
              <button
                type="button"
                className="ed-line-time ed-line-time-btn"
                title="Jump playhead to scene"
                onClick={() => {
                  store.setSelection([line.id]);
                  const introUs = store.project.design.intro.enabled ? store.project.design.intro.durationUs : 0;
                  seekTo(introUs + store.project.export.globalOffsetUs + line.start + Math.min(350_000, Math.round((line.end - line.start) * 0.25)));
                }}
              >
                {showHeat ? <i className="ed-conf-dot" data-conf={conf} style={{ display: 'inline-block', marginRight: 4 }} /> : null}
                {formatClock(line.start)}
              </button>
              <input
                className="ed-line-text"
                value={line.text}
                onChange={(e) => store.updateLineText(line.id, e.target.value)}
                onFocus={() => store.setSelection([line.id])}
                aria-label={`Scene starting at ${formatClock(line.start)}`}
              />
              <span className="ed-line-tools">
                <button
                  className="ed-icon-btn"
                  title="Lock timing"
                  aria-label={line.locked ? 'Unlock timing' : 'Lock timing'}
                  data-active={line.locked ? 'true' : 'false'}
                  onClick={() => store.setLineLock(line.id, !line.locked)}
                >
                  {line.locked ? '🔒' : '🔓'}
                </button>
                <button className="ed-icon-btn" title="Split at midpoint" aria-label="Split line" onClick={() => store.splitLineAt(line.id, Math.max(1, Math.ceil(line.words.length / 2)))}>
                  ✂
                </button>
                <button className="ed-icon-btn" title="Duplicate" aria-label="Duplicate line" onClick={() => store.duplicateLines([line.id])}>
                  ⧉
                </button>
                <button className="ed-icon-btn" title="Delete" aria-label="Delete line" onClick={() => store.deleteLines([line.id])}>
                  ✕
                </button>
              </span>
              {metaTags.length > 0 ? (
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', gridColumn: '2 / 3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {metaTags.join(' · ')}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------ Design ------------------------------ */

export function DesignPanel() {
  const design = useEditor((s) => s.project.design);
  const store = useEditor();
  const theme = getTheme(design.themeId);
  const bgImageInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <SceneDirector />
      <StyleLibrary />
      <div className="ed-panel-section">
        <span className="ed-panel-label">Theme</span>
        <div className="ed-themes">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="ed-theme"
              aria-pressed={design.themeId === t.id}
              title={t.blurb}
              onClick={() => store.setTheme(t.id)}
            >
              <span className="ed-theme-swatch" style={{ background: t.background.colors[0] }}>
                {t.swatches.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span className="ed-theme-name">{t.name}</span>
            </button>
          ))}
        </div>
        <p className="ed-hint">{theme.blurb}</p>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Aspect ratio</span>
        <div className="ed-aspects">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              className="ed-aspect"
              aria-pressed={design.aspectId === a.id}
              onClick={() => {
                store.setAspect(a.id);
                store.setExport(exportSettingsFromPreset(store.project.export.presetId === 'custom' ? 'custom' : EXPORT_PRESETS.find((p) => p.aspectId === a.id)?.id ?? 'custom', timelineDurationUs()));
              }}
            >
              <i style={{ width: Math.round((a.width / a.height) * 24), height: 24 }} />
              <span>{a.id}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Karaoke</span>
        <div className="ed-field">
          <select
            className="ed-select"
            value={design.karaoke.mode}
            onChange={(e) => store.setDesign({ karaoke: { ...design.karaoke, mode: e.target.value as typeof design.karaoke.mode } })}
            aria-label="Karaoke mode"
          >
            <option value="progressive">Progressive fill (per word)</option>
            <option value="word">Word highlight</option>
            <option value="line">Whole line highlight</option>
            <option value="none">No highlight</option>
          </select>
          <label className="ed-row">
            <span className="ed-hint">Glow</span>
            <input className="ed-range" type="range" min={0} max={2} step={0.05} value={design.karaoke.glow} onChange={(e) => store.setDesign({ karaoke: { ...design.karaoke, glow: Number(e.target.value) } })} />
          </label>
          <label className="ed-row">
            <span className="ed-hint">Word scale</span>
            <input className="ed-range" type="range" min={1} max={1.2} step={0.01} value={design.karaoke.scale} onChange={(e) => store.setDesign({ karaoke: { ...design.karaoke, scale: Number(e.target.value) } })} />
          </label>
          <label className="ed-row">
            <span className="ed-hint">Beat-aware emphasis</span>
            <input type="checkbox" checked={design.karaoke.beatAware} onChange={(e) => store.setDesign({ karaoke: { ...design.karaoke, beatAware: e.target.checked } })} />
          </label>
        </div>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Type</span>
        <label className="ed-row">
          <span className="ed-hint">Size</span>
          <input className="ed-range" type="range" min={0.02} max={0.14} step={0.002} value={design.typography.sizeRatio} onChange={(e) => store.setDesign({ typography: { ...design.typography, sizeRatio: Number(e.target.value) } })} />
        </label>
        <label className="ed-row">
          <span className="ed-hint">Weight</span>
          <input className="ed-range" type="range" min={300} max={900} step={100} value={design.typography.weight} onChange={(e) => store.setDesign({ typography: { ...design.typography, weight: Number(e.target.value) } })} />
        </label>
        <label className="ed-row">
          <span className="ed-hint">Uppercase</span>
          <input type="checkbox" checked={design.typography.uppercase} onChange={(e) => store.setDesign({ typography: { ...design.typography, uppercase: e.target.checked } })} />
        </label>
        <div className="ed-row">
          <label className="ed-hint" htmlFor="col-inactive">Idle</label>
          <input id="col-inactive" type="color" value={design.typography.color} onChange={(e) => store.setDesign({ typography: { ...design.typography, color: e.target.value } })} />
          <label className="ed-hint" htmlFor="col-active">Sung</label>
          <input id="col-active" type="color" value={design.typography.activeColor} onChange={(e) => store.setDesign({ typography: { ...design.typography, activeColor: e.target.value } })} />
        </div>
        <div className="ed-field">
          <span className="ed-panel-label">Anchor</span>
          <div className="ed-row">
            {(['top', 'center', 'bottom'] as const).map((anchor) => (
              <button key={anchor} className="btn btn-sm btn-ghost" aria-pressed={design.typography.anchor === anchor} onClick={() => store.setDesign({ typography: { ...design.typography, anchor } })}>
                {anchor}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Background</span>
        <input
          ref={bgImageInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = '';
            if (!file) return;
            const asset = await importImageAsset(file);
            if (asset) {
              store.setDesign({
                background: { ...design.background, kind: 'image', assetId: asset.id, scrim: Math.max(0.3, design.background.scrim) }
              });
              store.notify({ kind: 'success', title: 'Background image set', detail: asset.fileName });
            }
          }}
        />
        <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => bgImageInputRef.current?.click()}>
            {design.background.kind === 'image' && design.background.assetId ? 'Replace image' : 'Choose image'}
          </button>
          {design.background.kind === 'image' ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => store.setDesign({ background: { ...theme.background } })}
            >
              Reset to theme
            </button>
          ) : null}
        </div>
        <label className="ed-row">
          <span className="ed-hint">Drift / Ken Burns</span>
          <input className="ed-range" type="range" min={0} max={1} step={0.02} value={design.background.motion} onChange={(e) => store.setDesign({ background: { ...design.background, motion: Number(e.target.value) } })} />
        </label>
        <label className="ed-row">
          <span className="ed-hint">Scrim (readability)</span>
          <input className="ed-range" type="range" min={0} max={0.9} step={0.02} value={design.background.scrim} onChange={(e) => store.setDesign({ background: { ...design.background, scrim: Number(e.target.value) } })} />
        </label>
        <label className="ed-row">
          <span className="ed-hint">Visualizer</span>
          <input className="ed-range" type="range" min={0} max={2} step={0.05} value={design.background.visualizerGain} onChange={(e) => store.setDesign({ background: { ...design.background, visualizerGain: Number(e.target.value) } })} />
        </label>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Motion</span>
        <div className="ed-field">
          <select className="ed-select" value={design.motion.enter} onChange={(e) => store.setDesign({ motion: { ...design.motion, enter: e.target.value as typeof design.motion.enter } })} aria-label="Entrance">
            {['spring', 'rise', 'fade', 'zoom', 'clip', 'blur', 'wordCascade', 'none'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select className="ed-select" value={design.motion.exit} onChange={(e) => store.setDesign({ motion: { ...design.motion, exit: e.target.value as typeof design.motion.exit } })} aria-label="Exit">
            {['fade', 'sink', 'blur', 'none'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Intro / outro cards</span>
        <label className="ed-row">
          <span className="ed-hint">Intro card</span>
          <input type="checkbox" checked={design.intro.enabled} onChange={(e) => store.setDesign({ intro: { ...design.intro, enabled: e.target.checked } })} />
        </label>
        {design.intro.enabled ? (
          <>
            <input className="ed-input" value={design.intro.title} placeholder="Intro title" onChange={(e) => store.setDesign({ intro: { ...design.intro, title: e.target.value } })} aria-label="Intro title" />
            <input className="ed-input" value={design.intro.subtitle} placeholder="Intro subtitle" onChange={(e) => store.setDesign({ intro: { ...design.intro, subtitle: e.target.value } })} aria-label="Intro subtitle" />
          </>
        ) : null}
        <label className="ed-row">
          <span className="ed-hint">Outro card</span>
          <input type="checkbox" checked={design.outro.enabled} onChange={(e) => store.setDesign({ outro: { ...design.outro, enabled: e.target.checked } })} />
        </label>
        {design.outro.enabled ? (
          <>
            <input className="ed-input" value={design.outro.title} placeholder="Outro title" onChange={(e) => store.setDesign({ outro: { ...design.outro, title: e.target.value } })} aria-label="Outro title" />
            <input className="ed-input" value={design.outro.subtitle} placeholder="Outro subtitle" onChange={(e) => store.setDesign({ outro: { ...design.outro, subtitle: e.target.value } })} aria-label="Outro subtitle" />
          </>
        ) : null}
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Watermark</span>
        <label className="ed-row">
          <span className="ed-hint">Enabled</span>
          <input type="checkbox" checked={design.brand.enabled} onChange={(e) => store.setDesign({ brand: { ...design.brand, enabled: e.target.checked } })} />
        </label>
        {design.brand.enabled ? (
          <>
            <input className="ed-input" value={design.brand.text} placeholder="Channel or artist name" onChange={(e) => store.setDesign({ brand: { ...design.brand, text: e.target.value } })} aria-label="Watermark text" />
            <select className="ed-select" value={design.brand.position} onChange={(e) => store.setDesign({ brand: { ...design.brand, position: e.target.value as typeof design.brand.position } })} aria-label="Watermark position">
              {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------ Export ------------------------------ */

export function ExportPanel() {
  const project = useEditor((s) => s.project);
  const render = useEditor((s) => s.render);
  const store = useEditor();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effectiveDuration = timelineDurationUs();
  const effectiveExport = useMemo(
    () => ({
      ...project.export,
      rangeEndUs: project.export.rangeEndUs > project.export.rangeStartUs ? project.export.rangeEndUs : effectiveDuration
    }),
    [project.export, effectiveDuration]
  );
  const errors = validateExportSettings(effectiveExport);
  const bytes = estimateOutputBytes(effectiveExport);
  const plan = estimateRender(effectiveExport);
  const audioModeLabel = !project.export.includeAudio
    ? 'Muted'
    : project.audio && project.voiceover?.enabled && isVoiceoverCurrent(project)
      ? 'Track + local TTS'
      : project.audio
        ? 'Imported track'
        : project.voiceover?.enabled && isVoiceoverCurrent(project)
          ? 'Local TTS voiceover'
          : 'Silent (motion only)';
  const regions = useMemo(
    () => detectInstrumentalRegions(project.lyrics.lines, project.audio?.durationUs ?? 0),
    [project.lyrics.lines, project.audio?.durationUs]
  );

  const busy = render.state === 'PREPARING' || render.state === 'RENDERING' || render.state === 'ENCODING' || render.state === 'MUXING' || render.state === 'QUEUED' || render.state === 'VALIDATING';

  return (
    <>
      <div className="ed-panel-section">
        <span className="ed-panel-label">Preset</span>
        <select
          className="ed-select"
          value={project.export.presetId}
          onChange={(e) => {
            const preset = getExportPreset(e.target.value);
            const duration = timelineDurationUs();
            store.setExport({
              ...exportSettingsFromPreset(preset.id, duration),
              fileName: project.export.fileName,
              globalOffsetUs: project.export.globalOffsetUs
            });
            store.setAspect(preset.aspectId);
          }}
          aria-label="Export preset"
        >
          {EXPORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.width}×{p.height}
            </option>
          ))}
        </select>
        <p className="ed-hint">{getExportPreset(project.export.presetId).note}</p>
      </div>

      <div className="ed-panel-section">
        <span className="ed-panel-label">Summary</span>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0, fontSize: '0.78rem' }}>
          <dt style={{ color: 'var(--text-faint)' }}>Resolution</dt>
          <dd className="mono" style={{ margin: 0 }}>{project.export.width}×{project.export.height}</dd>
          <dt style={{ color: 'var(--text-faint)' }}>Frame rate</dt>
          <dd className="mono" style={{ margin: 0 }}>{project.export.fps} fps</dd>
          <dt style={{ color: 'var(--text-faint)' }}>Frames</dt>
          <dd className="mono" style={{ margin: 0 }}>{plan.frames.toLocaleString()}</dd>
          <dt style={{ color: 'var(--text-faint)' }}>Audio</dt>
          <dd className="mono" style={{ margin: 0 }}>{audioModeLabel}</dd>
          <dt style={{ color: 'var(--text-faint)' }}>Est. size</dt>
          <dd className="mono" style={{ margin: 0 }}>{formatBytes(bytes)}</dd>
          <dt style={{ color: 'var(--text-faint)' }}>Est. time</dt>
          <dd className="mono" style={{ margin: 0 }}>~{plan.etaSeconds}s</dd>
        </dl>
      </div>

      {errors.length > 0 ? (
        <div className="ed-banner" data-kind="error">
          <h3>Settings need adjusting</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', fontSize: '0.78rem' }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button className="btn btn-sm btn-ghost" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
        {showAdvanced ? 'Hide advanced' : 'Advanced settings'}
      </button>

      {showAdvanced ? (
        <div className="ed-panel-section">
          <label className="ed-field">
            <span className="ed-panel-label">Width</span>
            <input className="ed-input" type="number" min={128} max={7680} step={2} value={project.export.width} onChange={(e) => store.setExport({ width: Number(e.target.value) })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Height</span>
            <input className="ed-input" type="number" min={128} max={4320} step={2} value={project.export.height} onChange={(e) => store.setExport({ height: Number(e.target.value) })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Frame rate</span>
            <input className="ed-input" type="number" min={12} max={60} value={project.export.fps} onChange={(e) => store.setExport({ fps: Number(e.target.value) })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Video bitrate (bps)</span>
            <input className="ed-input" type="number" min={500000} max={60000000} step={500000} value={project.export.videoBitrate} onChange={(e) => store.setExport({ videoBitrate: Number(e.target.value) })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Codec</span>
            <select className="ed-select" value={project.export.codec} onChange={(e) => store.setExport({ codec: e.target.value as typeof project.export.codec })}>
              <option value="h264">H.264 (widest compatibility)</option>
              <option value="vp9">VP9</option>
              <option value="av1">AV1</option>
            </select>
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Global offset (ms) — applied at render only</span>
            <input className="ed-input" type="number" step={10} value={Math.round(project.export.globalOffsetUs / 1000)} onChange={(e) => store.setExport({ globalOffsetUs: Number(e.target.value) * 1000 })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Range start (s)</span>
            <input className="ed-input" type="number" min={0} step={0.5} value={Math.round(project.export.rangeStartUs / 10000) / 100} onChange={(e) => store.setExport({ rangeStartUs: Math.round(Number(e.target.value) * 1_000_000) })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">Range end (s)</span>
            <input className="ed-input" type="number" min={0} step={0.5} value={Math.round(project.export.rangeEndUs / 10000) / 100} onChange={(e) => store.setExport({ rangeEndUs: Math.round(Number(e.target.value) * 1_000_000) })} />
          </label>
          <label className="ed-row">
            <span className="ed-hint">Include audio</span>
            <input type="checkbox" checked={project.export.includeAudio} onChange={(e) => store.setExport({ includeAudio: e.target.checked })} />
          </label>
          <label className="ed-field">
            <span className="ed-panel-label">File name</span>
            <input className="ed-input" value={project.export.fileName} placeholder="leave blank to derive from title" onChange={(e) => store.setExport({ fileName: e.target.value })} />
          </label>
        </div>
      ) : null}

      {regions.length > 0 ? (
        <p className="ed-hint">
          {regions.length} instrumental region{regions.length === 1 ? '' : 's'} detected — lyrics stay hidden during them.
        </p>
      ) : null}

      <div className="ed-panel-section">
        <span className="ed-panel-label">Subtitles, spec &amp; project</span>
        <details><summary>Need a native H.264 / AAC render?</summary><p className="ed-hint">Export the project below. On a computer with the VidLyrics checkout, Chromium and FFmpeg, run <code>npm run render:native -- project.vidlyricsproject video.mp4</code>. Append paths to the original track, downloaded narration WAV and any images. Files are matched by hash, not uploaded.</p></details>
        <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {SUBTITLE_FORMATS.map((f) => (
            <button key={f.id} className="btn btn-sm btn-ghost" title={f.description} onClick={() => exportSubtitle(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => exportVideoSpecFile()} disabled={project.lyrics.lines.length === 0}>
            Export spec (.json)
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => exportProjectFile()}>
            Export project
          </button>
        </div>
      </div>

      {render.error ? (
        <div className="ed-banner" data-kind="error">
          <h3>{render.error.title}</h3>
          <p>{render.error.detail}</p>
        </div>
      ) : null}

      {busy ? (
        <div className="ed-panel-section">
          <div className="ed-progress">
            <i style={{ width: `${Math.round(render.progress * 100)}%` }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {render.state} · {render.framesDone}/{render.framesTotal} frames · ETA {render.etaSeconds}s
          </span>
        </div>
      ) : null}

      {render.result && !busy ? (
        <div className="ed-banner" data-kind="success">
          <h3>Export complete</h3>
          <p>
            {render.result.fileName} · {formatBytes(render.result.bytes)} · {render.result.frames} frames ·{' '}
            {formatTimecode(project.export.rangeEndUs - project.export.rangeStartUs)}
          </p>
        </div>
      ) : null}
    </>
  );
}
