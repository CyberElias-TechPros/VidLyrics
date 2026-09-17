import { describe, it, expect } from 'vitest';
import { parseLyrics, detectFormat, hasTimings, timingCoverage } from '../src/core/lyrics/parse';
import { normalizeDisplay, normalizeForMatch, extractStructuralTag, isInstrumentalMarker, splitAdLib } from '../src/core/lyrics/normalize';
import { graphemes, highlightTokens, needsGraphemeTokenisation } from '../src/core/lyrics/segment';
import { inferSections, groupByRepetition } from '../src/core/lyrics/structure';
import { createLine, createProject } from '../src/core/project/factory';
import { toTimedJson } from '../src/core/export/subtitles';
import { usFromSeconds } from '../src/core/time';

describe('lyric import', () => {
  it('parses standard LRC with metadata and repeated tags', () => {
    const parsed = parseLyrics('[ti:Song]\n[ar:Artist]\n[offset:200]\n[00:01.00]First line\n[00:05.50][00:20.00]Chorus line', 'a.lrc');
    expect(parsed.format).toBe('lrc');
    expect(parsed.meta.title).toBe('Song');
    expect(parsed.meta.artist).toBe('Artist');
    // LRC offset is "shift earlier" in milliseconds.
    expect(parsed.meta.offsetUs).toBe(-200_000);
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0]?.text).toBe('First line');
    expect(parsed.lines[0]?.start).toBe(1_000_000);
    expect(parsed.lines.map((l) => l.start)).toEqual([1_000_000, 5_500_000, 20_000_000]);
  });

  it('parses enhanced LRC into per-word timings', () => {
    const parsed = parseLyrics('[00:02.00]<00:02.00>Hello <00:02.40>world <00:02.90>again', 'a.lrc');
    const line = parsed.lines[0];
    expect(line?.words).toHaveLength(3);
    expect(line?.words[0]?.text).toBe('Hello');
    expect(line?.words[0]?.start).toBe(2_000_000);
    expect(line?.words[1]?.start).toBe(2_400_000);
    expect(line?.words[2]?.text).toBe('again');
  });

  it('parses SRT and VTT cues, stripping inline tags', () => {
    const srt = parseLyrics('1\n00:00:01,000 --> 00:00:04,000\nLine one\n\n2\n00:00:05,000 --> 00:00:07,500\nLine two\n', 'a.srt');
    expect(srt.format).toBe('srt');
    expect(srt.lines).toHaveLength(2);
    expect(srt.lines[0]?.start).toBe(1_000_000);
    expect(srt.lines[1]?.end).toBe(7_500_000);

    const vtt = parseLyrics('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<00:00:01.000>Hello <00:00:01.500>world\n', 'a.vtt');
    expect(vtt.format).toBe('vtt');
    expect(vtt.lines[0]?.text).toBe('Hello world');
    expect(vtt.lines[0]?.words).toHaveLength(2);
  });

  it('parses ASS dialogue with karaoke tags and inline overrides', () => {
    const ass = [
      '[Script Info]',
      'Title: Test',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\kf50}Hel{\\kf50}lo {\\kf100}world, all'
    ].join('\n');
    const parsed = parseLyrics(ass, 'a.ass');
    expect(parsed.format).toBe('ass');
    expect(parsed.meta.title).toBe('Test');
    const line = parsed.lines[0];
    expect(line?.text).toBe('Hello world, all');
    expect(line?.words).toHaveLength(3);
    // \kf values are centiseconds: 50cs = 500ms.
    expect(line?.words[0]?.end).toBe(1_500_000);
    expect(line?.words[1]?.start).toBe(1_500_000);
  });

  it('round-trips this app\'s own JSON export exactly', () => {
    const project = createProject({ title: 'Round Trip', artist: 'Nobody' });
    project.audio = {
      assetId: 'a1', fileName: 'song.mp3', mimeType: 'audio/mpeg', bytes: 1,
      durationUs: usFromSeconds(10), sampleRate: 44100, channels: 2, peaksAssetId: 'p1', contentHash: 'x'
    };
    project.lyrics.lines = [
      createLine('First line', { start: usFromSeconds(1), end: usFromSeconds(2), source: 'human' }),
      createLine('Second line', { start: usFromSeconds(3), end: usFromSeconds(4), source: 'human' })
    ];
    const exported = JSON.stringify(toTimedJson(project), null, 2);
    const parsed = parseLyrics(exported, 'a.json');
    expect(parsed.format).toBe('json');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]?.start).toBe(usFromSeconds(1));
    expect(parsed.lines[1]?.end).toBe(usFromSeconds(4));
  });

  it('infers the time unit of a foreign JSON file that declares none', () => {
    const seconds = parseLyrics(JSON.stringify({ lines: [{ text: 'A', start: 1, end: 3 }] }), 'a.json');
    expect(seconds.lines[0]?.start).toBe(usFromSeconds(1));
    const millis = parseLyrics(JSON.stringify({ lines: [{ text: 'A', start: 65_000, end: 70_000 }] }), 'a.json');
    expect(millis.lines[0]?.start).toBe(usFromSeconds(65));
    const micros = parseLyrics(JSON.stringify({ lines: [{ text: 'A', start: 65_000_000, end: 70_000_000 }] }), 'a.json');
    expect(micros.lines[0]?.start).toBe(usFromSeconds(65));
  });

  it('treats plain text as untimed lyrics', () => {
    const parsed = parseLyrics('Line one\n\nLine two\n', 'a.txt');
    expect(parsed.format).toBe('txt');
    expect(parsed.lines).toHaveLength(2);
    expect(hasTimings(parsed)).toBe(false);
  });

  it('detects format from content when the extension lies', () => {
    expect(detectFormat('notes.txt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi')).toBe('vtt');
    expect(detectFormat('notes.txt', '[00:01.00]Hi')).toBe('lrc');
    expect(detectFormat('notes.txt', '[Script Info]\n')).toBe('ass');
    expect(detectFormat('notes.txt', 'just words')).toBe('txt');
  });

  it('reports coverage and never crashes on garbage', () => {
    const garbage = parseLyrics('\u0000\u0001binary junk', 'a.txt');
    expect(garbage.lines.length).toBeGreaterThanOrEqual(0);
    expect(timingCoverage(garbage)).toBe(0);
    const empty = parseLyrics('', 'a.lrc');
    expect(empty.lines).toHaveLength(0);
  });
});

