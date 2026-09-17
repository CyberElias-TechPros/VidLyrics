/**
 * IndexedDB access.
 *
 * Deliberately a thin, hand-rolled wrapper rather than a dependency: the whole
 * persistence layer is under 200 lines, and every error path has to be handled
 * specifically anyway (quota exceeded, Safari private mode, blocked upgrades).
 */

export const DB_NAME = 'vidlyrics';
export const DB_VERSION = 1;
export const STORE_PROJECTS = 'projects';
export const STORE_ASSETS = 'assets';
export const STORE_META = 'meta';

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export class StorageQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageUnavailableError('IndexedDB is not available in this browser context.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('title', 'meta.title');
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const assets = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        assets.createIndex('contentHash', 'contentHash');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageUnavailableError(request.error?.message ?? 'Could not open IndexedDB.'));
    request.onblocked = () => reject(new StorageUnavailableError('Another tab is holding the database open at an older version.'));
  });
  return dbPromise;
}

function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || name === 'ConstraintError';
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = handler(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (isQuotaError(request.error)) reject(new StorageQuotaError('Browser storage is full.'));
      else reject(request.error ?? new Error('IndexedDB request failed.'));
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => {
      if (isQuotaError(transaction.error)) reject(new StorageQuotaError('Browser storage is full.'));
      else reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    };
  });
}

export function idbPut<T>(storeName: string, value: T): Promise<IDBValidKey> {
  return run(storeName, 'readwrite', (store) => store.put(value as unknown as Record<string, unknown>) as IDBRequest<IDBValidKey>);
}

export function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(storeName, 'readonly', (store) => store.get(key) as IDBRequest<T | undefined>);
}

export function idbDelete(storeName: string, key: IDBValidKey): Promise<undefined> {
  return run(storeName, 'readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
}

export function idbGetAll<T>(storeName: string): Promise<T[]> {
  return run<T[]>(storeName, 'readonly', (store) => store.getAll() as IDBRequest<T[]>);
}

export function idbClear(storeName: string): Promise<undefined> {
  return run(storeName, 'readwrite', (store) => store.clear() as IDBRequest<undefined>);
}

export async function idbCount(storeName: string): Promise<number> {
  return run<number>(storeName, 'readonly', (store) => store.count() as IDBRequest<number>);
}

/** Index lookup, used to find an asset by content hash for dedupe. */
export function idbGetByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(storeName, 'readonly', (store) => store.index(indexName).get(value) as IDBRequest<T | undefined>);
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usageBytes: usage, quotaBytes: quota, percentUsed: quota > 0 ? usage / quota : 0 };
  } catch {
    return null;
  }
}

/** Ask for persistent storage so the browser does not evict projects under pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
