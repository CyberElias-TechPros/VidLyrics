import type { EdgeConfig, ModelManifestEntry } from './types';

/**
 * The model manifest.
 *
 * It is empty, and that is the correct state for this build: no model weights
 * are bundled or offered yet. Adding a model means adding an entry here with its
 * real licence and real byte size, so the download prompt can tell the user what
 * they are about to fetch. Shipping an entry for a model that is not actually
 * wired up would make the app advertise a capability it does not have.
 */
export const MODELS: ModelManifestEntry[] = [];

export function buildConfig(version: string, metricsEnabled: boolean): EdgeConfig {
  return {
    version,
    models: MODELS,
    metricsEnabled,
    supportUrl: '/support',
    docsUrl: '/guide'
  };
}

/**
 * Resolve a model by id. Returns null for anything unknown, which the router
 * turns into a 404 rather than a pass-through — an unknown id must never become
 * an open proxy to the upstream origin.
 */
export function resolveModel(id: string): ModelManifestEntry | null {
  return MODELS.find((m) => m.id === id) ?? null;
}
