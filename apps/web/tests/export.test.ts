import { describe, it, expect } from 'vitest';
import { avcCodecString, videoCodecString } from '../src/media/export/encoder';
import {
  EXPORT_PRESETS,
  estimateOutputBytes,
  estimateRender,
  exportSettingsFromPreset,
  formatBytes,
  getExportPreset,
  validateExportSettings
} from '../src/core/design/tokens';
import { usFromSeconds } from '../src/core/time';
import type { ExportSettings } from '../src/core/types';

/**
 * The codec string and the size estimate are both shown to the user before a
 * render starts, and both feed the encoder directly. A wrong codec string is not
 * a cosmetic difference: `VideoEncoder.isConfigSupported` rejects it and the
 * export fails at frame zero, after the user has already waited.
 *
 * The expected values below are derived independently from H.264 Annex A
 * (Tables A-1 and A-6) rather than from the implementation, so a regression in
 * the level table shows up as a mismatch instead of as a silently accepted
 * change to both sides.
 *
 * Level limits used, in luma samples (one macroblock = 256 samples):
 *   3.0  0x1e  1_620 MB  /  40_500 MB/s
 *   3.1  0x1f  3_600 MB  / 108_000 MB/s
 *   3.2  0x20  5_120 MB  / 216_000 MB/s
 *   4.0  0x28  8_192 MB  / 245_760 MB/s
 *   4.1  0x29  8_192 MB  / 245_760 MB/s
 *   4.2  0x2a  8_704 MB  / 522_240 MB/s
 *   5.0  0x32 22_080 MB  / 589_824 MB/s
 *   5.1  0x33 36_864 MB  / 983_040 MB/s
 *   5.2  0x34 36_864 MB  / 2_073_600 MB/s
 */

/** Reference implementation, straight from the spec tables. */
function referenceLevel(width: number, height: number, fps: number): number {
  const mb = Math.ceil(width / 16) * Math.ceil(height / 16);
  const frameSamples = mb * 256;
  const lumaPerSecond = frameSamples * fps;
  const table: [id: number, maxFsMb: number, maxMbps: number][] = [
    [0x1e, 1_620, 40_500], [0x1f, 3_600, 108_000], [0x20, 5_120, 216_000],
    [0x28, 8_192, 245_760], [0x29, 8_192, 245_760], [0x2a, 8_704, 522_240],
    [0x32, 22_080, 589_824], [0x33, 36_864, 983_040], [0x34, 36_864, 2_073_600]
  ];
  const match = table.find((entry) => entry[1] * 256 >= frameSamples && entry[2] * 256 >= lumaPerSecond);
  return match ? match[0] : 0x34;
}

function settings(overrides: Partial<ExportSettings> = {}): ExportSettings {
  return {
    presetId: 'youtube',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 8_000_000,
    codec: 'h264',
    audioBitrate: 192_000,
    globalOffsetUs: 0,
    rangeStartUs: 0,
    rangeEndUs: usFromSeconds(180),
    includeAudio: true,
    fileName: 'song.mp4',
    ...overrides
  };
}

describe('avcCodecString', () => {
  it('emits the canonical strings for the resolutions the app actually ships', () => {
    // 1080p30: 8160 MB, 2_088_960 samples/frame, 62_668_800 luma/s -> level 4.0
    expect(avcCodecString(1920, 1080, 30)).toBe('avc1.640028');
    // Portrait video has the same macroblock count as landscape 1080p.
    expect(avcCodecString(1080, 1920, 30)).toBe('avc1.640028');
    // 720p30 sits exactly on the level 3.1 ceiling, not above it.
    expect(avcCodecString(1280, 720, 30)).toBe('avc1.64001f');
    // 1080p60 exceeds level 4.0's luma rate and must step up to 4.2.
    expect(avcCodecString(1920, 1080, 60)).toBe('avc1.64002a');
    // 4K30 needs level 5.1.
    expect(avcCodecString(3840, 2160, 30)).toBe('avc1.640033');
    // 1:1 1080 is between 720p and 1080p.
    expect(avcCodecString(1080, 1080, 30)).toBe('avc1.640020');
    // 4:5 portrait.
    expect(avcCodecString(1080, 1350, 30)).toBe('avc1.640028');
  });

  it('matches the spec tables across every preset and frame rate', () => {
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    for (const preset of EXPORT_PRESETS) {
      for (const fps of [12, 24, 25, 30, 48, 50, 60]) {
        const expected = `avc1.6400${hex(referenceLevel(preset.width, preset.height, fps))}`;
        expect(avcCodecString(preset.width, preset.height, fps)).toBe(expected);
      }
    }
  });

  it('uses the documented profile and constraint bytes', () => {
    expect(avcCodecString(1280, 720, 30, 'baseline')).toBe('avc1.42e01f');
    expect(avcCodecString(1280, 720, 30, 'main')).toBe('avc1.4d401f');
    expect(avcCodecString(1280, 720, 30, 'high')).toBe('avc1.64001f');
  });

  it('always produces a well-formed avc1.PPCCLL string', () => {
    const cases: [number, number, number][] = [
      [16, 16, 12], [128, 128, 30], [1921, 1081, 30], [7680, 4320, 30], [8192, 8192, 60]
    ];
    for (const [w, h, fps] of cases) {
      expect(avcCodecString(w, h, fps)).toMatch(/^avc1\.[0-9a-f]{6}$/);
    }
  });

  it('never decreases the level as resolution or frame rate increases', () => {
    const levels = [240, 480, 720, 1080, 1440, 2160, 4320].map((h) => {
      const w = Math.round((h * 16) / 9 / 2) * 2;
      return Number.parseInt(avcCodecString(w, h, 30).slice(-2), 16);
    });
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]!);
    }
  });

  it('returns the platform codec strings for the other codecs', () => {
    expect(videoCodecString('h264', 1920, 1080, 30)).toBe('avc1.640028');
    expect(videoCodecString('vp9', 1920, 1080, 30)).toBe('vp09.00.10.08');
    expect(videoCodecString('av1', 1920, 1080, 30)).toBe('av01.0.08M.08');
  });
});

