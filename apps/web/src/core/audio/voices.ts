import voices from '../../../model-voices.json';

export const PIPER_VOICES = voices;
export const DEFAULT_VOICE = 'en_US-norman-medium';
export const DEFAULT_VOICE_B = 'en_US-ljspeech-medium';

/** Never rely on dropdown order to choose the voice used in a render. */
export function bundledVoice(id: string | null | undefined, fallback = DEFAULT_VOICE): string {
  return voices.find(v => v.id === id)?.id ?? fallback;
}
