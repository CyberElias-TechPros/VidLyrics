import { create } from 'zustand';
import type {
  AppError, Design, ExportSettings, Line, Microseconds, Project, RenderState, SyncState
} from '../core/types';
import { createProject, createLine, splitLine, mergeLines, newId, PROJECT_FORMAT_VERSION } from '../core/project/factory';
import {
  applyBatch, applyCommand, createHistory, redo as redoHistory, undo as undoHistory,
  canRedo, canUndo, undoLabel, redoLabel, type Command, type HistoryState
} from '../core/project/history';
import { usFromMs, usFromSeconds } from '../core/time';
import { interpolateWords, estimateLineTimings } from '../core/timing/distribute';
import { postProcess, sortLines, rebuildWordsForLine } from '../core/timing/postprocess';
import { tapReducer, createTapSession, applyTaps, type TapSession } from '../core/timing/tap';
import { inferSections } from '../core/lyrics/structure';
import { normalizeDisplay } from '../core/lyrics/normalize';
import { highlightTokens } from '../core/lyrics/segment';
import { designFromTheme } from '../core/design/tokens';
import type { PeakData } from '../core/audio/peaks';
import type { SpectrumEnvelope } from '../core/audio/spectrum';
import type { BeatGrid } from '../core/audio/beats';

/**
 * Editor state.
 *
 * Two things are deliberately kept OUT of React state:
 *   - the decoded PCM and the AudioBuffer (huge, and changing them must not
 *     trigger a render)
 *   - the PlaybackEngine instance (it owns an AudioContext)
 *
 * Everything a user can see or undo lives here, and every mutation goes through
 * a command so undo/redo and autosave stay consistent.
 */

export interface MediaStatus {
  state: 'IDLE' | 'IMPORTING' | 'VALIDATING' | 'DECODING' | 'ANALYZING' | 'READY' | 'FAILED';
  stage: 'idle' | 'reading' | 'decoding' | 'peaks' | 'spectrum';
  progress: number;
  error: AppError | null;
}

export interface RenderStatus {
  state: RenderState;
  progress: number;
  framesDone: number;
  framesTotal: number;
  etaSeconds: number;
  error: AppError | null;
  result: { blob: Blob; fileName: string; bytes: number; frames: number } | null;
}

export interface SyncStatus {
  state: SyncState;
  progress: number;
  message: string;
  error: AppError | null;
}

export interface EditorState {
  project: Project;
  history: HistoryState<Project>;
  media: MediaStatus;
  sync: SyncStatus;
  render: RenderStatus;
  peaks: PeakData | null;
  spectrum: SpectrumEnvelope | null;
  beatGrid: BeatGrid | null;
  audioMissing: boolean;
  playheadUs: Microseconds;
  playing: boolean;
  tap: TapSession;
  tapActive: boolean;
  selectedIds: string[];
  loop: { startUs: Microseconds; endUs: Microseconds } | null;
  panel: 'lyrics' | 'design' | 'export';
  showGuides: boolean;
  showHeat: boolean;
  dirty: boolean;
  lastSavedAt: number | null;
  notices: { id: string; kind: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }[];