describe('estimateOutputBytes', () => {
  it('is exact bitrate arithmetic, not a guess', () => {
    const s = settings({ rangeEndUs: usFromSeconds(100), videoBitrate: 8_000_000, audioBitrate: 192_000 });
    // (100 s * 8_000_000 + 100 s * 192_000) / 8 = 102_400_000 bytes
    expect(estimateOutputBytes(s)).toBe(102_400_000);
  });

  it('excludes audio when the export is video only', () => {
    const s = settings({ rangeEndUs: usFromSeconds(100), includeAudio: false });
    expect(estimateOutputBytes(s)).toBe(100_000_000);
  });

  it('scales with the trim range, not the whole track', () => {
    const full = estimateOutputBytes(settings());
    const half = estimateOutputBytes(settings({ rangeEndUs: usFromSeconds(90) }));
    expect(half).toBe(Math.round(full / 2));
  });

  it('estimates zero rather than a negative size for an empty or inverted range', () => {
    expect(estimateOutputBytes(settings({ rangeStartUs: usFromSeconds(60), rangeEndUs: usFromSeconds(60) }))).toBe(0);
    expect(estimateOutputBytes(settings({ rangeStartUs: usFromSeconds(60), rangeEndUs: usFromSeconds(30) }))).toBe(0);
  });
});

describe('estimateRender', () => {
  it('reports an exact frame count and a conservative ETA', () => {
    const r = estimateRender(settings({ rangeEndUs: usFromSeconds(180), fps: 30 }));
    expect(r.frames).toBe(5400);
    // 3x realtime by default: never promise the user a faster machine than they have.
    expect(r.etaSeconds).toBe(540);
  });

  it('reports no frames for an empty range', () => {
    expect(estimateRender(settings({ rangeStartUs: usFromSeconds(10), rangeEndUs: usFromSeconds(10) })).frames).toBe(0);
  });
});

describe('validateExportSettings', () => {
  it('accepts a normal 1080p export', () => {
    expect(validateExportSettings(settings())).toEqual([]);
  });

  it('rejects odd dimensions, which H.264 cannot encode', () => {
    const errors = validateExportSettings(settings({ width: 1921 }));
    expect(errors.some((e) => e.includes('even'))).toBe(true);
  });

  it('rejects frame rates outside 12-60', () => {
    expect(validateExportSettings(settings({ fps: 11 })).length).toBeGreaterThan(0);
    expect(validateExportSettings(settings({ fps: 61 })).length).toBeGreaterThan(0);
    expect(validateExportSettings(settings({ fps: 12 }))).toEqual([]);
    expect(validateExportSettings(settings({ fps: 60 }))).toEqual([]);
  });

  it('rejects bitrates that cannot work', () => {
    expect(validateExportSettings(settings({ videoBitrate: 100_000 })).length).toBeGreaterThan(0);
    expect(validateExportSettings(settings({ videoBitrate: 80_000_000 })).length).toBeGreaterThan(0);
    expect(validateExportSettings(settings({ audioBitrate: 32_000 })).length).toBeGreaterThan(0);
  });

  it('rejects an empty or inverted range before the render starts', () => {
    const errors = validateExportSettings(settings({ rangeStartUs: usFromSeconds(60), rangeEndUs: usFromSeconds(60) }));
    expect(errors.some((e) => e.includes('range'))).toBe(true);
  });

  it('reports every problem at once rather than one at a time', () => {
    const errors = validateExportSettings(
      settings({ width: 1921, height: 1081, fps: 200, videoBitrate: 1000, rangeStartUs: usFromSeconds(10), rangeEndUs: usFromSeconds(5) })
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('shipped presets', () => {
  it('never offers a preset that fails its own validator', () => {
    for (const preset of EXPORT_PRESETS) {
      const s = exportSettingsFromPreset(preset.id, usFromSeconds(180));
      expect(validateExportSettings(s), `preset ${preset.id}`).toEqual([]);
    }
  });

  it('resolves every preset by id, and falls back rather than throwing', () => {
    for (const preset of EXPORT_PRESETS) expect(getExportPreset(preset.id).id).toBe(preset.id);
    expect(getExportPreset('does-not-exist').id).toBe(EXPORT_PRESETS[0]!.id);
  });

  it('uses even dimensions throughout, since H.264 requires it', () => {
    for (const preset of EXPORT_PRESETS) {
      expect(preset.width % 2, `width of ${preset.id}`).toBe(0);
      expect(preset.height % 2, `height of ${preset.id}`).toBe(0);
    }
  });
});

describe('formatBytes', () => {
  it('formats across the unit boundaries', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(15 * 1024)).toBe('15 KB');
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB');
  });

  it('never reports NaN or Infinity to the user', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});
