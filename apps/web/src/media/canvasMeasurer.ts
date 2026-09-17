import type { Measurer } from '../core/render/layout';
import type { MeasureFn } from '../core/render/frame';

/**
 * Canvas-backed text measurer.
 *
 * Cached per (font, letterSpacing) because `measureText` is the single hottest
 * call in the render loop: layout runs for every visible line on every frame,
 * and an uncached measurer turns a 60 fps preview into a 20 fps one.
 *
 * `createMeasureFn` is the only entry point the renderer uses; a bare measurer
 * has no font context and would silently measure every line at one size.
 *
 * The cache is bounded. An unbounded Map here would grow for the lifetime of the
 * tab as themes and font sizes change.
 */

const MAX_ENTRIES = 4096;

/**
 * Build a `MeasureFn` for the renderer.
 *
 * One canvas context is reused and one measurer is memoised per font string, so
 * a preview at 60 fps sets `ctx.font` only when the font actually changes.
 */
export function createMeasureFn(fontStack: string): MeasureFn {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(8, 8)
    : document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  const byFont = new Map<string, Measurer>();

  return (fontSizePx, weight, letterSpacingPx) => {
    const font = `${weight} ${Math.round(fontSizePx)}px ${fontStack}`;
    const key = `${font}|${letterSpacingPx}`;
    const existing = byFont.get(key);
    if (existing) return existing;

    if (!ctx) return { width: (text: string) => text.length * fontSizePx * 0.52 + letterSpacingPx * Math.max(0, text.length - 1) };

    const cache = new Map<string, number>();
    const measurer: Measurer = {
      width(text: string) {
        const cached = cache.get(text);
        if (cached !== undefined) return cached;
        if (ctx.font !== font) ctx.font = font;
        let width = ctx.measureText(text).width;
        if (letterSpacingPx !== 0) width += letterSpacingPx * Math.max(0, text.length - 1);
        if (cache.size >= MAX_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(text, width);
        return width;
      }
    };
    if (byFont.size >= 64) byFont.clear();
    byFont.set(key, measurer);
    return measurer;
  };
}
