import { describe, expect, it, vi } from 'vitest';
import {
  VIDEO_SPEC_VERSION,
  isVideoSpecJson,
  parseVideoSpecJson,
  type VideoSpec
} from '../src/core/spec/schema';
import { compileVideoSpec, projectToVideoSpec, serialiseVideoSpec } from '../src/core/spec/compiler';
import { SCENE_SNIPPETS, VIDEO_TEMPLATES, buildAiSpecPrompt } from '../src/core/spec/templates';
import { buildScene, totalDuration } from '../src/core/render/scene';
import { computeFrameState, renderFrame, type MeasureFn } from '../src/core/render/frame';
import { loadProjectJson } from '../src/core/project/migrate';
import { createLine, createProject, PROJECT_FORMAT_VERSION } from '../src/core/project/factory';
import { usFromMs, usFromSeconds } from '../src/core/time';

const monoMeasure: MeasureFn = (fontSizePx, _weight, letterSpacingPx) => ({
  width: (text: string) => text.length * (fontSizePx * 0.56 + letterSpacingPx)
});

function createMockContext() {
  const gradient = { addColorStop: vi.fn() };
  const calls = { drawImage: 0, fillText: 0, fillRect: 0, clip: 0 };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(() => {
      calls.clip += 1;
    }),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(() => {
      calls.fillRect += 1;
    }),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(() => {
      calls.fillText += 1;
    }),
    strokeText: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(() => {
      calls.drawImage += 1;
    }),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    measureText: vi.fn((t: string) => ({ width: t.length * 12 })),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'round',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: 'none'
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('VideoSpec declarative DSL', () => {
  it('validates minimal specs and rejects malformed JSON or schema errors with line numbers', () => {
    const valid = parseVideoSpecJson(
      JSON.stringify(
        {
          kind: 'vidlyrics.spec',
          version: VIDEO_SPEC_VERSION,
          title: 'Hello',
          scenes: [{ layout: 'title', text: 'Welcome', duration: 2.5 }]
        },
        null,
        2
      )
    );
    expect(valid.ok).toBe(true);
    expect(valid.issues).toHaveLength(0);
    expect(valid.spec?.scenes).toHaveLength(1);

    const syntaxBroken = parseVideoSpecJson('{\n  "title": "Oops",\n  "scenes": [\n}');
    expect(syntaxBroken.ok).toBe(false);
    expect(syntaxBroken.issues[0]?.line).toBeGreaterThanOrEqual(3);

    const chartMissingData = parseVideoSpecJson(
      JSON.stringify(
        {
          kind: 'vidlyrics.spec',
          version: 1,
          scenes: [{ layout: 'chart', text: 'Revenue' }]
        },
        null,
        2
      )
    );
    expect(chartMissingData.ok).toBe(false);
    expect(chartMissingData.issues.some((i) => i.path.includes('chart'))).toBe(true);

    const badEnd = parseVideoSpecJson(
      JSON.stringify(
        {
          kind: 'vidlyrics.spec',
          scenes: [{ text: 'Backwards', start: 5, end: 2 }]
        },
        null,
        2
      )
    );
    expect(badEnd.ok).toBe(false);
    expect(badEnd.issues[0]?.path).toContain('end');
    expect(badEnd.issues[0]?.line).not.toBeNull();
  });

  it('distinguishes VideoSpec JSON from project files and generic subtitle JSON', () => {
    const specText = JSON.stringify(VIDEO_TEMPLATES[0]!.spec);
    expect(isVideoSpecJson(specText)).toBe(true);
    expect(isVideoSpecJson(JSON.stringify({ scenes: [{ text: 'Minimal' }] }))).toBe(true);
    expect(isVideoSpecJson(JSON.stringify(createProject()))).toBe(false);
    expect(isVideoSpecJson(JSON.stringify({ lines: [{ start: 0, end: 1000, text: 'Lyric' }] }))).toBe(false);
    expect(isVideoSpecJson('not json at all')).toBe(false);
  });

  it('compiles, validates, round-trips, and renders every built-in starter template', () => {
    expect(VIDEO_TEMPLATES.length).toBeGreaterThanOrEqual(5);

    for (const template of VIDEO_TEMPLATES) {
      const json = JSON.stringify(template.spec, null, 2);
      const parsed = parseVideoSpecJson(json);
      expect(parsed.ok, `${template.id}: ${JSON.stringify(parsed.issues)}`).toBe(true);

      const project = compileVideoSpec(parsed.spec!);
      expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
      expect(project.lyrics.lines.length).toBe(template.spec.scenes.length);

      // Must pass full project schema validation as a persisted v3 project.
      const reloaded = loadProjectJson(JSON.parse(JSON.stringify(project)));
      expect(reloaded.project.lyrics.lines.length).toBe(template.spec.scenes.length);

      // Bidirectional round-trip back to JSON spec must re-parse cleanly and preserve structure.
      const reserialised = serialiseVideoSpec(reloaded.project);
      const reparsed = parseVideoSpecJson(reserialised);
      expect(reparsed.ok, `${template.id} round-trip: ${JSON.stringify(reparsed.issues)}`).toBe(true);
      expect(reparsed.spec?.scenes.length).toBe(template.spec.scenes.length);
      expect(reparsed.spec?.aspect).toBe(template.spec.aspect);
      expect(reparsed.spec?.theme).toBe(template.spec.theme);

      // Every scene must render a valid frame at its midpoint with zero errors.
      const scene = buildScene(reloaded.project, { pixelRatio: 1 });
      expect(totalDuration(scene)).toBeGreaterThan(usFromSeconds(5));
      const { ctx, calls } = createMockContext();
      for (const line of scene.lines) {
        const mid = scene.introUs + Math.round((line.start + line.end) / 2);
        const state = renderFrame(ctx, scene, mid, { measure: monoMeasure });
        expect(state.lines.length + state.blocks.length).toBeGreaterThan(0);
      }
      expect(calls.fillText).toBeGreaterThan(0);
    }
  });

  it('validates every quick-insert scene snippet when appended to a spec', () => {
    for (const snippet of SCENE_SNIPPETS) {
      const parsed = parseVideoSpecJson(
        JSON.stringify({
          kind: 'vidlyrics.spec',
          version: VIDEO_SPEC_VERSION,
          scenes: [snippet.create()]
        })
      );
      expect(parsed.ok, snippet.label).toBe(true);
    }
  });

  it('preserves rich scene fields, timings, pauses, narration, and aspect sizing across round-trip', () => {
    const spec: VideoSpec = {
      kind: 'vidlyrics.spec',
      version: 1,
      title: 'Architecture Deep Dive',
      author: 'Studio',
      aspect: '9:16',
      fps: 60,
      theme: 'neon',
      karaoke: 'word',
      voice: { voiceId: 'en_US-lessac-medium', voiceIdB: 'en_US-ryan-medium', pauseMs: 400 },
      intro: { title: 'Deep Dive', subtitle: 'Episode 1', duration: 2 },
      outro: { title: 'Thanks', subtitle: 'Subscribe', duration: 2.5 },
      watermark: { text: '@vidlyrics', position: 'top-right' },
      scenes: [
        {
          id: 's1',
          layout: 'stat',
          kicker: 'LATENCY',
          value: '12ms',
          text: 'Zero server round-trips',
          subtext: 'Measured in Chrome',
          narration: 'Latency drops to twelve milliseconds with zero server round trips.',
          speaker: 'A',
          start: 0,
          duration: 3,
          pauseAfter: 0.5,
          enter: 'spring',
          transition: 'zoom',
          accent: '#5ce1e6',
          background: { kind: 'gradient', colors: ['#050816', '#162044'], scrim: 0.3, motion: 0.4 }
        },
        {
          id: 's2',
          layout: 'chart',
          kicker: 'BENCHMARK',
          text: 'Render throughput',
          speaker: 'B',
          duration: 4,
          transition: 'wipe',
          chart: [
            { label: 'Local', value: 120, color: '#66e0a3' },
            { label: 'Cloud', value: 30 }
          ]
        }
      ]
    };

    const project = compileVideoSpec(spec);
    expect(project.export.width).toBe(1080);
    expect(project.export.height).toBe(1920);
    expect(project.export.fps).toBe(60);
    expect(project.lyrics.lines[0]?.start).toBe(0);
    expect(project.lyrics.lines[0]?.end).toBe(usFromSeconds(3));
    // pauseAfter of 0.5s places scene 2 at 3.5s..7.5s.
    expect(project.lyrics.lines[1]?.start).toBe(usFromMs(3500));
    expect(project.lyrics.lines[1]?.end).toBe(usFromMs(7500));

    const back = projectToVideoSpec(project);
    expect(back.scenes[0]?.start).toBe(0);
    expect(back.scenes[0]?.end).toBe(3);
    expect(back.scenes[1]?.start).toBe(3.5);
    expect(back.scenes[1]?.end).toBe(7.5);
    expect(back.scenes[0]?.value).toBe('12ms');
    expect(back.scenes[0]?.narration).toContain('twelve milliseconds');
    expect(back.scenes[0]?.speaker).toBe('A');
    expect(back.scenes[1]?.speaker).toBe('B');
    expect(back.scenes[1]?.chart).toHaveLength(2);
    expect(back.intro?.title).toBe('Deep Dive');
    expect(back.outro?.duration).toBe(2.5);
    expect(back.watermark?.text).toBe('@vidlyrics');
  });

  it('produces an AI authoring prompt documenting schema, layouts, themes, and local voices', () => {
    const prompt = buildAiSpecPrompt();
    expect(prompt).toContain('vidlyrics.spec');
    expect(prompt).toContain('chart');
    expect(prompt).toContain('code');
    expect(prompt).toContain('nocturne');
    expect(prompt).toContain('en_US-lessac-medium');
    expect(prompt).toContain('narration');
  });
});

describe('multi-scene deterministic renderer & v3 migration', () => {
  it('computes bit-for-bit identical FrameState across all scene layouts and animates progress', () => {
    const project = compileVideoSpec({
      kind: 'vidlyrics.spec',
      version: 1,
      aspect: '16:9',
      theme: 'editorial',
      voice: { pauseMs: 0 },
      scenes: [
        { layout: 'stat', value: '100%', text: 'Deterministic', start: 0, duration: 3, transition: 'fade' },
        {
          layout: 'chart',
          text: 'Growth',
          duration: 4,
          transition: 'slide',
          chart: [
            { label: 'Q1', value: 40 },
            { label: 'Q2', value: 80 }
          ]
        },
        { layout: 'bullets', text: 'Checklist', items: ['One', 'Two', 'Three'], duration: 3, transition: 'wipe' },
        { layout: 'quote', text: 'Simplicity wins.', subtext: 'Design note', duration: 3, transition: 'zoom' },
        { layout: 'code', kicker: 'demo.ts', text: 'Snippet', items: ['const ok = true;', 'export { ok };'], duration: 3 }
      ]
    });

    const scene = buildScene(project, { pixelRatio: 1 });

    // Determinism check across every scene layout.
    for (const tSec of [0.2, 1.5, 3.1, 5.5, 8.2, 11.5, 14.5]) {
      const a = computeFrameState(scene, usFromSeconds(tSec), monoMeasure);
      const b = computeFrameState(scene, usFromSeconds(tSec), monoMeasure);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }

    // Stat counts up from early in the scene to full 100% by midpoint.
    const statEarly = computeFrameState(scene, usFromMs(80), monoMeasure);
    const statSettled = computeFrameState(scene, usFromSeconds(2.2), monoMeasure);
    expect(statEarly.blocks[0]?.layout).toBe('stat');
    expect(statSettled.blocks[0]?.stat?.text).toBe('100%');

    // Bar chart grows progressively over time.
    const chartStart = computeFrameState(scene, usFromMs(3150), monoMeasure);
    const chartLate = computeFrameState(scene, usFromMs(6600), monoMeasure);
    const startBar = chartStart.blocks.find((b) => b.layout === 'chart')?.chart?.bars[1];
    const lateBar = chartLate.blocks.find((b) => b.layout === 'chart')?.chart?.bars[1];
    expect(startBar).toBeDefined();
    expect(lateBar).toBeDefined();
    expect(lateBar!.fillRatio).toBeGreaterThan(startBar!.fillRatio);
    expect(lateBar!.fillRatio).toBeCloseTo(1, 2);

    // Code typewriter reveals more characters later in the scene.
    const codeEarly = computeFrameState(scene, usFromMs(13_100), monoMeasure);
    const codeLate = computeFrameState(scene, usFromMs(15_600), monoMeasure);
    const earlyChars = codeEarly.blocks.find((b) => b.layout === 'code')?.code?.lines.reduce((n, l) => n + l.visibleChars, 0) ?? 0;
    const lateChars = codeLate.blocks.find((b) => b.layout === 'code')?.code?.lines.reduce((n, l) => n + l.visibleChars, 0) ?? 0;
    expect(lateChars).toBeGreaterThan(earlyChars);
  });

  it('computes background transition overlays and draws cover-fit Ken Burns images when loaded', () => {
    const project = compileVideoSpec({
      kind: 'vidlyrics.spec',
      version: 1,
      voice: { pauseMs: 0 },
      scenes: [
        {
          layout: 'title',
          text: 'Scene 1',
          start: 0,
          duration: 3,
          background: { kind: 'solid', colors: ['#111111'] }
        },
        {
          layout: 'caption',
          text: 'Scene 2 with image',
          duration: 3,
          transition: 'wipe',
          background: { kind: 'image', assetId: 'img_hero', colors: ['#123456'], scrim: 0.4, motion: 0.5 }
        }
      ]
    });

    const fakeImage = { width: 1600, height: 900 } as unknown as CanvasImageSource;
    const scene = buildScene(project, {
      pixelRatio: 1,
      assets: { images: new Map([['img_hero', fakeImage]]) }
    });

    // Inside the transition window just after 3.0s, backgroundOverlay is active with 'wipe'.
    const duringTransition = computeFrameState(scene, usFromMs(3150), monoMeasure);
    expect(duringTransition.backgroundOverlay).not.toBeNull();
    expect(duringTransition.backgroundOverlay?.transition).toBe('wipe');
    expect(duringTransition.backgroundOverlay!.progress).toBeGreaterThan(0);
    expect(duringTransition.backgroundOverlay!.progress).toBeLessThan(1);

    // After the transition window settles, scene 2's image background becomes the primary base.
    const settled = computeFrameState(scene, usFromMs(4500), monoMeasure);
    expect(settled.backgroundOverlay).toBeNull();
    expect(settled.background.kind).toBe('image');
    expect(settled.background.image.assetId).toBe('img_hero');

    const { ctx, calls } = createMockContext();
    renderFrame(ctx, scene, usFromMs(3150), { measure: monoMeasure });
    expect(calls.clip).toBeGreaterThan(0);
    expect(calls.drawImage).toBe(1);
  });

  it('migrates v2 projects cleanly to v3 while keeping v2 lyric rendering untouched', () => {
    const v2 = {
      ...createProject({ title: 'Legacy Song' }),
      formatVersion: 2,
      lyrics: {
        ...createProject().lyrics,
        lines: [createLine('Sing along tonight', { start: usFromSeconds(1), end: usFromSeconds(4), source: 'human' })]
      }
    };
    const { project, report } = loadProjectJson(v2);
    expect(project.formatVersion).toBe(3);
    expect(report.fromVersion).toBe(2);
    expect(report.toVersion).toBe(3);
    expect(report.steps.some((s) => s.includes('v2 -> v3'))).toBe(true);
    expect(project.lyrics.lines[0]?.scene).toBeUndefined();

    const scene = buildScene(project, { pixelRatio: 1 });
    const frame = computeFrameState(scene, usFromSeconds(2), monoMeasure);
    expect(frame.lines).toHaveLength(1);
    expect(frame.blocks).toHaveLength(0);
  });
});

describe('chat-generated portrait project', () => {
  it('recovers Markdown escapes without changing legitimate JSON escapes', () => {
    const source = String.raw`{"voice":{"voiceId":"en\_US-ryan-medium"},"scenes":\[{"text":"a\\_b\n\"hello\""}\]}`;
    const parsed = parseVideoSpecJson('```json\r\n' + source + '\r\n```');
    expect(parsed.spec?.voice?.voiceId).toBe('en_US-ryan-medium');
    expect(parsed.spec?.scenes[0]?.text).toBe('a\\_b\n"hello"');
    expect(isVideoSpecJson(source)).toBe(true);
    expect(parseVideoSpecJson(source.replace('hello', '\\q')).ok).toBe(false);
    expect(isVideoSpecJson('```js\nconsole.log("hello")\n```')).toBe(false);
    expect(parseVideoSpecJson('{"scenes":[{"text":"  "}]}').ok).toBe(false);
  });

  it('renders the supplied script scene by scene, without promoting narration to display text', async () => {
    const { default: example } = await import('../../../examples/the-sin-cycle.spec.json');
    const spec = parseVideoSpecJson(JSON.stringify(example)).spec!;
    const project = compileVideoSpec(spec);
    const scene = buildScene(project);
    expect(scene.lines).toHaveLength(13);
    expect(project.export.rangeEndUs).toBe(totalDuration(scene));
    const copy = (rows?: { text: string }[]) => rows?.map(row => row.text).join(' ').replace(/\s+/g, ' ').trim();
    for (const [index, input] of spec.scenes.entries()) {
      const line = scene.lines[index]!;
      expect(line.scene?.narration).toBe(input.narration);
      const spokenWords = input.narration!.split(/\s+/).length;
      expect(line.end - line.start).toBeGreaterThanOrEqual(spokenWords / 155 * 60_000_000);
      const frame = computeFrameState(scene, Math.round((line.start + line.end) / 2), monoMeasure);
      const block = frame.blocks[0];
      const caption = frame.lines[0];
      expect((block ?? caption)?.kicker?.text).toBe(input.kicker);
      if (input.layout === 'caption') {
        expect(copy(caption?.rows.map(row => ({ text: row.tokens.map(t => t.text).join('') })))).toBe(input.text);
        for (const row of caption!.rows) {
          expect(row.baselineY).toBeGreaterThan(scene.box.contentTop);
          expect(row.baselineY).toBeLessThan(scene.box.contentTop + scene.box.contentHeight);
        }
      } else {
        expect(copy(block?.headline?.rows)).toBe(input.text);
        if (input.subtext) expect(copy(block?.subtext?.rows)?.replace(/^— /, '')).toBe(input.subtext);
        if (input.items) expect(block?.bullets?.items.map(b => copy(b.rows))).toEqual(input.items);
        if (input.chart) expect(block?.chart?.bars.map(b => b.label)).toEqual(input.chart.map(b => b.label));
        if (input.value) {
          const early = computeFrameState(scene, line.start + 120_000, monoMeasure);
          expect(early.blocks.find(b => b.id === line.id)?.stat?.text).toBe(input.value);
        }
      }
    }
    const { ctx } = createMockContext();
    const outro = renderFrame(ctx, scene, totalDuration(scene) - usFromSeconds(1), { measure: monoMeasure });
    expect(outro.card?.title).toBe(example.outro.title);
    const painted = vi.mocked(ctx.fillText).mock.calls.map(([text]) => text).join(' ');
    expect(painted).toBe(`${example.outro.title} ${example.outro.subtitle}`);
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(2); // subtitle wraps in portrait
  });

  it('applies the intro once, keeps word timings in sync and leaves the outro clear', () => {
    const scene = buildScene(compileVideoSpec({
      intro: { title: 'Intro', duration: 3 }, outro: { title: 'Outro', duration: 2 },
      scenes: [{ text: 'Sing, then rest.', duration: 1 }]
    }), { offsetUs: 500_000 });
    const before = computeFrameState(scene, 2_000_000, monoMeasure);
    expect(before.lines).toHaveLength(0);
    expect(before.card?.kind).toBe('intro');
    const during = computeFrameState(scene, 3_600_000, monoMeasure);
    expect(during.lines[0]?.isCurrent).toBe(true);
    expect(scene.lines[0]?.words[0]?.start).toBe(500_000);
    expect(scene.lines[0]?.words.map(w => w.text).join('')).toBe('Sing, then rest.');
    expect(computeFrameState(scene, 4_700_000, monoMeasure).card?.kind).toBe('outro');
  });

  it('retains all supported chart bars and code rows', () => {
    const chart = Array.from({ length: 12 }, (_, i) => ({ label: `Bar ${i}`, value: i }));
    const items = Array.from({ length: 24 }, (_, i) => `line ${i}`);
    const scene = buildScene(compileVideoSpec({ scenes: [
      { layout: 'chart', chart, text: 'Chart', duration: 2 },
      { layout: 'code', items, text: 'Code', duration: 2 },
      { layout: 'bullets', items, text: 'List', subtext: 'All entries included.', duration: 2 }
    ] }));
    expect(computeFrameState(scene, 1e6, monoMeasure).blocks[0]?.chart?.bars.map(b => b.label)).toEqual(chart.map(b => b.label));
    expect(computeFrameState(scene, 4e6, monoMeasure).blocks[0]?.code?.lines.map(l => l.text)).toEqual(items);
    const list = computeFrameState(scene, 6e6, monoMeasure).blocks[0];
    expect(list?.bullets?.items).toHaveLength(24);
    expect(list?.subtext?.rows[0]?.text).toBe('All entries included.');
    expect(list?.fitScale).toBeLessThan(1);
  });
});
