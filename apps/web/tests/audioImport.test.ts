import { describe, expect, it } from 'vitest';
import { classifyFile, validateAudioFile } from '../src/core/validation/files';

describe('audio file classification', () => {
  it('recognizes common and specialist audio filename extensions', () => {
    for (const name of ['song.mp3', 'song.m4a', 'recording.flac', 'archive.ape', 'recording.wma', 'chiptune.xm', 'disc.dsf']) {
      expect(classifyFile(name, '')).toBe('audio');
    }
  });

  it('routes media containers and audio MIME types to the audio decoder', () => {
    expect(classifyFile('capture.mkv', 'video/x-matroska')).toBe('audio');
    expect(classifyFile('unknown.bin', 'audio/x-custom-codec')).toBe('audio');
    expect(classifyFile('unknown.ogg', 'application/ogg')).toBe('audio');
  });

  it('lets signature sniffing decide unknown binary formats instead of rejecting by extension', () => {
    expect(validateAudioFile('unknown.bin', 'application/octet-stream', 128).ok).toBe(true);
    expect(validateAudioFile('lyrics.lrc', 'text/plain', 128).ok).toBe(false);
  });
});