describe('normalisation', () => {
  it('preserves the original while producing a match form', () => {
    expect(normalizeDisplay('  hello   world  ')).toBe('hello world');
    expect(normalizeForMatch("Don't stop, Believin'!")).toBe('dont stop believin');
    expect(normalizeForMatch('Café résumé')).toBe('cafe resume');
  });

  it('strips zero-width and bidi controls that arrive from copy-paste', () => {
    expect(normalizeDisplay('he\u200Bllo\uFEFF')).toBe('hello');
  });

  it('recognises structural tags and instrumental markers', () => {
    expect(extractStructuralTag('[Chorus]')).toBe('CHORUS');
    expect(extractStructuralTag('(Verse 2)')).toBe('VERSE 2');
    expect(extractStructuralTag('not a tag')).toBeNull();
    expect(isInstrumentalMarker('[Instrumental]')).toBe(true);
    expect(isInstrumentalMarker('(Music)')).toBe(true);
    expect(isInstrumentalMarker('I am singing')).toBe(false);
  });

  it('separates trailing ad-libs without losing the main line', () => {
    expect(splitAdLib('Hello (hello!)')).toEqual({ main: 'Hello', adLib: 'hello!' });
    expect(splitAdLib('No adlib here')).toEqual({ main: 'No adlib here', adLib: null });
    expect(splitAdLib('(only adlib)')).toEqual({ main: '(only adlib)', adLib: null });
  });
});

describe('segmentation', () => {
  it('keeps emoji and combining marks as single graphemes', () => {
    expect(graphemes('a\u0301')).toEqual(['a\u0301']);
    expect(graphemes('👨‍👩‍👧')).toHaveLength(1);
    expect(graphemes('ab')).toEqual(['a', 'b']);
  });

  it('tokenises CJK per grapheme because it has no word spaces', () => {
    expect(needsGraphemeTokenisation('日本語の歌詞')).toBe(true);
    const tokens = highlightTokens('日本語');
    expect(tokens).toHaveLength(3);
  });

  it('ignores whitespace separators in highlight tokens', () => {
    const tokens = highlightTokens('hello   world');
    expect(tokens.map((t) => t.text)).toEqual(['hello', 'world']);
  });
});

describe('song structure', () => {
  it('infers a chorus from repeated lines', () => {
    const lines = ['Verse line one', 'Verse line two', 'Big chorus', 'Big chorus'].map((t) => createLine(t));
    const result = inferSections(lines);
    const kinds = result.sections.map((s) => s.kind);
    expect(kinds).toContain('CHORUS');
    expect(result.repeated.size).toBeGreaterThan(0);
    expect(result.assignment.size).toBe(lines.length);
  });

  it('honours explicit structural tags', () => {
    const lines = ['[Intro]', 'La la la', '[Chorus]', 'Sing it loud'].map((t) => createLine(t));
    const result = inferSections(lines);
    expect(result.sections[0]?.kind).toBe('INTRO');
    expect(result.sections.some((s) => s.kind === 'CHORUS')).toBe(true);
  });

  it('groups repeated lines so one style edit can propagate', () => {
    const lines = ['Repeat me', 'Repeat me', 'Once only'].map((t) => createLine(t));
    const groups = groupByRepetition(lines);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(2);
  });
});
