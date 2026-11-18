import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/store';
import { parseVideoSpecJson, type SpecIssue } from '../../core/spec/schema';
import { projectToVideoSpec, readProjectVoicePrefs, serialiseVideoSpec } from '../../core/spec/compiler';
import { buildAiSpecPrompt, SCENE_SNIPPETS, VIDEO_TEMPLATES, type VideoTemplate } from '../../core/spec/templates';
import {
  cancelVoiceoverGeneration,
  exportVideoSpecFile,
  generateVoiceover,
  importVideoSpecText,
  persist,
  projectTimelineDurationUs,
  seekTo
} from '../../media/session';
import { formatClock, usFromMs } from '../../core/time';
import PIPER_VOICES from '../../../model-voices.json';

function isGenerationBusy(state: string): boolean {
  return ['PREPARING', 'DOWNLOADING', 'LOADING', 'RUNNING', 'SAVING'].includes(state);
}

/**
 * Video-as-Code inspector panel.
 *
 * Lets users author, tweak and version-control complete multi-scene videos as
 * declarative JSON (`vidlyrics.spec` v1). Syncs bidirectionally with the visual
 * editor: code edits update the preview canvas and timeline in real time, and
 * timeline drags, theme edits or local TTS runs keep the JSON current.
 */
export function CodePanel() {
  const project = useEditor((s) => s.project);
  const voiceoverJob = useEditor((s) => s.voiceoverJob);
  const transcriptionState = useEditor((s) => s.transcription.state);
  const store = useEditor();

  const canonicalJson = useMemo(() => serialiseVideoSpec(project), [project]);
  const [code, setCode] = useState<string>(canonicalJson);
  const [liveSync, setLiveSync] = useState(true);
  const [issues, setIssues] = useState<SpecIssue[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(project.lyrics.lines.length === 0);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const focusedRef = useRef(false);
  const lastAppliedJsonRef = useRef<string>(canonicalJson);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync external project changes (timeline drag, theme change, undo, TTS sync) into the code view.
  useEffect(() => {
    if (canonicalJson === lastAppliedJsonRef.current) return;
    lastAppliedJsonRef.current = canonicalJson;
    if (!focusedRef.current) {
      setCode(canonicalJson);
      setIssues([]);
    }
  }, [canonicalJson]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const compileAndApply = (source: string, options: { coalesce?: boolean; notifyOnSuccess?: boolean } = {}): boolean => {
    const parsed = parseVideoSpecJson(source);
    if (!parsed.ok || !parsed.spec) {
      setIssues(parsed.issues);
      return false;
    }
    setIssues([]);
    store.applyVideoSpec(parsed.spec, {
      label: 'Edit video spec',
      coalesceKey: options.coalesce ? 'code-edit' : undefined
    });
    lastAppliedJsonRef.current = serialiseVideoSpec(useEditor.getState().project);
    if (options.notifyOnSuccess) {
      store.notify({
        kind: 'success',
        title: 'Spec compiled',
        detail: `${parsed.spec.scenes.length} scene${parsed.spec.scenes.length === 1 ? '' : 's'} active.`
      });
    }
    return true;
  };

  const onCodeChange = (next: string) => {
    setCode(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!liveSync) {
      const check = parseVideoSpecJson(next);
      setIssues(check.ok ? [] : check.issues);
      return;
    }
    debounceRef.current = setTimeout(() => {
      compileAndApply(next, { coalesce: true });
    }, 260);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      compileAndApply(code, { notifyOnSuccess: true });
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const el = event.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const updated = `${code.slice(0, start)}  ${code.slice(end)}`;
      onCodeChange(updated);
      requestAnimationFrame(() => {
        el.selectionStart = start + 2;
        el.selectionEnd = start + 2;
      });
    }
  };

  const loadTemplate = (template: VideoTemplate) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    focusedRef.current = false;
    store.applyVideoSpec(template.spec, {
      label: `Load template: ${template.name}`,
      resetPlayhead: true
    });
    const nextJson = serialiseVideoSpec(useEditor.getState().project);
    lastAppliedJsonRef.current = nextJson;
    setCode(nextJson);
    setIssues([]);
    setTemplatesOpen(false);
    void persist();
    store.notify({
      kind: 'success',
      title: `${template.name} loaded`,
      detail: `${template.spec.scenes.length} animated scenes ready — press Play, tweak JSON, sync local TTS, or Export video.`
    });
  };

  const appendSnippet = (index: number) => {
    const snippet = SCENE_SNIPPETS[index];
    if (!snippet) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const currentSpec = projectToVideoSpec(useEditor.getState().project);
    const created = snippet.create();
    currentSpec.scenes.push(created);
    store.applyVideoSpec(currentSpec, { label: `Add ${snippet.layout} scene` });
    const updated = useEditor.getState().project;
    const addedLine = updated.lyrics.lines[updated.lyrics.lines.length - 1];
    if (addedLine) {
      const introUs = updated.design.intro.enabled ? updated.design.intro.durationUs : 0;
      store.setSelection([addedLine.id]);
      seekTo(introUs + addedLine.start + Math.min(usFromMs(600), Math.round((addedLine.end - addedLine.start) * 0.4)));
    }
    const nextJson = serialiseVideoSpec(useEditor.getState().project);
    lastAppliedJsonRef.current = nextJson;
    setCode(nextJson);
    setIssues([]);
  };

  const formatCode = () => {
    try {
      const formatted = `${JSON.stringify(JSON.parse(code), null, 2)}\n`;
      setCode(formatted);
      compileAndApply(formatted, { coalesce: true });
    } catch (error) {
      setIssues([{ path: 'JSON', message: error instanceof Error ? error.message : 'Cannot format invalid JSON.' }]);
    }
  };

  const syncSpeechFromSpec = () => {
    const voicePrefs = readProjectVoicePrefs(project);
    const defaultVoice = PIPER_VOICES[0]?.id ?? 'en_US-lessac-medium';
    const validIds = new Set(PIPER_VOICES.map((v) => v.id));
    const voiceId = voicePrefs?.voiceId && validIds.has(voicePrefs.voiceId) ? voicePrefs.voiceId : defaultVoice;
    const voiceIdB =
      voicePrefs?.voiceIdB && validIds.has(voicePrefs.voiceIdB)
        ? voicePrefs.voiceIdB
        : (PIPER_VOICES[2]?.id ?? null);
    void generateVoiceover(voiceId, {
      mode: 'sequential',
      pauseMs: voicePrefs?.pauseMs ?? 300,
      voiceIdB
    });
  };

  const copyAiPrompt = async () => {
    const prompt = buildAiSpecPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2200);
      store.notify({
        kind: 'success',
        title: 'AI spec prompt copied',
        detail: 'Paste into any AI coding assistant with your script, then paste the returned JSON here.'
      });
    } catch {
      store.notify({
        kind: 'warning',
        title: 'Clipboard blocked',
        detail: 'Use Export spec to inspect the JSON format directly.'
      });
    }
  };

  const onSpecFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const text = await file.text();
    if (importVideoSpecText(text, `Import ${file.name}`)) {
      const nextJson = serialiseVideoSpec(useEditor.getState().project);
      lastAppliedJsonRef.current = nextJson;
      setCode(nextJson);
      setIssues([]);
    }
  };

  const voiceBusy = isGenerationBusy(voiceoverJob.state);
  const anyGenBusy = voiceBusy || isGenerationBusy(transcriptionState);
  const sceneCount = project.lyrics.lines.length;
  const durationLabel = formatClock(projectTimelineDurationUs(project));
  const statusKind = issues.length > 0 ? 'error' : code.trim() !== canonicalJson.trim() && !liveSync ? 'warn' : 'ok';

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(e) => {
          void onSpecFile(e.target.files);
          e.currentTarget.value = '';
        }}
      />

      <div className="ed-panel-section">
        <div className="ed-row">
          <span className="ed-panel-label">Video as Code</span>
          <span className="ed-code-status mono" data-status={statusKind} role="status">
            {issues.length > 0
              ? `${issues.length} issue${issues.length === 1 ? '' : 's'}`
              : statusKind === 'warn'
                ? 'Unapplied'
                : `${sceneCount} scene${sceneCount === 1 ? '' : 's'} · ${durationLabel}`}
          </span>
        </div>
        <p className="ed-hint">
          Define scenes, layouts, charts, code cards, transitions and voices in declarative JSON. Renders locally to MP4 — no cloud or watermarks.
        </p>
        <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button
            className="btn btn-sm btn-ghost"
            aria-expanded={templatesOpen}
            onClick={() => setTemplatesOpen((v) => !v)}
          >
            {templatesOpen ? 'Hide templates' : 'Starter templates'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void copyAiPrompt()}>
            {copiedPrompt ? 'Copied prompt' : 'Copy AI prompt'}
          </button>
        </div>
      </div>

      {templatesOpen ? (
        <div className="ed-panel-section">
          <span className="ed-panel-label">Starter templates</span>
          <div className="ed-template-list">
            {VIDEO_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="ed-template-card"
                onClick={() => loadTemplate(tpl)}
              >
                <div className="ed-row">
                  <strong>{tpl.name}</strong>
                  <span className="ed-template-badge mono">{tpl.badge}</span>
                </div>
                <span className="ed-hint">{tpl.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="ed-panel-section">
        <span className="ed-panel-label">Insert scene block</span>
        <div className="ed-snippet-bar">
          {SCENE_SNIPPETS.map((snippet, idx) => (
            <button
              key={snippet.layout}
              type="button"
              className="btn btn-sm btn-ghost ed-snippet-btn"
              onClick={() => appendSnippet(idx)}
            >
              {snippet.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ed-panel-section">
        <div className="ed-row">
          <label className="ed-panel-label" htmlFor="ed-spec-editor">
            vidlyrics.spec.json
          </label>
          <label className="ed-check-inline">
            <input
              type="checkbox"
              checked={liveSync}
              onChange={(e) => {
                const enabled = e.target.checked;
                setLiveSync(enabled);
                if (enabled) compileAndApply(code, { coalesce: true });
              }}
            />
            <span>Live</span>
          </label>
        </div>

        <textarea
          id="ed-spec-editor"
          className="ed-code-editor mono"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={code}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onBlur={() => {
            focusedRef.current = false;
            if (issues.length === 0) {
              const latest = serialiseVideoSpec(useEditor.getState().project);
              lastAppliedJsonRef.current = latest;
              setCode(latest);
            }
          }}
          onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Declarative video JSON specification"
          aria-invalid={issues.length > 0}
        />

        {issues.length > 0 ? (
          <div className="ed-code-issues" role="alert">
            {issues.slice(0, 4).map((issue, idx) => (
              <div key={`${issue.path}-${idx}`} className="ed-code-issue">
                <span className="mono">
                  {issue.path}
                  {issue.line ? `:${issue.line}` : ''}
                </span>{' '}
                {issue.message}
              </div>
            ))}
          </div>
        ) : null}

        <div className="ed-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => compileAndApply(code, { notifyOnSuccess: true })}
            title="Compile spec onto canvas and timeline (Ctrl/⌘ + Enter)"
          >
            Apply spec
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={formatCode}>
            Format
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileInputRef.current?.click()}>
            Import
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={exportVideoSpecFile} disabled={sceneCount === 0}>
            Export .json
          </button>
        </div>
      </div>

      <div className="ed-panel-section ed-generation-section">
        <span className="ed-panel-label">Local TTS audio sync</span>
        <p className="ed-hint">
          Synthesizes each scene with the bundled Piper voice in <code className="mono">voice.voiceId</code> (plus <code className="mono">voiceIdB</code> for speaker B) and sets exact audio-matched scene durations.
        </p>
        <div className="ed-banner-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={sceneCount === 0 || anyGenBusy || issues.length > 0}
            onClick={syncSpeechFromSpec}
          >
            {voiceBusy ? 'Synthesizing…' : 'Auto-time with local TTS'}
          </button>
          {voiceBusy ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={cancelVoiceoverGeneration}>
              Cancel
            </button>
          ) : null}
        </div>
        {voiceBusy ? (
          <div className="ed-job-status" role="status" aria-live="polite">
            <div className="ed-row">
              <span>{voiceoverJob.message || 'Preparing speech…'}</span>
              <span>{Math.round(voiceoverJob.progress * 100)}%</span>
            </div>
            <div className="ed-progress">
              <i style={{ width: `${Math.max(0, Math.min(100, voiceoverJob.progress * 100))}%` }} />
            </div>
          </div>
        ) : null}
        {voiceoverJob.error ? (
          <p className="ed-generation-error" role="alert">
            {voiceoverJob.error}
          </p>
        ) : null}
      </div>
    </>
  );
}
