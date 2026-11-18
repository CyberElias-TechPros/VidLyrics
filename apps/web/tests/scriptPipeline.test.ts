import { describe, expect, it } from 'vitest';
import {
  applyMeasuredVoiceoverCues,
  splitIntoSentences,
  splitScriptToTimedScenes,
  spokenTextForScene
} from '../src/core/lyrics/script';
import {
  renderStandaloneVoiceover,
  stitchSequentialVoiceClips,
  voiceoverSourceSignature
} from '../src/core/audio/voiceover';
import { createLine } from '../src/core/project/factory';
import { usFromMs, usFromSeconds } from '../src/core/time';
import { useEditor } from '../src/state/store';
import { VIDEO_TEMPLATES } from '../src/core/spec/templates';

describe('script-to-video parser and timing', () => {
  it('splits prose into sentences without breaking on abbreviations or decimals', () => {
    const sentences = splitIntoSentences(
      'Dr. Rivera launched v3.5 in 1.5 seconds. It renders Mr. Chen’s charts, code, and captions locally! Ready to ship?'
    );
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toContain('1.5 seconds.');
    expect(sentences[1]).toContain('Mr. Chen');
    expect(sentences[2]).toBe('Ready to ship?');
  });

  it('recognises markdown titles, stats, bullet lists, quotes, code fences, and A/B dialogue', () => {
    const script = [
      '# Zero-Upload Studio',
      'Built for creators and engineers',
      '',
      '[Stat: 10x] Faster local export',
      '',
      'Why teams switch:',
      '- Private on-device TTS',
      '- Deterministic 60fps MP4',
      '- Git-friendly JSON specs',
      '',
      '> The best render queue is no queue at all.',
      '— VidLyrics Engineering',
      '',
      '```ts',
      'const mp4 = await render(spec);',
      'save(mp4);',
      '```',
      '',
      'A: Does this need an account?',
      'B: Never. Everything stays in your browser.'
    ].join('\n');

    const { lines } = splitScriptToTimedScenes(script, {
      mode: 'sentences',
      wordsPerMinute: 160,
      pauseMs: 250,
      leadInMs: 0
    });
    expect(lines.length).toBeGreaterThanOrEqual(7);

    const title = lines.find((l) => l.scene?.layout === 'title');
    expect(title?.text).toBe('Zero-Upload Studio');

    const stat = lines.find((l) => l.scene?.layout === 'stat');
    expect(stat?.scene?.value).toBe('10x');
    expect(stat?.text).toBe('Faster local export');

    const bullets = lines.find((l) => l.scene?.layout === 'bullets');
    expect(bullets?.scene?.items).toHaveLength(3);

    const quote = lines.find((l) => l.scene?.layout === 'quote');
    expect(quote?.text).toContain('render queue');

    const code = lines.find((l) => l.scene?.layout === 'code');
    expect(code).toBeDefined();

    const speakerA = lines.find((l) => l.speaker === 'A');
    const speakerB = lines.find((l) => l.speaker === 'B');
    expect(speakerA?.text).toBe('Does this need an account?');
    expect(speakerB?.text).toContain('Never.');

    // Monotone non-overlapping timeline with configured pause between scenes.
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      expect(line.end).toBeGreaterThan(line.start);
      if (i > 0) {
        expect(line.start - lines[i - 1]!.end).toBe(usFromMs(250));
      }
    }
  });

  it('derives clean spoken narration per scene layout without reading raw code syntax', () => {
    const codeLine = createLine('Pipeline setup', {
      scene: { layout: 'code', items: ['const x = () => 42;'], subtext: 'Runs offline.' }
    });
    expect(spokenTextForScene(codeLine)).toBe('Pipeline setup. Runs offline.');

    const overridden = createLine('Q4 ARR', {
      scene: { layout: 'stat', value: '$4.2M', narration: 'Four point two million in annual recurring revenue.' }
    });
    expect(spokenTextForScene(overridden)).toBe('Four point two million in annual recurring revenue.');

    const bullets = createLine('Three steps', {
      scene: { layout: 'bullets', items: ['Write script', 'Pick voice', 'Export MP4'] }
    });
    expect(spokenTextForScene(bullets)).toBe('Three steps. Write script. Pick voice. Export MP4.');

    const instrumental = createLine('[Instrumental]');
    expect(spokenTextForScene(instrumental)).toBe('');
  });

  it('aligns scene timings to exact measured TTS clip durations and redistributes word timings', () => {
    const l1 = createLine('Welcome everyone', { start: 0, end: usFromSeconds(2) });
    const silent = createLine('', {
      start: usFromSeconds(2),
      end: usFromSeconds(3.5),
      scene: { layout: 'code', items: ['npm run verify'] }
    });
    const l3 = createLine('Ship it today', { start: usFromSeconds(3.5), end: usFromSeconds(5) });

    const { lines: aligned, totalDurationUs } = applyMeasuredVoiceoverCues(
      [l1, silent, l3],
      [
        { lineId: l1.id, startUs: 0, endUs: 1_420_000 },
        { lineId: l3.id, startUs: 3_220_000, endUs: 4_600_000 }
      ],
      { pauseMs: 300 }
    );

    expect(aligned[0]?.start).toBe(0);
    expect(aligned[0]?.end).toBe(1_420_000);
    expect(aligned[0]?.source).toBe('tts');
    expect(aligned[0]?.words[0]?.start).toBe(0);
    expect(aligned[0]?.words.at(-1)?.end).toBe(1_420_000);

    expect(aligned[1]!.start).toBeGreaterThanOrEqual(aligned[0]!.end);
    expect(aligned[2]?.start).toBe(3_220_000);
    expect(aligned[2]?.end).toBe(4_600_000);
    expect(totalDurationUs).toBeGreaterThanOrEqual(4_600_000);
  });
});

