import type { Project } from '../types';
import { PROJECT_FORMAT_VERSION } from './factory';
import { validateProject, isFutureFormat } from './schema';

/**
 * Project format migrations.
 *
 * Rules this module enforces:
 *   - A file from a NEWER app is refused outright. Loading it would silently
 *     drop fields the newer app depends on and corrupt the user's work.
 *   - Migrations run in order and are additive. None of them deletes data the
 *     user can see.
 *   - Missing fields are filled from defaults, never guessed from neighbours.
 */

export class ProjectFormatError extends Error {
  constructor(
    message: string,
    readonly code: 'FUTURE_VERSION' | 'CORRUPT' | 'NOT_A_PROJECT'
  ) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

export interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  steps: string[];
  defaultsFilled: string[];
}

type Migration = { from: number; name: string; apply: (project: Record<string, unknown>) => Record<string, unknown> };

/**
 * Migration table. Add an entry here whenever PROJECT_FORMAT_VERSION is bumped.
 * Keeping it a table (rather than a chain of ifs) makes the order auditable.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    name: 'v1 -> v2: add generated voiceover metadata',
    apply: (project) => ({ ...project, voiceover: project.voiceover ?? null })
  }
];

export function needsMigration(formatVersion: number): boolean {
  return formatVersion < PROJECT_FORMAT_VERSION;
}

/**
 * Load arbitrary JSON into a validated Project.
 * Throws ProjectFormatError for anything the app must not silently accept.
 */
export function loadProjectJson(
  raw: unknown,
  options: { currentVersion?: number } = {}
): { project: Project; report: MigrationReport } {
  const currentVersion = options.currentVersion ?? PROJECT_FORMAT_VERSION;

  if (!raw || typeof raw !== 'object') throw new ProjectFormatError('That file is not a project.', 'NOT_A_PROJECT');

  const container = raw as Record<string, unknown>;
  const kind = container.kind;
  const isProjectFile = kind === 'vidlyrics.project';
  const candidate = (isProjectFile ? container.project : container) as Record<string, unknown> | undefined;

  if (!candidate || typeof candidate !== 'object') {
    throw new ProjectFormatError('That file does not contain a project payload.', 'NOT_A_PROJECT');
  }

  const declared = typeof candidate.formatVersion === 'number' ? candidate.formatVersion : 1;

  if (isFutureFormat(declared, currentVersion)) {
    throw new ProjectFormatError(
      `This project was saved by a newer version (format v${declared}; this app supports up to v${currentVersion}). Update the app to open it — opening it here would discard fields the newer version added.`,
      'FUTURE_VERSION'
    );
  }

  const steps: string[] = [];
  let working: Record<string, unknown> = { ...candidate };
  let version = declared;

  while (version < currentVersion) {
    const migration = MIGRATIONS.find((m) => m.from === version);
    if (!migration) {
      throw new ProjectFormatError(
        `No migration is defined from format v${version} to v${currentVersion}. This project cannot be opened safely.`,
        'CORRUPT'
      );
    }
    working = migration.apply(working);
    version = migration.from + 1;
    working.formatVersion = version;
    steps.push(migration.name);
  }

  const filled = fillDefaults(working);
  const result = validateProject(working);
  if (!result.ok || !result.data) {
    const first = result.issues[0];
    throw new ProjectFormatError(
      `Project data failed validation at "${first?.path ?? 'unknown'}": ${first?.message ?? 'invalid value'}.`,
      'CORRUPT'
    );
  }

  return {
    project: result.data as unknown as Project,
    report: { fromVersion: declared, toVersion: currentVersion, steps, defaultsFilled: filled }
  };
}

/**
 * Fill optional-in-practice fields so older files load without a schema change.
 * Returns the list of paths that were filled, surfaced in the import dialog so
 * the user knows the file was adapted rather than silently rewritten.
 */
function fillDefaults(project: Record<string, unknown>): string[] {
  const filled: string[] = [];
  const set = (path: string, target: Record<string, unknown>, key: string, value: unknown) => {
    if (target[key] === undefined) {
      target[key] = value;
      filled.push(path);
    }
  };

  set('meta', project, 'meta', {});
  const meta = project.meta as Record<string, unknown>;
  set('meta.title', meta, 'title', '');
  set('meta.artist', meta, 'artist', '');
  set('meta.album', meta, 'album', '');
  set('meta.language', meta, 'language', 'en');
  set('meta.notes', meta, 'notes', '');

  set('sections', project, 'sections', []);
  set('audio', project, 'audio', null);
  set('voiceover', project, 'voiceover', null);

  set('lyrics', project, 'lyrics', { source: 'empty', originalText: '', originalFileName: null, lines: [] });
  const lyrics = project.lyrics as Record<string, unknown>;
  set('lyrics.source', lyrics, 'source', 'empty');
  set('lyrics.originalText', lyrics, 'originalText', '');
  set('lyrics.originalFileName', lyrics, 'originalFileName', null);
  set('lyrics.lines', lyrics, 'lines', []);

  for (const [i, raw] of (lyrics.lines as unknown[]).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const line = raw as Record<string, unknown>;
    set(`lyrics.lines[${i}].words`, line, 'words', []);
    set(`lyrics.lines[${i}].locked`, line, 'locked', false);
    set(`lyrics.lines[${i}].style`, line, 'style', {});
    set(`lyrics.lines[${i}].sectionId`, line, 'sectionId', null);
    set(`lyrics.lines[${i}].speaker`, line, 'speaker', null);
    set(`lyrics.lines[${i}].translation`, line, 'translation', null);
    set(`lyrics.lines[${i}].source`, line, 'source', 'estimate');
  }

  set('ui', project, 'ui', { mode: 'simple', zoomPxPerSecond: 60, selection: null, lastPlayheadUs: 0 });
  const ui = project.ui as Record<string, unknown>;
  set('ui.mode', ui, 'mode', 'simple');
  set('ui.zoomPxPerSecond', ui, 'zoomPxPerSecond', 60);
  set('ui.selection', ui, 'selection', null);
  set('ui.lastPlayheadUs', ui, 'lastPlayheadUs', 0);

  if (project.design && typeof project.design === 'object') {
    const design = project.design as Record<string, unknown>;
    set('design.customSize', design, 'customSize', null);
    set('design.accent', design, 'accent', null);
    if (design.brand && typeof design.brand === 'object') {
      set('design.brand.logoAssetId', design.brand as Record<string, unknown>, 'logoAssetId', null);
    }
  }

  if (project.export && typeof project.export === 'object') {
    const exp = project.export as Record<string, unknown>;
    set('export.codec', exp, 'codec', 'h264');
    set('export.globalOffsetUs', exp, 'globalOffsetUs', 0);
    set('export.includeAudio', exp, 'includeAudio', true);
    set('export.fileName', exp, 'fileName', '');
  }

  return filled;
}
