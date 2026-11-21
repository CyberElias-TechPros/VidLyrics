import { z } from 'zod';
import { presetStyleSchema } from '../project/schema';
import type { Design } from '../types';

// No album art, project IDs, media hashes, titles, brand marks or canvas size
// belong in a reusable motion/type style. Zod copies the resolved values.
const preset = z.object({ name: z.string().trim().min(1).max(60), style: presetStyleSchema });
const library = z.object({ version: z.literal(1), presets: z.array(preset).max(40) });
export type StylePreset = z.infer<typeof preset>;
export const presetStorageKey = 'vidlyrics.style-presets.v1';
export function readPresets(value: string | null): StylePreset[] {
  return value === null ? [] : library.parse(JSON.parse(value)).presets;
}
export function savePreset(items: StylePreset[], name: string, design: Design) {
  const item = preset.parse({ name, style: design });
  if (items.some(p => p.name.toLowerCase() === item.name.toLowerCase())) throw new Error('A style already has that name. Choose another.');
  if (items.length >= 40) throw new Error('The library is full. Remove a style first.');
  return [...items, item];
}
export function applyPreset(design: Design, item: StylePreset): Design {
  return { ...design, ...presetStyleSchema.parse(item.style) };
}
