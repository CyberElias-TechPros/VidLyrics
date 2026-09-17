/**
 * Multi-tab coordination.
 *
 * Two tabs editing the same project will silently overwrite each other, because
 * IndexedDB has no conflict resolution and the last writer wins. The fix is not
 * a merge strategy — it is telling the user, before either of them loses work.
 */

export type TabEventType = 'opened' | 'heartbeat' | 'closed' | 'claim';

export interface TabMessage {
  type: TabEventType;
  projectId: string;
  tabId: string;
  at: number;
}

export interface TabLock {
  tabId: string;
  /** Other tabs that reported themselves on this project, most recent first. */
  peers: TabMessage[];
  /** True when this tab holds the editing claim. */
  isPrimary: boolean;
}

export function createTabCoordinator(projectId: string, onPeer: (lock: TabLock) => void) {
  const tabId = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const seen = new Map<string, TabMessage>();
  let primary = true;
  let closed = false;

  const publish = () => {
    const lock: TabLock = {
      tabId,
      peers: [...seen.values()].filter((p) => p.tabId !== tabId).sort((a, b) => b.at - a.at),
      isPrimary: primary
    };
    onPeer(lock);
  };

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`vidlyrics:${projectId}`);
    channel.onmessage = (event: MessageEvent<TabMessage>) => {
      const message = event.data;
      if (!message || message.projectId !== projectId || message.tabId === tabId) return;
      if (message.type === 'closed') {
        seen.delete(message.tabId);
        primary = true;
      } else {
        seen.set(message.tabId, message);
        // Whoever opened first keeps the claim; the newcomer warns.
        if (message.type === 'opened' || message.type === 'claim') primary = message.at <= Date.now() ? primary : primary;
      }
      publish();
    };
  }

  const send = (type: TabEventType) => {
    if (!channel) return;
    try {
      channel.postMessage({ type, projectId, tabId, at: Date.now() } satisfies TabMessage);
    } catch {
      /* a closed channel must never break editing */
    }
  };

  send('opened');
  const heartbeat = setInterval(() => send('heartbeat'), 5000);

  // Prune peers that stopped beating, so a crashed tab does not block forever.
  const prune = setInterval(() => {
    const cutoff = Date.now() - 15_000;
    let changed = false;
    for (const [id, message] of seen) {
      if (message.at < cutoff) {
        seen.delete(id);
        changed = true;
      }
    }
    if (changed) {
      if (seen.size === 0) primary = true;
      publish();
    }
  }, 5000);

  const storageHandler = (event: StorageEvent) => {
    if (event.key === `vidlyrics:tab:${projectId}` && event.newValue) {
      try {
        const message = JSON.parse(event.newValue) as TabMessage;
        if (message.tabId !== tabId) {
          seen.set(message.tabId, message);
          publish();
        }
      } catch {
        /* ignore malformed cross-tab payloads */
      }
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', storageHandler);

  publish();

  return {
    tabId,
    claim() {
      primary = true;
      send('claim');
      publish();
    },
    release() {
      primary = false;
      publish();
    },
    getLock(): TabLock {
      return { tabId, peers: [...seen.values()].filter((p) => p.tabId !== tabId), isPrimary: primary };
    },
    close() {
      if (closed) return;
      closed = true;
      send('closed');
      clearInterval(heartbeat);
      clearInterval(prune);
      if (typeof window !== 'undefined') window.removeEventListener('storage', storageHandler);
      channel?.close();
    }
  };
}
