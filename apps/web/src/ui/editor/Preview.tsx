import { useEffect, useMemo, useRef } from 'react';
import { useEditor } from '../../state/store';
import { buildScene } from '../../core/render/scene';
import { renderFrame } from '../../core/render/frame';
import { createMeasureFn } from '../../media/canvasMeasurer';
import { useDevicePixelRatio, useRafLoop } from '../../lib/hooks';
import { compositionSize } from '../../core/render/scene';
import { formatTimecode } from '../../core/time';

/**
 * Live preview.
 *
 * Calls the SAME renderFrame the exporter calls, against a scene built from the
 * same project. There is no second rendering implementation anywhere in the app,
 * which is the only way to guarantee the exported file matches what was seen.
 *
 * Redraw is driven by requestAnimationFrame and never by React state: the
 * playhead moves 60 times a second and re-rendering the component tree at that
 * rate is how editors get laggy.
 */
export function Preview() {
  const project = useEditor((s) => s.project);
  const spectrum = useEditor((s) => s.spectrum);
  const beatGrid = useEditor((s) => s.beatGrid);
  const playheadUs = useEditor((s) => s.playheadUs);
  const playing = useEditor((s) => s.playing);
  const showGuides = useEditor((s) => s.showGuides);
  const showHeat = useEditor((s) => s.showHeat);
  const dpr = useDevicePixelRatio();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef(playheadUs);
  playheadRef.current = playheadUs;

  const { width, height } = compositionSize(project.design);
  const scene = useMemo(
    () =>
      buildScene(project, {
        spectrum,
        beatGrid,
        pixelRatio: 1,
        durationUs: project.audio?.durationUs ?? null
      }),
    [project, spectrum, beatGrid]
  );

  const measure = useMemo(() => createMeasureFn(project.design.typography.fontStack), [project.design.typography.fontStack]);

  // Paint once whenever something other than the playhead changes, so a scrub
  // that does not move the playhead (a text edit, say) still refreshes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    renderFrame(ctx, scene, playheadRef.current, { measure, showGuides, showHeat });
  }, [scene, measure, showGuides, showHeat, width, height]);

  // Size the backing store to the composition, scaled for the display.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
  }, [width, height]);

  useRafLoop(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    renderFrame(ctx, scene, playheadRef.current, { measure, showGuides, showHeat });
  }, playing);

  void dpr;

  return (
    <div className="ed-preview">
      <canvas
        ref={canvasRef}
        className="ed-preview-canvas"
        style={{ aspectRatio: `${width} / ${height}`, width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
        role="img"
        aria-label={`Composition preview, ${width} by ${height} pixels`}
      />
      <div className="ed-preview-overlay">
        <span>{width}×{height}</span>
        <span aria-hidden="true">·</span>
        <span>{project.export.fps} fps</span>
        <span aria-hidden="true">·</span>
        <span className="mono">{formatTimecode(playheadUs)}</span>
      </div>
    </div>
  );
}
