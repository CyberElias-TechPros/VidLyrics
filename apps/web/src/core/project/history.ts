/**
 * Undo / redo.
 *
 * A command stack over immutable project snapshots would be simple but would
 * make a three-minute song's edit history cost tens of megabytes, so this uses
 * inverse commands instead — with one critical addition: COALESCING.
 *
 * A drag on a timeline block fires hundreds of updates. Without coalescing,
 * undoing that drag means pressing Ctrl+Z several hundred times. Every command
 * therefore carries a `coalesceKey`; consecutive commands sharing a key collapse
 * into a single undoable step, which is what makes the timeline feel like a real
 * editor rather than a toy.
 */

export interface Command<S> {
  /** Shown in the Edit menu and in the tooltip of the undo button. */
  label: string;
  apply: (state: S) => S;
  revert: (state: S) => S;
  /** Consecutive commands with the same key merge into one undo step. */
  coalesceKey?: string;
  /** Merges two commands of the same key into one. */
  merge?: (previous: Command<S>) => Command<S>;
}

export interface HistoryState<S> {
  past: Command<S>[];
  future: Command<S>[];
  limit: number;
}

export function createHistory<S>(limit = 200): HistoryState<S> {
  return { past: [], future: [], limit };
}

export function applyCommand<S>(state: S, history: HistoryState<S>, command: Command<S>): { state: S; history: HistoryState<S> } {
  const next = command.apply(state);
  const last = history.past[history.past.length - 1];

  if (last && command.coalesceKey && last.coalesceKey === command.coalesceKey && command.merge) {
    const merged = command.merge(last);
    return {
      state: next,
      history: { ...history, past: [...history.past.slice(0, -1), merged], future: [] }
    };
  }

  const past = [...history.past, command];
  // Drop the oldest step rather than growing without bound on long sessions.
  if (past.length > history.limit) past.shift();
  return { state: next, history: { ...history, past, future: [] } };
}

/** Apply a batch as ONE undo step. Used for split/merge and bulk retime. */
export function applyBatch<S>(state: S, history: HistoryState<S>, label: string, commands: Command<S>[]): { state: S; history: HistoryState<S> } {
  if (commands.length === 0) return { state, history };
  const batch: Command<S> = {
    label,
    apply: (s) => commands.reduce((acc, c) => c.apply(acc), s),
    revert: (s) => [...commands].reverse().reduce((acc, c) => c.revert(acc), s)
  };
  return applyCommand(state, history, batch);
}

export function undo<S>(state: S, history: HistoryState<S>): { state: S; history: HistoryState<S> } | null {
  const command = history.past[history.past.length - 1];
  if (!command) return null;
  return {
    state: command.revert(state),
    history: { ...history, past: history.past.slice(0, -1), future: [command, ...history.future].slice(0, history.limit) }
  };
}

export function redo<S>(state: S, history: HistoryState<S>): { state: S; history: HistoryState<S> } | null {
  const command = history.future[0];
  if (!command) return null;
  return {
    state: command.apply(state),
    history: { ...history, past: [...history.past, command].slice(-history.limit), future: history.future.slice(1) }
  };
}

export function canUndo<S>(history: HistoryState<S>): boolean {
  return history.past.length > 0;
}

export function canRedo<S>(history: HistoryState<S>): boolean {
  return history.future.length > 0;
}

export function undoLabel<S>(history: HistoryState<S>): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

export function redoLabel<S>(history: HistoryState<S>): string | null {
  return history.future[0]?.label ?? null;
}

/** Clear redo without clearing undo — used when the project is replaced. */
export function resetHistory<S>(limit = 200): HistoryState<S> {
  return createHistory(limit);
}

/* ------------------------- command constructors ------------------------- */

/**
 * Replace the lyric lines wholesale, with an inverse that restores the previous
 * array. This covers most structural edits (split, merge, delete, reorder).
 */
export function linesCommand<S extends { lyrics: { lines: unknown[] } }>(
  label: string,
  before: unknown[],
  after: unknown[],
  coalesceKey?: string
): Command<S> {
  return {
    label,
    coalesceKey,
    apply: (state) => ({ ...state, lyrics: { ...state.lyrics, lines: after as never } }),
    revert: (state) => ({ ...state, lyrics: { ...state.lyrics, lines: before as never } })
  };
}

/** Nudge a single timestamp, coalescing repeated nudges into one step. */
/**
 * Generic over the state shape, like `linesCommand`, so the caller's project
 * type flows through `applyCommand` instead of the command narrowing it to a
 * structural stub.
 */
export function nudgeCommand<S extends { lyrics: { lines: unknown[] } }>(
  label: string,
  lineId: string,
  field: 'start' | 'end',
  deltaUs: number,
  lines: { id: string; start: number; end: number }[]
): Command<S> {
  const before = lines.map((l) => ({ ...l }));
  const after = lines.map((l) => (l.id === lineId ? { ...l, [field]: Math.max(0, l[field] + deltaUs) } : l));
  return {
    label,
    coalesceKey: `nudge:${lineId}:${field}`,
    apply: (state) => ({ ...state, lyrics: { ...state.lyrics, lines: after as never } }),
    revert: (state) => ({ ...state, lyrics: { ...state.lyrics, lines: before as never } }),
    merge: (previous) => ({
      ...previous,
      label,
      apply: (state) => ({ ...state, lyrics: { ...state.lyrics, lines: after as never } })
    })
  };
}
