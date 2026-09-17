/**
 * Time is a first-class domain type.
 *
 * Every timestamp in the domain layer is an INTEGER number of microseconds.
 * Floating-point seconds are only allowed at the boundary (AudioContext,
 * WebCodecs timestamps, DOM APIs) and are converted here, once.
 *
 * This is what prevents the classic lyric-video bugs:
 *   - cumulative drift when re-quantising repeatedly
 *   - A/V desync from mixed precision
 *   - frame rounding that differs between preview and export
 */

export type Microseconds = number;

export const US_PER_SECOND = 1_000_000;
export const US_PER_MS = 1_000;

export const DEFAULT_FPS = 30;

export function usFromMs(ms: number): Microseconds {
  return Math.round(ms * US_PER_MS);
}

export function usFromSeconds(seconds: number): Microseconds {
  return Math.round(seconds * US_PER_SECOND);
}

export function usToMs(us: Microseconds): number {
  return us / US_PER_MS;
}

export function usToSeconds(us: Microseconds): number {
  return us / US_PER_SECOND;
}

/** Snap a timestamp to the centre of the frame it lands in (deterministic). */
export function snapToFrame(us: Microseconds, fps: number = DEFAULT_FPS): Microseconds {
  const frameUs = Math.round(US_PER_SECOND / fps);
  return Math.round(us / frameUs) * frameUs;
}

export function frameIndex(us: Microseconds, fps: number = DEFAULT_FPS): number {
  const frameUs = US_PER_SECOND / fps;
  return Math.max(0, Math.floor(us / frameUs + 1e-9));
}

export function frameToUs(frame: number, fps: number = DEFAULT_FPS): Microseconds {
  return Math.round((frame * US_PER_SECOND) / fps);
}

export function clampUs(us: Microseconds, min: Microseconds, max: Microseconds): Microseconds {
  return Math.min(max, Math.max(min, us));
}

/** `mm:ss` — used in dense editor chrome. */
export function formatClock(us: Microseconds): string {
  const totalSeconds = Math.floor(usToSeconds(Math.max(0, us)));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** `mm:ss.cs` — centisecond precision, used for the playhead readout. */
export function formatTimecode(us: Microseconds, withFrames = false, fps = DEFAULT_FPS): string {
  const clamped = Math.max(0, us);
  const totalSeconds = Math.floor(clamped / US_PER_SECOND);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (withFrames) {
    const f = frameIndex(clamped, fps);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f % fps).padStart(2, '0')}`;
  }
  const cs = Math.floor((clamped % US_PER_SECOND) / 10_000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** `hh:mm:ss,mmm` — the SRT separator format. */
export function formatSrtTimestamp(us: Microseconds): string {
  const clamped = Math.max(0, us);
  const h = Math.floor(clamped / 3_600_000_000);
  const m = Math.floor(clamped / 60_000_000) % 60;
  const s = Math.floor(clamped / 1_000_000) % 60;
  const ms = Math.floor(clamped / 1_000) % 1_000;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0');
}

/** `hh:mm:ss.mmm` — the WebVTT separator format. */
export function formatVttTimestamp(us: Microseconds): string {
  return formatSrtTimestamp(us).replace(',', '.');
}

/** LRC `[mm:ss.xx]` — hundredths of a second. */
export function formatLrcTimestamp(us: Microseconds): string {
  const clamped = Math.max(0, us);
  const m = Math.floor(clamped / 60_000_000);
  const s = Math.floor(clamped / 1_000_000) % 60;
  const hs = Math.floor(clamped / 10_000) % 100;
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(hs).padStart(2, '0')}]`;
}

/** ASS `h:mm:ss.cc` — centiseconds. */
export function formatAssTimestamp(us: Microseconds): string {
  const clamped = Math.max(0, us);
  const h = Math.floor(clamped / 3_600_000_000);
  const m = Math.floor(clamped / 60_000_000) % 60;
  const s = Math.floor(clamped / 1_000_000) % 60;
  const cs = Math.floor(clamped / 10_000) % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function parseClock(text: string): Microseconds | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const fracRaw = m[4] ?? '0';
  const frac = Number(fracRaw.padEnd(3, '0').slice(0, 3));
  if (min > 59 || sec > 59) return null;
  return (h * 3600 + min * 60 + sec) * US_PER_SECOND + frac * US_PER_MS;
}

/** Human duration string for marketing/support copy. */
export function formatDuration(us: Microseconds): string {
  const total = Math.round(usToSeconds(Math.max(0, us)));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