describe('sequential and standalone voiceover DSP', () => {
  it('stitches clips end-to-end with configurable pauses and exact microsecond cues', () => {
    const sampleRate = 1000; // 1 sample = 1 ms
    const stitched = stitchSequentialVoiceClips(
      [
        { lineId: 'a', samples: new Float32Array(500).fill(0.4) },
        { lineId: 'b', samples: new Float32Array(800).fill(0.6) }
      ],
      sampleRate,
      { pauseUs: usFromMs(200), leadInUs: usFromMs(100), tailUs: usFromMs(150) }
    );

    expect(stitched.cues).toEqual([
      { lineId: 'a', startUs: usFromMs(100), endUs: usFromMs(600) },
      { lineId: 'b', startUs: usFromMs(800), endUs: usFromMs(1600) }
    ]);
    expect(stitched.pcm).toHaveLength(100 + 500 + 200 + 800 + 150);
    expect(stitched.durationUs).toBe(usFromMs(1750));
    expect(stitched.pcm[650]).toBe(0);
    expect(stitched.pcm[300]).toBeCloseTo(0.4, 3);
    expect(stitched.pcm[1100]).toBeCloseTo(0.6, 3);
  });

  it('renders standalone voiceover with range slicing, intro offset, and 22.05 kHz -> 48 kHz conversion', () => {
    const voice = new Float32Array(22_050).fill(0.5); // 1.0s at Piper 22,050 Hz
    const { pcm, sampleRate } = renderStandaloneVoiceover({
      voice,
      voiceSampleRate: 22_050,
      targetSampleRate: 48_000,
      voiceGain: 0.8,
      voiceTimelineOffsetUs: usFromMs(500),
      rangeStartUs: 0,
      rangeEndUs: usFromMs(1500)
    });

    expect(sampleRate).toBe(48_000);
    // 1.5s at 48,000 Hz = 72,000 samples: first 24,000 are intro silence, remaining 48,000 are speech at 0.4.
    expect(pcm).toHaveLength(72_000);
    expect(pcm[1000]).toBe(0);
    expect(pcm[23_999]).toBe(0);
    expect(pcm[36_000]).toBeCloseTo(0.4, 3);
  });

  it('keeps single-voice signature backwards-compatible while tracking speaker B and narration', () => {
    const a = createLine('Hello world', { start: 0, end: usFromSeconds(2), speaker: 'A' });
    const b = createLine('Welcome back', { start: usFromSeconds(2), end: usFromSeconds(4), speaker: 'B' });

    const singleSig = voiceoverSourceSignature([a, b]);
    const dualSig1 = voiceoverSourceSignature([a, b], { voiceIdB: 'en_US-ryan-medium' });
    const dualSig2 = voiceoverSourceSignature([a, b], { voiceIdB: 'en_GB-alba-medium' });
    expect(dualSig1).not.toBe(singleSig);
    expect(dualSig1).not.toBe(dualSig2);

    const withNarration = { ...a, scene: { layout: 'stat' as const, value: '99%', narration: 'Ninety nine percent' } };
    expect(voiceoverSourceSignature([withNarration, b])).not.toBe(singleSig);
  });
});

describe('editor store script & code actions (undo/redo)', () => {
  it('supports undo/redo across setScenesFromScript, applyVideoSpec, and setLineScene', () => {
    const store = useEditor.getState();
    store.newProject({ title: 'Undo Test' });

    store.setScenesFromScript('# Opening\n\nFirst spoken point. Second spoken point.', { mode: 'sentences' });
    expect(useEditor.getState().project.lyrics.lines).toHaveLength(3);
    expect(useEditor.getState().project.lyrics.lines[0]?.scene?.layout).toBe('title');

    const secondId = useEditor.getState().project.lyrics.lines[1]!.id;
    store.setLineScene(secondId, { layout: 'stat', value: '42', kicker: 'ANSWER' });
    expect(useEditor.getState().project.lyrics.lines[1]?.scene?.value).toBe('42');

    store.applyVideoSpec(VIDEO_TEMPLATES[1]!.spec, { label: 'Apply template' });
    expect(useEditor.getState().project.meta.title).toBe(VIDEO_TEMPLATES[1]!.spec.title);
    expect(useEditor.getState().project.export.width).toBe(1080);
    expect(useEditor.getState().project.export.height).toBe(1920);

    // Undo template -> back to modified script scenes.
    store.undo();
    expect(useEditor.getState().project.lyrics.lines).toHaveLength(3);
    expect(useEditor.getState().project.lyrics.lines[1]?.scene?.value).toBe('42');

    // Undo scene layout edit -> back to caption.
    store.undo();
    expect(useEditor.getState().project.lyrics.lines[1]?.scene?.layout).not.toBe('stat');

    // Undo script import -> back to empty project.
    store.undo();
    expect(useEditor.getState().project.lyrics.lines).toHaveLength(0);

    // Redo restores script import cleanly.
    store.redo();
    expect(useEditor.getState().project.lyrics.lines).toHaveLength(3);
  });
});
