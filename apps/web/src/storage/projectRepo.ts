import type { AssetRecord, Project } from '../core/types';
import { idbDelete, idbGet, idbGetAll, idbGetByIndex, idbPut, STORE_ASSETS, STORE_PROJECTS, StorageQuotaError } from './idb';

/**
 * Project repository.
 *
 * Local-first: the project lives in IndexedDB and the user never needs an
 * account. Audio is stored as a separate asset keyed by content hash so that
 * re-importing the same song, or cloning a project, does not duplicate it.
 */

export interface StoredProject {
  id: string;
  project: Project;
  updatedAt: number;
  /** Set when the referenced audio asset is missing (e.g. after storage eviction). */
  audioMissing: boolean;
}

export interface ProjectSummary {
  id: string;
  title: string;
  artist: string;
  updatedAt: number;
  lineCount: number;
  hasAudio: boolean;
  audioMissing: boolean;
  durationUs: number;
  themeId: string;
}

function summarise(stored: StoredProject): ProjectSummary {
  const project = stored.project;
  return {
    id: project.id,
    title: project.meta.title || 'Untitled project',
    artist: project.meta.artist,
    updatedAt: stored.updatedAt,
    lineCount: project.lyrics.lines.length,
    hasAudio: project.audio !== null,
    audioMissing: stored.audioMissing,
    durationUs: project.audio?.durationUs ?? 0,
    themeId: project.design.themeId
  };
}

export async function saveProject(project: Project): Promise<void> {
  const updated: Project = { ...project, updatedAt: Date.now() };
  const audioMissing = updated.audio ? !(await getAsset(updated.audio.assetId)) : false;
  await idbPut(STORE_PROJECTS, { id: updated.id, project: updated, updatedAt: updated.updatedAt, audioMissing });
}

export async function loadProject(id: string): Promise<{ project: Project; audioMissing: boolean } | null> {
  const stored = await idbGet<StoredProject>(STORE_PROJECTS, id);
  if (!stored?.project) return null;
  const audioMissing = stored.project.audio ? !(await getAsset(stored.project.audio.assetId)) : false;
  return { project: stored.project, audioMissing };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await idbGetAll<StoredProject>(STORE_PROJECTS);
  return all
    .filter((s) => s?.project)
    .map(summarise)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id);
}

export async function saveAsset(record: AssetRecord, payload: Blob | ArrayBuffer): Promise<AssetRecord> {
  // Content-hash dedupe: the same song imported twice is stored once.
  const existing = await idbGetByIndex<{ record: AssetRecord }>(STORE_ASSETS, 'contentHash', record.contentHash);
  if (existing?.record) return existing.record;
  await idbPut(STORE_ASSETS, { record, payload });
  return record;
}

export async function getAsset(id: string): Promise<{ record: AssetRecord; payload: Blob | ArrayBuffer } | undefined> {
  return idbGet<{ record: AssetRecord; payload: Blob | ArrayBuffer }>(STORE_ASSETS, id);
}

export async function getAssetPayload(id: string): Promise<Blob | ArrayBuffer | undefined> {
  const entry = await getAsset(id);
  return entry?.payload;
}

export async function listAssets(): Promise<AssetRecord[]> {
  const all = await idbGetAll<{ record: AssetRecord }>(STORE_ASSETS);
  return all.map((a) => a.record).filter(Boolean);
}

export async function deleteAsset(id: string): Promise<void> {
  await idbDelete(STORE_ASSETS, id);
}

/**
 * Remove assets no project references. Called after a project is deleted, so a
 * user clearing out old work actually reclaims the space.
 */
export async function garbageCollectAssets(): Promise<number> {
  const projects = await idbGetAll<StoredProject>(STORE_PROJECTS);
  const referenced = new Set<string>();
  for (const stored of projects) {
    const audio = stored?.project?.audio;
    if (audio) {
      referenced.add(audio.assetId);
      referenced.add(audio.peaksAssetId);
    }
    const voiceover = stored?.project?.voiceover;
    if (voiceover) referenced.add(voiceover.assetId);
    const bg = stored?.project?.design?.background;
    if (bg?.assetId) referenced.add(bg.assetId);
    const logo = stored?.project?.design?.brand?.logoAssetId;
    if (logo) referenced.add(logo);
  }
  const assets = await listAssets();
  let removed = 0;
  for (const asset of assets) {
    if (!referenced.has(asset.id)) {
      await deleteAsset(asset.id);
      removed += 1;
    }
  }
  return removed;
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof StorageQuotaError;
}

/**
 * Autosave scheduling.
 *
 * Debounced and coalesced: a drag that changes timing sixty times per second
 * must not produce sixty IndexedDB writes. The trailing write is what makes
 * crash recovery honest — the state on disk is always the last settled state.
 */
export function createAutosaver(projectId: () => string, getProject: () => Project | null, intervalMs = 2500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let writing = false;
  let lastError: unknown = null;

  const flush = async () => {
    if (writing || !dirty) return;
    writing = true;
    try {
      const project = getProject();
      if (project) await saveProject(project);
      dirty = false;
      lastError = null;
    } catch (error) {
      lastError = error;
    } finally {
      writing = false;
    }
  };

  return {
    markDirty() {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), intervalMs);
    },
    async flushNow() {
      if (timer) clearTimeout(timer);
      timer = null;
      await flush();
    },
    get lastError() {
      return lastError;
    },
    get isDirty() {
      return dirty;
    },
    get projectId() {
      return projectId();
    }
  };
}
