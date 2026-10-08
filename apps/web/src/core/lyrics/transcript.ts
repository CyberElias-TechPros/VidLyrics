import type { Microseconds } from '../types';
import { normalizeDisplay } from './normalize';
import { whisperMillisecondsToUs } from '../audio/resample';

export interface TranscriptCue {
  text: string;
  startUs: Microseconds;
  endUs: Microseconds;
}

export interface WhisperSegmentLike {
  text: string;
  /** Milliseconds, as returned by @fugood/node-whisper-wasm 1.2.0-rc.1. */
  t0: number;
  t1: number;
}

/** Convert Whisper segment output into clean, bounded project-time cues. */
export function whisperSegmentsToCues(
  segments: WhisperSegmentLike[],
  durationUs: Microseconds | null = null
): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const segment of segments) {
    const text = normalizeDisplay(segment.text);
    if (!text) continue;
    let startUs = Math.max(0, whisperMillisecondsToUs(segment.t0));
    let endUs = Math.max(startUs, whisperMillisecondsToUs(segment.t1));
    if (durationUs !== null) {
      if (startUs >= durationUs) continue;
      startUs = Math.min(startUs, durationUs);
      endUs = Math.min(Math.max(startUs, endUs), durationUs);
    }
    cues.push({ text, startUs, endUs });
  }
  return cues.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs);
}

/** A fallback cue for a model result that contains text but no segment timing. */
export function untimedTranscriptCue(text: string, durationUs: Microseconds): TranscriptCue | null {
  const clean = normalizeDisplay(text);
  if (!clean) return null;
  return { text: clean, startUs: 0, endUs: Math.max(0, durationUs) };
}
