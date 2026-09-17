import { useEditor } from '../../state/store';
import type { Microseconds } from '../../core/time';

/**
 * Timeline drag commands.
 *
 * These translate a pointer position into an edit and enforce two invariants the
 * pointer itself cannot know about: a drag shorter than 1 ms is dropped (it is
 * jitter, not intent), and a line can never be trimmed below the 50 ms minimum
 * readable duration. Both checks live here rather than in the pointer handler so
 * keyboard-driven edits and pointer-driven edits obey the same rules.
 */

export function moveLineBlock(lineId: string, timeUs: Microseconds): void {
  const store = useEditor.getState();
  const line = store.project.lyrics.lines.find((l) => l.id === lineId);
  if (!line) return;
  const delta = timeUs - line.start;
  if (Math.abs(delta) < 1000) return;
  store.moveLineBlock(lineId, delta);
}

export function setLineTime(lineId: string, field: 'start' | 'end', timeUs: Microseconds): void {
  const store = useEditor.getState();
  const line = store.project.lyrics.lines.find((l) => l.id === lineId);
  if (!line) return;
  if (field === 'start' && timeUs >= line.end - 50_000) return;
  if (field === 'end' && timeUs <= line.start + 50_000) return;
  store.setLineTime(lineId, field, timeUs);
}