  /* commands */
  commit: (label: string, mutate: (project: Project) => Project, options?: { coalesceKey?: string }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;

  /* project lifecycle */
  newProject: (options?: { title?: string; artist?: string }) => void;
  replaceProject: (project: Project, options?: { audioMissing?: boolean }) => void;
  setMeta: (patch: Partial<Project['meta']>) => void;

  /* lyrics */
  setLyricsFromText: (text: string, source: Project['lyrics']['source'], fileName?: string | null) => void;
  updateLineText: (lineId: string, text: string) => void;
  deleteLines: (lineIds: string[]) => void;
  duplicateLines: (lineIds: string[]) => void;
  insertLine: (afterLineId: string | null, text: string) => void;
  splitLineAt: (lineId: string, wordIndex: number) => void;
  mergeWithNext: (lineId: string) => void;
  moveLine: (lineId: string, deltaIndex: number) => void;
  setLineTime: (lineId: string, field: 'start' | 'end', timeUs: Microseconds) => void;
  nudgeLine: (lineId: string, field: 'start' | 'end', deltaUs: Microseconds) => void;
  moveLineBlock: (lineId: string, deltaUs: Microseconds) => void;
  setLineLock: (lineId: string, locked: boolean) => void;
  setLineSection: (lineId: string, sectionId: string | null) => void;
  setLineTranslation: (lineId: string, translation: string) => void;
  setLineSpeaker: (lineId: string, speaker: 'A' | 'B' | null) => void;
  generateTimings: () => void;

  /* design */
  setTheme: (themeId: string) => void;
  setDesign: (patch: Partial<Design>) => void;
  setAspect: (aspectId: Design['aspectId']) => void;
  setExport: (patch: Partial<ExportSettings>) => void;

  /* runtime */
  setMedia: (patch: Partial<MediaStatus>) => void;
  setSync: (patch: Partial<SyncStatus>) => void;
  setRender: (patch: Partial<RenderStatus>) => void;
  setAnalysis: (patch: { peaks?: PeakData | null; spectrum?: SpectrumEnvelope | null; beatGrid?: BeatGrid | null }) => void;
  setPlayhead: (timeUs: Microseconds) => void;
  setPlaying: (playing: boolean) => void;
  setLoop: (loop: { startUs: Microseconds; endUs: Microseconds } | null) => void;
  setSelection: (lineIds: string[]) => void;
  toggleLineSelection: (lineId: string, additive: boolean) => void;
  setPanel: (panel: EditorState['panel']) => void;
  setShowGuides: (show: boolean) => void;
  setShowHeat: (show: boolean) => void;
  setUiMode: (mode: 'simple' | 'advanced') => void;
  setZoom: (zoomPxPerSecond: number) => void;
  markSaved: () => void;
  markDirty: () => void;
  notify: (notice: Omit<EditorState['notices'][number], 'id'>) => void;
  dismissNotice: (id: string) => void;

  /* tap-sync */
  startTapSync: () => void;
  stopTapSync: () => void;
  tapAt: (timeUs: Microseconds) => void;
  tapUndo: () => void;
  tapRetap: (timeUs: Microseconds) => void;
  tapReset: () => void;
  applyTapTimings: () => void;
  setTapCompensation: (compensationUs: Microseconds) => void;
}

const initialProject = () => createProject();

export const useEditor = create<EditorState>((set, get) => ({
  project: initialProject(),
  history: createHistory<Project>(),
  media: { state: 'IDLE', stage: 'idle', progress: 0, error: null },
  sync: { state: 'IDLE', progress: 0, message: '', error: null },
  render: { state: 'IDLE', progress: 0, framesDone: 0, framesTotal: 0, etaSeconds: 0, error: null, result: null },
  peaks: null,
  spectrum: null,
  beatGrid: null,
  audioMissing: false,
  playheadUs: 0,
  playing: false,
  tap: createTapSession({ lineCount: 0 }),
  tapActive: false,
  selectedIds: [],
  loop: null,
  panel: 'lyrics',
  showGuides: false,
  showHeat: true,
  dirty: false,
  lastSavedAt: null,
  notices: [],

  commit: (label, mutate, options) => {
    const { project, history } = get();
    const command: Command<Project> = {
      label,
      coalesceKey: options?.coalesceKey,
      apply: (p) => ({ ...mutate(p), updatedAt: Date.now() }),
      revert: (p) => p
    };
    // Commands carry an explicit inverse so undo cannot be approximated.
    const inverse: Command<Project> = {
      ...command,
      apply: command.apply,
      revert: () => project
    };
    const result = applyCommand(project, history, inverse);
    set({ project: result.state, history: result.history, dirty: true });
  },

  undo: () => {
    const result = undoHistory(get().project, get().history);
    if (result) set({ project: result.state, history: result.history, dirty: true });
  },
  redo: () => {
    const result = redoHistory(get().project, get().history);
    if (result) set({ project: result.state, history: result.history, dirty: true });
  },
  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
  undoLabel: () => undoLabel(get().history),
  redoLabel: () => redoLabel(get().history),

  newProject: (options) => {
    set({
      project: createProject(options),
      history: createHistory<Project>(),
      media: { state: 'IDLE', stage: 'idle', progress: 0, error: null },
      peaks: null,
      spectrum: null,
      beatGrid: null,
      playheadUs: 0,
      selectedIds: [],
      dirty: true
    });
  },

  replaceProject: (project, options) => {
    set({
      project: { ...project, formatVersion: PROJECT_FORMAT_VERSION },
      history: createHistory<Project>(),
      audioMissing: options?.audioMissing ?? false,
      playheadUs: project.ui.lastPlayheadUs,
      dirty: true
    });
  },

  setMeta: (patch) => {
    const { project, history } = get();
    const before = project.meta;
    const command: Command<Project> = {
      label: 'Edit project details',
      coalesceKey: 'meta',
      apply: (p) => ({ ...p, meta: { ...p.meta, ...patch } }),
      revert: (p) => ({ ...p, meta: before })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setLyricsFromText: (text, source, fileName = null) => {
    const { project, history } = get();
    const clean = normalizeDisplay(text);
    const lines = clean
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => createLine(l));
    const structure = inferSections(lines);
    for (const line of lines) line.sectionId = structure.assignment.get(line.id) ?? null;
    const estimated = estimateLineTimings(lines, { durationUs: project.audio?.durationUs ?? null });
    const processed = postProcess(estimated, { durationUs: project.audio?.durationUs ?? null, applyLeadIn: true });
    const before = project.lyrics;
    const beforeSections = project.sections;
    const command: Command<Project> = {
      label: 'Replace lyrics',
      apply: (p) => ({
        ...p,
        lyrics: { source, originalText: text, originalFileName: fileName, lines: processed },
        sections: structure.sections
      }),
      revert: (p) => ({ ...p, lyrics: before, sections: beforeSections })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  updateLineText: (lineId, text) => {
    const { project, history } = get();
    const lines = project.lyrics.lines;
    const before = lines;
    const after = lines.map((l) => (l.id === lineId ? rebuildWordsForLine(l, normalizeDisplay(text)) : l));
    const command: Command<Project> = {
      label: 'Edit lyric text',
      coalesceKey: `text:${lineId}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  deleteLines: (lineIds) => {
    const { project, history } = get();
    const set_ = new Set(lineIds);
    const before = project.lyrics.lines;
    const after = before.filter((l) => !set_.has(l.id));
    const command: Command<Project> = {
      label: `Delete ${lineIds.length} line${lineIds.length === 1 ? '' : 's'}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, selectedIds: [], dirty: true });
  },

  duplicateLines: (lineIds) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = [...before];
    let offset = 0;
    for (const id of lineIds) {
      const index = after.findIndex((l) => l.id === id);
      if (index === -1) continue;
      const source = after[index]!;
      const copy = createLine(source.text, {
        start: source.end + usFromMs(200),
        end: source.end + usFromMs(200) + (source.end - source.start),
        sectionId: source.sectionId,
        style: source.style,
        speaker: source.speaker,
        translation: source.translation
      });
      after.splice(index + 1 + offset, 0, copy);
      offset += 1;
    }
    const command: Command<Project> = {
      label: 'Duplicate lines',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  insertLine: (afterLineId, text) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const line = createLine(text);
    const index = afterLineId ? before.findIndex((l) => l.id === afterLineId) : before.length - 1;
    const at = index === -1 ? before.length : index + 1;
    const previous = before[at - 1];
    if (previous) {
      line.start = previous.end + usFromMs(200);
      line.end = line.start + usFromSeconds(2);
    }
    const after = [...before.slice(0, at), line, ...before.slice(at)];
    const command: Command<Project> = {
      label: 'Insert line',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, selectedIds: [line.id], dirty: true });
  },

  splitLineAt: (lineId, wordIndex) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const index = before.findIndex((l) => l.id === lineId);
    const line = before[index];
    if (!line) return;
    const parts = splitLine(line, wordIndex);
    if (!parts) return;
    const after = [...before.slice(0, index), ...parts, ...before.slice(index + 1)];
    const command: Command<Project> = {
      label: 'Split line',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, selectedIds: [parts[1]!.id], dirty: true });
  },

  mergeWithNext: (lineId) => {
    const { project, history } = get();
    const sorted = sortLines(project.lyrics.lines);
    const index = sorted.findIndex((l) => l.id === lineId);
    const current = sorted[index];
    const next = sorted[index + 1];
    if (!current || !next) return;
    const before = project.lyrics.lines;
    const merged = mergeLines(current, next);
    const after = before
      .filter((l) => l.id !== current.id && l.id !== next.id)
      .concat(merged);
    const command: Command<Project> = {
      label: 'Merge lines',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: sortLines(after) } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, selectedIds: [merged.id], dirty: true });
  },

