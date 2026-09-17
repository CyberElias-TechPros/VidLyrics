import { describe, it, expect } from 'vitest';
import {
  usFromMs, usFromSeconds, usToMs, formatClock, formatTimecode, formatSrtTimestamp,
  formatVttTimestamp, formatLrcTimestamp, formatAssTimestamp, parseClock,
  snapToFrame, frameToUs, frameIndex
} from '../src/core/time';

describe('time domain type', () => {
  it('converts milliseconds and seconds without drift', () => {
    expect(usFromMs(1)).toBe(1000);
    expect(usFromSeconds(1)).toBe(1_000_000);
    expect(usToMs(1_500_000)).toBe(1500);
    // Repeated conversion must not accumulate error.
    let t = 0;
    for (let i = 0; i < 1000; i += 1) t = usFromMs(usToMs(t) + 1);
    expect(t).toBe(1_000_000);
  });

  it('formats every export timestamp format correctly', () => {
    const t = usFromSeconds(3723) + usFromMs(456);
    expect(formatClock(t)).toBe('62:03');
    expect(formatTimecode(t)).toBe('62:03.45');
    expect(formatSrtTimestamp(t)).toBe('01:02:03,456');
    expect(formatVttTimestamp(t)).toBe('01:02:03.456');
    expect(formatAssTimestamp(t)).toBe('1:02:03.45');
  });

  it('formats LRC to hundredths', () => {
    expect(formatLrcTimestamp(usFromMs(75_430))).toBe('[01:15.43]');
  });

  it('parses clock strings back to microseconds', () => {
    expect(parseClock('01:02:03,456')).toBe(usFromSeconds(3723) + usFromMs(456));
    expect(parseClock('00:00:01.000')).toBe(1_000_000);
    expect(parseClock('not a time')).toBeNull();
    expect(parseClock('00:99:00,000')).toBeNull();
  });

  it('snaps to frames deterministically', () => {
    const frame = Math.round(1_000_000 / 30);
    expect(snapToFrame(0, 30)).toBe(0);
    expect(snapToFrame(frame, 30)).toBe(frame);
    expect(snapToFrame(frame + 1000, 30)).toBe(frame);
    expect(frameToUs(frameIndex(usFromSeconds(1), 30), 30)).toBeLessThanOrEqual(usFromSeconds(1));
  });

  it('never produces negative timestamps from parsing', () => {
    expect(formatSrtTimestamp(-5)).toBe('00:00:00,000');
    expect(formatLrcTimestamp(-1)).toBe('[00:00.00]');
  });
});
