import { seekTo } from '../../media/session';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/store';
import { decimate } from '../../core/audio/peaks';
import { formatClock, usFromMs, usToMs, type Microseconds } from '../../core/time';
import type { Line } from '../../core/types';
import { moveLineBlock, setLineTime } from './commands';

/**
 * Timeline.
 *
 * The waveform is drawn from a precomputed peak map and decimated to one entry
 * per output pixel, so zooming never triggers a recomputation. Lyric blocks are
 * DOM elements rather than canvas hit regions: they need to be focusable and
 * operable by keyboard, and a canvas-only timeline cannot be used without a
 * mouse.
 *
 * Nothing here animates. A drag moves a block and seeks the playhead; both are
 * direct manipulations, and adding a transition would make the tool feel slow.
 */

type DragMode = { kind: 'none' } | { kind: 'scrub' } | { kind: 'move'; lineId: string; grabOffsetUs: Microseconds } | { kind: 'trim'; lineId: string; edge: 'start' | 'end' };

const TRACK_HEIGHT = 34;
const TRACK_GAP = 4;

export function Timeline() {
  const peaks = useEditor((s) => s.peaks);
  const lines = useEditor((s) => s.project.lyrics.lines);
  const durationUs = useEditor((s) => s.project.audio?.durationUs ?? 0);
  const zoom = useEditor((s) => s.project.ui.zoomPxPerSecond);
  const setZoom = useEditor((s) => s.setZoom);
  const playheadUs = useEditor((s) => s.playheadUs);
  const selectedIds = useEditor((s) => s.selectedIds);
  const toggleLineSelection = useEditor((s) => s.toggleLineSelection);
  const showHeat = useEditor((s) => s.showHeat);
  const loop = useEditor((s) => s.loop);
  const setLoop = useEditor((s) => s.setLoop);
  const beatGrid = useEditor((s) => s.beatGrid);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragMode>({ kind: 'none' });
  const [dragging, setDragging] = useState(false);

  const totalUs = Math.max(durationUs, lines.reduce((max, l) => Math.max(max, l.end), 0), usFromMs(1000));
  const pxPerUs = zoom / 1_000_000;
  const widthPx = Math.max(600, Math.round(usToMs(totalUs) * (zoom / 1000)));

  const sortedLines = useMemo(() => [...lines].sort((a, b) => a.start - b.start), [lines]);

  /* ------------------------- waveform ------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const height = canvas.clientHeight || 72;
    canvas.width = Math.floor(widthPx * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, height);

    if (!peaks) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, height / 2 - 1, widthPx, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText('Import audio to see the waveform', 12, height / 2 - 10);
      return;
    }

    const midY = height / 2;
    const samples = decimate(peaks, 0, totalUs, widthPx);
    const peak = Math.max(0.001, peaks.peakAmplitude);

    ctx.fillStyle = 'rgba(255,180,84,0.75)';
    for (let x = 0; x < samples.length; x += 1) {
      const sample = samples[x];
      if (!sample) continue;
      const top = midY - (Math.abs(sample.max) / peak) * (midY - 2);
      const bottom = midY + (Math.abs(sample.min) / peak) * (midY - 2);
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
    // RMS overlay: the perceived loudness shape, drawn over the transient peaks.
    ctx.fillStyle = 'rgba(139,124,255,0.45)';
    for (let x = 0; x < samples.length; x += 1) {
      const sample = samples[x];
      if (!sample) continue;
      const h = Math.max(1, (sample.rms / peak) * (midY - 2));
      ctx.fillRect(x, midY - h, 1, h * 2);
    }

    if (beatGrid && beatGrid.confidence > 0.25) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (const beat of beatGrid.beats) {
        const x = Math.round(beat * pxPerUs);
        if (x > widthPx) break;
        ctx.fillRect(x, 0, 1, height);
      }
    }
  }, [peaks, widthPx, totalUs, pxPerUs, beatGrid]);

  /* ------------------------- interactions ------------------------- */

  const timeFromClientX = useCallback(
    (clientX: number): Microseconds => {
      const host = scrollRef.current;
      if (!host) return 0;
      const rect = host.getBoundingClientRect();
      const x = clientX - rect.left + host.scrollLeft;
      return Math.max(0, Math.min(totalUs, x / pxPerUs));
    },
    [pxPerUs, totalUs]
  );

  const onPointerDown = (event: React.PointerEvent) => {
    const host = scrollRef.current;
    if (!host) return;
    host.setPointerCapture(event.pointerId);
    dragRef.current = { kind: 'scrub' };
    setDragging(true);
    seekTo(timeFromClientX(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const mode = dragRef.current;
    if (mode.kind === 'none') return;
    const timeUs = timeFromClientX(event.clientX);
    if (mode.kind === 'scrub') {
      seekTo(timeUs);
      return;
    }
    if (mode.kind === 'move') {
      moveLineBlock(mode.lineId, timeUs - mode.grabOffsetUs);
      return;
    }
    if (mode.kind === 'trim') {
      setLineTime(mode.lineId, mode.edge, timeUs);
    }
  };

  const endDrag = (event: React.PointerEvent) => {
    const host = scrollRef.current;
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    dragRef.current = { kind: 'none' };
    setDragging(false);
  };

  const startLineDrag = (event: React.PointerEvent, line: Line, edge?: 'start' | 'end') => {
    event.stopPropagation();
    const host = scrollRef.current;
    if (host) host.setPointerCapture(event.pointerId);
    const timeUs = timeFromClientX(event.clientX);
    dragRef.current = edge
      ? { kind: 'trim', lineId: line.id, edge }
      : { kind: 'move', lineId: line.id, grabOffsetUs: timeUs - line.start };
    setDragging(true);
    toggleLineSelection(line.id, event.shiftKey);
    seekTo(Math.max(line.start, Math.min(line.end, timeUs)));
  };

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom * (event.deltaY > 0 ? 0.88 : 1.14));
    };
    const host = scrollRef.current;
    host?.addEventListener('wheel', onWheel, { passive: false });
    return () => host?.removeEventListener('wheel', onWheel);
  }, [zoom, setZoom]);

  // Keep the playhead in view while playing, without hijacking manual scrolls.
  useEffect(() => {
    const host = scrollRef.current;
    if (!host || dragging) return;
    const x = playheadUs * pxPerUs;
    if (x < host.scrollLeft || x > host.scrollLeft + host.clientWidth - 80) {
      host.scrollLeft = Math.max(0, x - host.clientWidth * 0.35);
    }
  }, [playheadUs, pxPerUs, dragging]);

  const rulerTicks = useMemo(() => {
    const ticks: { us: Microseconds; major: boolean }[] = [];
    const stepSec = zoom > 300 ? 1 : zoom > 120 ? 5 : zoom > 40 ? 10 : zoom > 12 ? 30 : 60;
    for (let t = 0; t <= totalUs; t += stepSec * 1_000_000) {
      ticks.push({ us: t, major: Math.round(t / 1_000_000) % (stepSec * 5) === 0 });
    }
    return ticks;
  }, [zoom, totalUs]);

  const laneCount = Math.max(1, Math.ceil(sortedLines.length / 40) || 1);
  void laneCount;
  void loop;
  void setLoop;

  return (
    <div className="ed-timeline" role="group" aria-label="Timeline">
      <div className="ed-timeline-bar">
        <span className="mono">ZOOM</span>
        <input
          className="ed-scrub"
          type="range"
          min={4}
          max={1200}
          step={2}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Timeline zoom, pixels per second"
          style={{ width: 120 }}
        />
        <span className="mono">{zoom}px/s</span>
        <span aria-hidden="true">·</span>
        <span className="mono">{formatClock(totalUs)}</span>
        <span aria-hidden="true">·</span>
        <span>{sortedLines.length} lines</span>
        {beatGrid ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="mono">
              {Math.round(beatGrid.bpm)} BPM ({Math.round(beatGrid.confidence * 100)}%)
            </span>
          </>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        style={{ position: 'relative', overflowX: 'auto', overflowY: 'auto', minHeight: 0 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div style={{ position: 'relative', width: widthPx, minHeight: '100%' }}>
          {/* Ruler */}
          <div style={{ position: 'relative', height: 20, borderBottom: '1px solid var(--line)' }}>
            {rulerTicks.map((tick) => (
              <div
                key={tick.us}
                style={{
                  position: 'absolute',
                  left: tick.us * pxPerUs,
                  top: 0,
                  bottom: 0,
                  borderLeft: `1px solid ${tick.major ? 'var(--line-strong)' : 'var(--line)'}`,
                  paddingLeft: 4,
                  fontSize: 9,
                  color: tick.major ? 'var(--text-faint)' : 'transparent',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap'
                }}
              >
                {formatClock(tick.us)}
              </div>
            ))}
          </div>

          <canvas ref={canvasRef} style={{ display: 'block', width: widthPx, height: 72 }} aria-hidden="true" />

          {/* Lyric blocks */}
          <div style={{ position: 'relative', padding: '4px 0' }}>
            {sortedLines.map((line, index) => {
              const left = line.start * pxPerUs;
              const width = Math.max(6, (line.end - line.start) * pxPerUs);
              const conf = line.words.length === 0 ? (line.source === 'human' || line.source === 'tap' ? 'high' : 'low') : line.words.reduce((min, w) => Math.min(min, w.confidence), 1) > 0.7 ? 'high' : line.words.reduce((min, w) => Math.min(min, w.confidence), 1) > 0.35 ? 'mid' : 'low';
              const isCurrent = playheadUs >= line.start && playheadUs <= line.end;
              return (
                <div
                  key={line.id}
                  className="ed-block"
                  data-selected={selectedIds.includes(line.id) ? 'true' : 'false'}
                  data-current={isCurrent ? 'true' : 'false'}
                  data-conf={showHeat ? conf : undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={`${line.text || 'empty line'}, ${formatClock(line.start)} to ${formatClock(line.end)}`}
                  style={{
                    left,
                    width,
                    top: (index % 3) * (TRACK_HEIGHT + TRACK_GAP),
                    height: TRACK_HEIGHT,
                    lineHeight: `${TRACK_HEIGHT - 4}px`
                  }}
                  onPointerDown={(e) => startLineDrag(e, line)}
                  onFocus={() => toggleLineSelection(line.id, false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      seekTo(line.start);
                    }
                  }}
                >
                  <span className="ed-block-handle left" onPointerDown={(e) => startLineDrag(e, line, 'start')} aria-hidden="true" />
                  {line.text || <em style={{ opacity: 0.4 }}>empty</em>}
                  <span className="ed-block-handle right" onPointerDown={(e) => startLineDrag(e, line, 'end')} aria-hidden="true" />
                </div>
              );
            })}
            <div style={{ height: 3 * (TRACK_HEIGHT + TRACK_GAP) }} />
          </div>

          {/* Playhead */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: playheadUs * pxPerUs,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--playhead)',
              pointerEvents: 'none',
              boxShadow: '0 0 8px rgba(255,107,129,0.8)'
            }}
          />
        </div>
      </div>
    </div>
  );
}