  moveLine: (lineId, deltaIndex) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const from = before.findIndex((l) => l.id === lineId);
    const to = from + deltaIndex;
    if (from === -1 || to < 0 || to >= before.length) return;
    const after = [...before];
    const [item] = after.splice(from, 1);
    after.splice(to, 0, item!);
    const command: Command<Project> = {
      label: 'Reorder line',
      coalesceKey: `reorder:${lineId}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setLineTime: (lineId, field, timeUs) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => {
      if (l.id !== lineId) return l;
      const start = field === 'start' ? Math.max(0, timeUs) : l.start;
      const end = field === 'end' ? Math.max(start, timeUs) : l.end;
      return { ...l, start, end, source: 'human' as const, confidence: 1, words: interpolateWords({ ...l, start, end }, start, end) };
    });
    const command: Command<Project> = {
      label: `Adjust line ${field}`,
      coalesceKey: `time:${lineId}:${field}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  nudgeLine: (lineId, field, deltaUs) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => {
      if (l.id !== lineId) return l;
      const start = field === 'start' ? Math.max(0, l.start + deltaUs) : l.start;
      const end = field === 'end' ? Math.max(start, l.end + deltaUs) : l.end;
      return { ...l, start, end, words: interpolateWords({ ...l, start, end }, start, end) };
    });
    const command: Command<Project> = {
      label: `Nudge ${field}`,
      coalesceKey: `nudge:${lineId}:${field}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  moveLineBlock: (lineId, deltaUs) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => {
      if (l.id !== lineId) return l;
      const start = Math.max(0, l.start + deltaUs);
      const end = start + (l.end - l.start);
      return { ...l, start, end, source: 'human' as const, confidence: 1, words: interpolateWords({ ...l, start, end }, start, end) };
    });
    const command: Command<Project> = {
      label: 'Move line',
      coalesceKey: `move:${lineId}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setLineLock: (lineId, locked) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => (l.id === lineId ? { ...l, locked } : l));
    const command: Command<Project> = {
      label: locked ? 'Lock line timing' : 'Unlock line timing',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setLineSection: (lineId, sectionId) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => (l.id === lineId ? { ...l, sectionId } : l));
    const command: Command<Project> = {
      label: 'Change section',
      coalesceKey: `section:${lineId}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setLineTranslation: (lineId, translation) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => (l.id === lineId ? { ...l, translation: translation.trim() || null } : l));
    const command: Command<Project> = {
      label: 'Edit translation',
      coalesceKey: `translation:${lineId}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setLineSpeaker: (lineId, speaker) => {
    const { project, history } = get();
    const before = project.lyrics.lines;
    const after = before.map((l) => (l.id === lineId ? { ...l, speaker } : l));
    const command: Command<Project> = {
      label: 'Set speaker',
      coalesceKey: `speaker:${lineId}`,
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: after } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  generateTimings: () => {
    const { project, history, beatGrid } = get();
    const before = project.lyrics.lines;
    const durationUs = project.audio?.durationUs ?? null;
    const estimated = estimateLineTimings(before, { durationUs });
    const processed = postProcess(estimated, {
      durationUs,
      applyLeadIn: true,
      beatGrid: beatGrid?.beats
    });
    const command: Command<Project> = {
      label: 'Generate timings',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: processed } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setTheme: (themeId) => {
    const { project, history } = get();
    const before = project.design;
    const after = designFromTheme(themeId, project.design.aspectId);
    const command: Command<Project> = {
      label: 'Change theme',
      coalesceKey: 'theme',
      apply: (p) => ({ ...p, design: { ...after, customSize: p.design.customSize, accent: p.design.accent } }),
      revert: (p) => ({ ...p, design: before }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, design: { ...after, customSize: p.design.customSize, accent: p.design.accent } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setDesign: (patch) => {
    const { project, history } = get();
    const before = project.design;
    const command: Command<Project> = {
      label: 'Adjust design',
      coalesceKey: 'design',
      apply: (p) => ({ ...p, design: { ...p.design, ...patch } }),
      revert: (p) => ({ ...p, design: before }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, design: { ...p.design, ...patch } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setAspect: (aspectId) => {
    const { project, history } = get();
    const before = project.design;
    const command: Command<Project> = {
      label: 'Change aspect ratio',
      coalesceKey: 'aspect',
      apply: (p) => ({ ...p, design: { ...p.design, aspectId } }),
      revert: (p) => ({ ...p, design: before }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, design: { ...p.design, aspectId } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setExport: (patch) => {
    const { project, history } = get();
    const before = project.export;
    const command: Command<Project> = {
      label: 'Change export settings',
      coalesceKey: 'export',
      apply: (p) => ({ ...p, export: { ...p.export, ...patch } }),
      revert: (p) => ({ ...p, export: before }),
      merge: (previous) => ({ ...previous, apply: (p) => ({ ...p, export: { ...p.export, ...patch } }) })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },

  setMedia: (patch) => set((s) => ({ media: { ...s.media, ...patch } })),
  setSync: (patch) => set((s) => ({ sync: { ...s.sync, ...patch } })),
  setRender: (patch) => set((s) => ({ render: { ...s.render, ...patch } })),
  setAnalysis: (patch) =>
    set((s) => ({
      peaks: patch.peaks !== undefined ? patch.peaks : s.peaks,
      spectrum: patch.spectrum !== undefined ? patch.spectrum : s.spectrum,
      beatGrid: patch.beatGrid !== undefined ? patch.beatGrid : s.beatGrid
    })),
  setPlayhead: (timeUs) => set({ playheadUs: timeUs }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  setSelection: (lineIds) => set({ selectedIds: lineIds }),
  toggleLineSelection: (lineId, additive) =>
    set((s) => {
      if (!additive) return { selectedIds: [lineId] };
      return {
        selectedIds: s.selectedIds.includes(lineId)
          ? s.selectedIds.filter((id) => id !== lineId)
          : [...s.selectedIds, lineId]
      };
    }),
  setPanel: (panel) => set({ panel }),
  setShowGuides: (show) => set({ showGuides: show }),
  setShowHeat: (show) => set({ showHeat: show }),
  setUiMode: (mode) => {
    const { project, history } = get();
    const command: Command<Project> = {
      label: 'Switch mode',
      apply: (p) => ({ ...p, ui: { ...p.ui, mode } }),
      revert: (p) => ({ ...p, ui: { ...p.ui, mode: p.ui.mode } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, dirty: true });
  },
  setZoom: (zoomPxPerSecond) =>
    set((s) => ({
      project: { ...s.project, ui: { ...s.project.ui, zoomPxPerSecond: Math.max(2, Math.min(4000, zoomPxPerSecond)) } },
      dirty: true
    })),
  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),
  markDirty: () => set({ dirty: true }),
  notify: (notice) =>
    set((s) => ({ notices: [...s.notices, { ...notice, id: newId('nt') }].slice(-4) })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  startTapSync: () =>
    set((s) => ({
      tapActive: true,
      tap: createTapSession({ lineCount: s.project.lyrics.lines.length }),
      panel: 'lyrics'
    })),
  stopTapSync: () => set({ tapActive: false }),
  tapAt: (timeUs) => set((s) => ({ tap: tapReducer(s.tap, { type: 'TAP', timeUs }, s.project.lyrics.lines.length) })),
  tapUndo: () => set((s) => ({ tap: tapReducer(s.tap, { type: 'UNDO' }, s.project.lyrics.lines.length) })),
  tapRetap: (timeUs) =>
    set((s) => ({ tap: tapReducer(s.tap, { type: 'REDO_LAST_TAP', timeUs }, s.project.lyrics.lines.length) })),
  tapReset: () => set((s) => ({ tap: tapReducer(s.tap, { type: 'RESET' }, s.project.lyrics.lines.length) })),
  setTapCompensation: (compensationUs) =>
    set((s) => ({ tap: tapReducer(s.tap, { type: 'SET_COMPENSATION', compensationUs }, s.project.lyrics.lines.length) })),
  applyTapTimings: () => {
    const { project, history, tap } = get();
    if (tap.taps.length === 0) return;
    const before = project.lyrics.lines;
    const timed = applyTaps(before, tap, { durationUs: project.audio?.durationUs ?? null });
    const processed = postProcess(timed, { durationUs: project.audio?.durationUs ?? null });
    const command: Command<Project> = {
      label: 'Apply tap-sync timings',
      apply: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: processed } }),
      revert: (p) => ({ ...p, lyrics: { ...p.lyrics, lines: before } })
    };
    const result = applyCommand(project, history, command);
    set({ project: result.state, history: result.history, tapActive: false, dirty: true });
  }
}));

/** Words for a line, rebuilt after a text edit. */
export function wordsForLine(line: Line): Line['words'] {
  return highlightTokens(line.text).map((token, i) => ({
    id: `${line.id}_w${i}`,
    text: token.text.trim(),
    norm: '',
    start: 0,
    end: 0,
    confidence: 0,
    source: 'estimate' as const,
    locked: false
  }));
}

/** Convenience selector: the line the playhead is inside. */
export function selectCurrentLine(state: EditorState): Line | null {
  return (
    state.project.lyrics.lines.find(
      (l) => state.playheadUs >= l.start && state.playheadUs <= l.end
    ) ?? null
  );
}

/** Convenience selector: next line after the playhead, used by tap-sync UX. */
export function selectNextUntimedLine(state: EditorState): Line | null {
  return state.project.lyrics.lines.find((l) => l.end <= l.start) ?? null;
}

void applyBatch;
